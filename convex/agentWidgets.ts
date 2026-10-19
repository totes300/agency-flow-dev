import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { AuthContext } from "./lib/auth";
import { loadTaskForReadOrNull } from "./tasks/access";
import { statusIconFor, type StatusIcon } from "./tasks/model";
import { HIDDEN_ACTIVITY_TYPES, describeActivity } from "../lib/agents/taskReads";
import { threadAccess } from "./agentThreads";
import { findLiveItem } from "./agentItems";
import { currentAuth } from "./email/drafts";
import { isEmailTriageEnabled } from "./email/gate";
import { getThreadRequestsForAuth } from "./email/reads";

/**
 * Live widget reads (email-triage B8a; PRD §7.1 "Widgets", plan §3 P6). A
 * widget block stores only a reference (a task id, a conversation id, the
 * proposal ids of a plan); these queries render it with the VIEWER's access,
 * every time it is on screen, so a card opened tomorrow shows tomorrow's
 * state. Unknown, foreign, unreadable or switched-off all read `null` alike —
 * the block shows one muted "no longer available" line, never old data.
 *
 * Access follows the read tool the widget comes from:
 *   taskCard          a task the viewer can read (`loadTaskForReadOrNull`, the
 *                     same rule as getTaskBundle / the task drawer);
 *   requestChecklist  the email ledger (`getThreadRequestsForAuth`): admins of
 *                     an org with email triage on (I6, I14);
 *   planGaps          the Triage item behind a plan's proposals: admins with
 *                     read access to the proposals' thread.
 */

/** The viewer by the CURRENT orgMembers role, or null (signed out / not a member). */
async function viewer(ctx: QueryCtx): Promise<AuthContext | null> {
  try {
    return await currentAuth(ctx);
  } catch {
    return null;
  }
}

// ─── Task status card (T14) ──────────────────────────────────────────────────

export type TaskCardView = {
  id: Id<"tasks">;
  identifier: string;
  title: string;
  status: { name: string; color: string; icon: StatusIcon } | null;
  subtaskCount: number;
  subtaskDoneCount: number;
  owners: Array<{ id: Id<"users">; name: string; imageUrl: string | null }>;
  dueDate: string | null;
  /** The newest visible activity event ("Status: To do → In progress"). */
  lastEvent: { actor: string; summary: string; at: number } | null;
  /** Open questions to the client on this task's email conversations (admins only; null = not known). */
  openQuestions: number | null;
};

const OWNERS_CAP = 10;
const ACTIVITY_SCAN = 20;
const LINKED_THREADS_CAP = 10;
const LEDGER_SCAN = 100;

export const taskCard = query({
  args: { taskId: v.string() },
  handler: async (ctx, args): Promise<TaskCardView | null> => {
    const auth = await viewer(ctx);
    if (!auth) return null;
    const id = ctx.db.normalizeId("tasks", args.taskId);
    if (!id) return null;
    const access = await loadTaskForReadOrNull(ctx, id, auth);
    const task = access?.task;
    if (!task || task.orgId !== auth.orgId || task.archivedAt) return null;

    const status = await statusOf(ctx, task);
    const owners: TaskCardView["owners"] = [];
    for (const userId of task.assigneeIds.slice(0, OWNERS_CAP)) {
      const user = await ctx.db.get(userId);
      if (user && !user.deletedAt) owners.push({ id: user._id, name: user.name, imageUrl: user.imageUrl ?? null });
    }

    let lastEvent: TaskCardView["lastEvent"] = null;
    const events = await ctx.db
      .query("activityLog")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .order("desc")
      .take(ACTIVITY_SCAN);
    const latest = events.find((e) => e.orgId === auth.orgId && !HIDDEN_ACTIVITY_TYPES.has(e.type));
    if (latest) {
      const actor = latest.userId ? await ctx.db.get(latest.userId) : null;
      lastEvent = { actor: actor?.name ?? "Someone", summary: describeActivity(latest).summary, at: latest.createdAt };
    }

    return {
      id: task._id,
      identifier: task.identifier,
      title: task.title,
      status,
      subtaskCount: task.subtaskCount,
      subtaskDoneCount: task.subtaskDoneCount,
      owners,
      dueDate: task.dueDate ?? null,
      lastEvent,
      openQuestions: await openClientQuestions(ctx, auth, task),
    };
  },
});

async function statusOf(ctx: QueryCtx, task: Doc<"tasks">): Promise<TaskCardView["status"]> {
  const status = await ctx.db.get(task.statusId);
  if (!status || status.orgId !== task.orgId) return null;
  const siblings = (
    await ctx.db
      .query("statuses")
      .withIndex("by_orgId_category_position", (q) => q.eq("orgId", task.orgId).eq("category", status.category))
      .take(50)
  ).filter((s) => !s.archivedAt);
  const index = siblings.findIndex((s) => s._id === status._id);
  return {
    name: status.name,
    color: status.color,
    icon: statusIconFor(status.category, index === -1 ? siblings.length - 1 : index, siblings.length),
  };
}

/**
 * `question_pending` ledger rows on the task (or its subtasks) across its
 * linked email conversations — the questions still waiting on the client.
 * Admins of an email-enabled org only (the ledger is email data, I6).
 */
async function openClientQuestions(ctx: QueryCtx, auth: AuthContext, task: Doc<"tasks">): Promise<number | null> {
  if (!auth.isAdmin || !(await isEmailTriageEnabled(ctx, auth.orgId))) return null;
  const links = await ctx.db
    .query("emailThreadTasks")
    .withIndex("by_orgId_taskId", (q) => q.eq("orgId", auth.orgId).eq("taskId", task._id))
    .take(LINKED_THREADS_CAP);
  const threadIds = [...new Set(links.map((l) => l.threadId))];
  let count = 0;
  for (const threadId of threadIds) {
    const rows = await ctx.db
      .query("clientRequests")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", auth.orgId).eq("threadId", threadId))
      .take(LEDGER_SCAN);
    for (const row of rows) {
      if (row.disposition === "question_pending" && (row.taskId === task._id || row.subtaskId === task._id)) count++;
    }
  }
  return count;
}

// ─── Request checklist (T15) ─────────────────────────────────────────────────

export type ChecklistRowState = "covered" | "answered" | "waiting" | "dismissed" | "replaced" | "planned" | "open";

export type RequestChecklistView = {
  /** Who asked (the sender of the first request's email), or null for pasted notes. */
  askedBy: string | null;
  /** Requests that still count (replaced ones excluded). */
  total: number;
  open: number;
  rows: Array<{
    id: string;
    /** The client's words (untrusted — rendered as text). */
    text: string;
    state: ChecklistRowState;
    /** Dismissed: why. */
    reason: string | null;
    /** Covered: the subtask (or task) that holds it. */
    covering: { taskId: string; identifier: string | null; title: string | null } | null;
  }>;
  truncated: boolean;
};

export const requestChecklist = query({
  args: { threadId: v.optional(v.string()), agentThreadId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<RequestChecklistView | null> => {
    const auth = await viewer(ctx);
    if (!auth) return null;
    if ((args.threadId === undefined) === (args.agentThreadId === undefined)) return null;
    const ledger = await getThreadRequestsForAuth(ctx, auth, args);
    if (!ledger) return null;

    let askedBy: string | null = null;
    const firstMessage = ledger.requests.find((r) => r.messageId)?.messageId;
    const messageId = firstMessage ? ctx.db.normalizeId("emailMessages", firstMessage) : null;
    const message = messageId ? await ctx.db.get(messageId) : null;
    if (message && message.orgId === auth.orgId) askedBy = message.from.name?.trim() || message.from.email;

    const rows: RequestChecklistView["rows"] = ledger.requests.map((r) => {
      const covering =
        r.covering && (r.covering.subtaskId || r.covering.taskId)
          ? {
              taskId: (r.covering.subtaskId ?? r.covering.taskId)!,
              identifier: r.covering.subtask ?? r.covering.task,
              title: r.covering.subtaskTitle,
            }
          : null;
      return { id: r.id, text: r.text, state: checklistState(r.disposition, r.planned?.disposition ?? null), reason: r.dismissedReason, covering };
    });
    const counted = rows.filter((r) => r.state !== "replaced");
    return {
      askedBy,
      total: counted.length,
      open: counted.filter((r) => r.state === "open").length,
      rows,
      truncated: ledger.truncated,
    };
  },
});

/** The checklist state of a ledger row: its disposition, or the current plan's while still open. */
export function checklistState(disposition: string, planned: string | null): ChecklistRowState {
  switch (disposition) {
    case "covered":
      return "covered";
    case "answered":
      return "answered";
    case "question_pending":
      return "waiting";
    case "dismissed":
      return "dismissed";
    case "superseded":
      return "replaced";
    default:
      return planned && planned !== "question_pending" ? "planned" : planned === "question_pending" ? "waiting" : "open";
  }
}

// ─── Plan gaps (the plan list's amber line) ──────────────────────────────────

/**
 * The gaps the CURRENT Triage plan was stored with ("Not covered: …"), for
 * the plan list of its proposals. Empty when the proposals are not the
 * current plan of an open item, or the viewer may not read them.
 */
export const planGaps = query({
  args: { proposalIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ gaps: string[] }> => {
    const none = { gaps: [] as string[] };
    const auth = await viewer(ctx);
    if (!auth || !auth.isAdmin) return none;
    const ids = args.proposalIds
      .slice(0, 20)
      .map((raw) => ctx.db.normalizeId("agentProposals", raw))
      .filter((id): id is Id<"agentProposals"> => id !== null);
    const first = ids[0] ? await ctx.db.get(ids[0]) : null;
    if (!first || first.orgId !== auth.orgId) return none;
    const thread = await ctx.db.get(first.threadId);
    if (!thread || !threadAccess(thread, auth).canRead || thread.anchor?.type !== "emailThread") return none;
    if (!(await isEmailTriageEnabled(ctx, auth.orgId))) return none;
    const item = await findLiveItem(ctx, auth.orgId, { type: "emailThread", id: thread.anchor.id });
    const plan = item?.plan;
    if (!plan || !plan.proposalIds.some((p) => ids.includes(p))) return none;
    return { gaps: plan.gaps.map((g) => g.detail) };
  },
});

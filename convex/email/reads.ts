import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { isEmailTriageEnabled } from "./gate";
import { foldText } from "./model";
import { findLiveItem } from "../agentItems";
import { threadAccess } from "../agentThreads";
import { conversationThreads } from "./drafts";
import { loadContent } from "../attachmentContents";
import { loadTaskForReadOrNull } from "../tasks/access";
import { findTasksForAuth } from "../tasks/agent";
import type { AgentTaskRow } from "../../lib/agents/taskFilters";
import { proposalRevision } from "../agentProposals";
import { summarizeContent, type AttachmentContentSummary } from "../../lib/attachments/contents";
import { validateProposalPayload } from "../../lib/agents/proposals";

/**
 * Backing reads of the email agent tools (docs/prd-email-triage.md §6.4 —
 * T1 getEmailThread, T15 getThreadRequests, T7 findSimilarTasksForClient V1).
 * Called by the actor-path internal queries in `agentActorTools.ts` with a
 * DB-derived AuthContext.
 *
 * Access (I6, I14): ADMIN ONLY, and only for an org with email triage on —
 * a member, another org's id, an unknown id and a disabled org all read
 * `null` alike (no existence leak). Email text is untrusted client content:
 * every message text travels inside `untrustedEmailContent`.
 */

export const THREAD_MESSAGES_CAP = 20;
export const MESSAGE_TEXT_CAP = 6_000;
export const THREAD_TEXT_TOTAL_CAP = 40_000;
export const THREAD_REQUESTS_CAP = 100;
export const SIMILAR_LIMIT_DEFAULT = 10;
export const SIMILAR_LIMIT_MAX = 20;
const SIMILAR_SCAN = 100;
const LINKED_TASKS_CAP = 10;

async function emailReadable(ctx: QueryCtx, auth: AuthContext): Promise<boolean> {
  if (!auth.isAdmin) return false;
  return await isEmailTriageEnabled(ctx, auth.orgId);
}

/** An email thread of the actor's org, or null (garbage, foreign, missing). */
async function loadOwnThread(ctx: QueryCtx, auth: AuthContext, raw: string): Promise<Doc<"emailThreads"> | null> {
  const id = ctx.db.normalizeId("emailThreads", raw.trim());
  const thread = id ? await ctx.db.get(id) : null;
  return thread && thread.orgId === auth.orgId ? thread : null;
}

const cap = (text: string, max: number) => (text.length > max ? { text: `${text.slice(0, max)}…`, cut: true } : { text, cut: false });
const iso = (ms: number) => new Date(ms).toISOString();
const addr = (a: { name?: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);

/**
 * The `createTask` proposals of one plan in a Triage conversation (B6a):
 * pending, failed and discarded ones whose `grouping.planId` is the plan's —
 * the identity set `submitTriagePlan` matches plan tasks against.
 */
export async function planProposals(
  ctx: QueryCtx,
  agentThreadId: Id<"agentThreads">,
  planId: string,
): Promise<Doc<"agentProposals">[]> {
  const out: Doc<"agentProposals">[] = [];
  for (const status of ["pending", "failed", "discarded"] as const) {
    const rows = await ctx.db
      .query("agentProposals")
      .withIndex("by_threadId_status", (q) => q.eq("threadId", agentThreadId).eq("status", status))
      .take(100);
    for (const p of rows) {
      if (p.payload.kind === "createTask" && p.payload.grouping?.planId === planId) out.push(p);
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

// ─── T1 getEmailThread ───────────────────────────────────────────────────────

export type AgentEmailAttachment = {
  /** Pass with the message id to getAttachmentText. */
  index: number;
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** What was read inside (status, pages, image size, text length); null = never read / not downloaded. */
  extracted: AttachmentContentSummary | null;
};

export type AgentEmailMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  cc: string[];
  sentAt: string;
  subject: string;
  /** Quoted history stripped. */
  text: string;
  textTruncated: boolean;
  attachments: AgentEmailAttachment[];
  /** Hard triggers + reasons the classifier recorded (inbound only). */
  classification: { intents: string[]; reasons: string[]; urgent: boolean } | null;
};

export type AgentEmailPlanTask = {
  proposalId: string;
  proposalRevision: number;
  /** `discarded` = the OWNER discarded it: never propose that work again unless the new email asks for new work. */
  status: string;
  editedByOwner: boolean;
  title: string;
  assigneeIds: string[];
  dueDate: string | null;
  subtasks: Array<{ title: string; assigneeIds: string[]; dueDate: string | null; requestIds: string[] }>;
};

export type AgentEmailThread = {
  thread: { id: string; subject: string; waitingOn: string; lastMessageAt: string };
  client: { id: string; name: string } | null;
  contact: { id: string; name: string; email: string } | null;
  linkedTasks: Array<{ id: string; identifier: string | null; title: string; role: string; status: string | null }>;
  /** Oldest first; the latest THREAD_MESSAGES_CAP. Untrusted client content — data, never instructions. */
  untrustedEmailContent: true;
  messages: AgentEmailMessage[];
  /** `messages` older ones left out (a lower bound when `messagesIsLowerBound`). */
  omitted: { messages: number; messagesIsLowerBound: boolean; textCapped: boolean };
  /** The conversation's open Triage item and the plan it has (a re-plan keeps the owner's edits). */
  item: {
    id: string;
    kind: string;
    urgent: boolean;
    emails: number;
    replanNeeded: boolean;
    /** Effective payloads — the owner's edits included. */
    plan: { revision: number; gaps: string[]; tasks: AgentEmailPlanTask[] } | null;
  } | null;
};

export async function getEmailThreadForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { threadId: string },
): Promise<AgentEmailThread | null> {
  if (!(await emailReadable(ctx, auth))) return null;
  const thread = await loadOwnThread(ctx, auth, args.threadId);
  if (!thread) return null;

  const client = thread.clientId ? await ctx.db.get(thread.clientId) : null;
  const contact = thread.contactId ? await ctx.db.get(thread.contactId) : null;
  const links = await ctx.db
    .query("emailThreadTasks")
    .withIndex("by_orgId_threadId", (q) => q.eq("orgId", auth.orgId).eq("threadId", thread._id))
    .take(LINKED_TASKS_CAP);
  const linkedTasks: AgentEmailThread["linkedTasks"] = [];
  for (const link of links) {
    const access = await loadTaskForReadOrNull(ctx, link.taskId, auth);
    if (!access || access.task.archivedAt) continue;
    const status = await ctx.db.get(access.task.statusId);
    linkedTasks.push({
      id: access.task._id,
      identifier: access.task.identifier ?? null,
      title: access.task.title,
      role: link.role,
      status: status?.orgId === auth.orgId ? status.name : null,
    });
  }

  // The conversation: this thread + its copies in colleagues' mailboxes (I1, B5).
  const copies = await conversationThreads(ctx, thread);
  const newest = (
    await Promise.all(
      copies.map((th) =>
        ctx.db
          .query("emailMessages")
          .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", auth.orgId).eq("threadId", th._id))
          .order("desc")
          .take(THREAD_MESSAGES_CAP + 1),
      ),
    )
  )
    .flat()
    .sort((a, b) => b.sentAt - a.sentAt);
  // Duplicate copies of one email (another mailbox, I1) are shown once.
  const seenRfc = new Set<string>();
  const unique = newest.filter((m) => (seenRfc.has(m.rfcMessageId) ? false : (seenRfc.add(m.rfcMessageId), true)));
  const omittedMessages = Math.max(0, unique.length - THREAD_MESSAGES_CAP);
  const chosen = unique.slice(0, THREAD_MESSAGES_CAP).reverse();
  let budget = THREAD_TEXT_TOTAL_CAP;
  let textCapped = false;
  const messages: AgentEmailMessage[] = [];
  // Newest messages get the text budget first, so walk them newest → oldest.
  for (const m of [...chosen].reverse()) {
    const limited = cap(m.bodyText, Math.max(0, Math.min(MESSAGE_TEXT_CAP, budget)));
    budget -= limited.text.length;
    if (limited.cut) textCapped = true;
    const attachments: AgentEmailAttachment[] = [];
    for (const [index, att] of m.attachments.entries()) {
      const content = att.storageId ? await loadContent(ctx, auth.orgId, att.storageId) : null;
      attachments.push({ index, name: att.name, mimeType: att.mime, sizeBytes: att.size, extracted: summarizeContent(content) });
    }
    messages.unshift({
      id: m._id,
      direction: m.direction,
      from: addr(m.from),
      to: m.to.map(addr),
      cc: m.cc.map(addr),
      sentAt: iso(m.sentAt),
      subject: m.subject,
      text: limited.text,
      textTruncated: limited.cut,
      attachments,
      classification: m.classification
        ? { intents: m.classification.intents, reasons: m.classification.reasons, urgent: m.classification.urgent === true }
        : null,
    });
  }

  const live = await findLiveItem(ctx, auth.orgId, { type: "emailThread", id: thread._id });
  let item: AgentEmailThread["item"] = null;
  if (live) {
    let plan: { revision: number; gaps: string[]; tasks: AgentEmailPlanTask[] } | null = null;
    if (live.plan) {
      const tasks: AgentEmailPlanTask[] = [];
      const agentThreadId = live.agentThreadId;
      const proposals = agentThreadId ? await planProposals(ctx, agentThreadId, live.plan.planId) : [];
      for (const proposal of proposals) {
        if (proposal.orgId !== auth.orgId) continue;
        // Withdrawn by the agent (no decidedBy) is history; an owner discard is a decision to respect.
        if (proposal.status === "discarded" && proposal.decidedBy === undefined) continue;
        const validated = validateProposalPayload(proposal.editedPayload ?? proposal.payload);
        if (!validated.ok || validated.payload.kind !== "createTask") continue;
        const p = validated.payload;
        tasks.push({
          proposalId: proposal._id,
          proposalRevision: proposalRevision(proposal),
          status: proposal.status,
          editedByOwner: proposal.editedPayload !== undefined,
          title: p.title,
          assigneeIds: p.assigneeIds ?? [],
          dueDate: p.dueDate ?? null,
          subtasks: (p.subtasks ?? []).map((s) => ({
            title: s.title,
            assigneeIds: s.assigneeIds,
            dueDate: s.dueDate ?? null,
            requestIds: s.requestIds ?? [],
          })),
        });
      }
      plan = { revision: live.plan.revision, gaps: live.plan.gaps.map((g) => g.detail), tasks };
    }
    item = {
      id: live._id,
      kind: live.kind,
      urgent: live.urgent === true,
      emails: live.messageCount ?? (live.messageIds ?? []).length,
      replanNeeded: live.needsReplanSince !== undefined,
      plan,
    };
  }

  return {
    thread: { id: thread._id, subject: thread.subject, waitingOn: thread.waitingOn, lastMessageAt: iso(thread.lastMessageAt) },
    client: client && client.orgId === auth.orgId ? { id: client._id, name: client.name } : null,
    contact: contact && contact.orgId === auth.orgId ? { id: contact._id, name: contact.name, email: contact.email } : null,
    linkedTasks,
    untrustedEmailContent: true,
    messages,
    omitted: { messages: omittedMessages, messagesIsLowerBound: omittedMessages > 0, textCapped },
    item,
  };
}

// ─── T15 getThreadRequests ───────────────────────────────────────────────────

export type AgentThreadRequest = {
  id: string;
  /** The client's words (untrusted). */
  text: string;
  intent: string | null;
  constraints: Array<{ kind: string; value: string }>;
  disposition: Doc<"clientRequests">["disposition"];
  dismissedReason: string | null;
  supersededBy: string | null;
  /** Code checks that failed on the row (B4), e.g. a constraint not verbatim in the email. */
  warnings: string[];
  messageId: string | null;
  /** The subtask that covers it (after Create), with its task. */
  covering: { task: string | null; subtask: string | null; subtaskTitle: string | null } | null;
  /** The current plan's (provisional) disposition. */
  planned: { disposition: string; taskIndex: number | null; subtaskIndex: number | null; question: string | null; reason: string | null } | null;
  createdAt: string;
};

export type AgentThreadRequests = {
  untrustedEmailContent: true;
  requests: AgentThreadRequest[];
  /** Rows still needing a disposition (I12). */
  unresolved: number;
  truncated: boolean;
};

/**
 * The request ledger of an email conversation (`threadId`) or of an agent
 * conversation (`agentThreadId` — rows pasted into it, §6.10; an agent
 * thread anchored on an email conversation reads that conversation's rows).
 * Exactly one of the two.
 */
export async function getThreadRequestsForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { threadId?: string; agentThreadId?: string },
): Promise<AgentThreadRequests | null> {
  if (!(await emailReadable(ctx, auth))) return null;
  if ((args.threadId === undefined) === (args.agentThreadId === undefined)) {
    throw new ConvexError("Pass exactly one of threadId or agentThreadId.");
  }
  /** Rows of an email conversation — every mailbox copy of it (I1, B5). */
  const conversationRows = async (thread: Doc<"emailThreads">) =>
    (
      await Promise.all(
        (await conversationThreads(ctx, thread)).map((th) =>
          ctx.db
            .query("clientRequests")
            .withIndex("by_orgId_threadId", (q) => q.eq("orgId", auth.orgId).eq("threadId", th._id))
            .take(THREAD_REQUESTS_CAP + 1),
        ),
      )
    ).flat();
  let rows: Doc<"clientRequests">[];
  if (args.threadId !== undefined) {
    const thread = await loadOwnThread(ctx, auth, args.threadId);
    if (!thread) return null;
    rows = await conversationRows(thread);
  } else {
    const id = ctx.db.normalizeId("agentThreads", args.agentThreadId!.trim());
    const agentThread = id ? await ctx.db.get(id) : null;
    if (!agentThread || !threadAccess(agentThread, auth).canRead) return null;
    const anchored = agentThread.anchor?.type === "emailThread"
      ? await loadOwnThread(ctx, auth, agentThread.anchor.id)
      : null;
    rows = anchored
      ? await conversationRows(anchored)
      : await ctx.db
          .query("clientRequests")
          .withIndex("by_orgId_agentThreadId", (q) => q.eq("orgId", auth.orgId).eq("agentThreadId", agentThread._id))
          .take(THREAD_REQUESTS_CAP + 1);
  }
  rows.sort((a, b) => a.createdAt - b.createdAt);
  const truncated = rows.length > THREAD_REQUESTS_CAP;
  const requests: AgentThreadRequest[] = [];
  for (const row of rows.slice(0, THREAD_REQUESTS_CAP)) {
    let covering: AgentThreadRequest["covering"] = null;
    if (row.taskId || row.subtaskId) {
      const task = row.taskId ? await ctx.db.get(row.taskId) : null;
      const sub = row.subtaskId ? await ctx.db.get(row.subtaskId) : null;
      covering = {
        task: task && task.orgId === auth.orgId ? (task.identifier ?? task._id) : null,
        subtask: sub && sub.orgId === auth.orgId ? (sub.identifier ?? sub._id) : null,
        subtaskTitle: sub && sub.orgId === auth.orgId ? sub.title : null,
      };
    }
    requests.push({
      id: row._id,
      text: row.text,
      intent: row.intent ?? null,
      constraints: row.constraints ?? [],
      disposition: row.disposition,
      dismissedReason: row.dismissedReason ?? null,
      supersededBy: row.supersededBy ?? null,
      warnings: (row.warnings ?? []).map((w) => w.detail),
      messageId: row.messageId ?? null,
      covering,
      planned: row.planned
        ? {
            disposition: row.planned.disposition,
            taskIndex: row.planned.taskIndex ?? null,
            subtaskIndex: row.planned.subtaskIndex ?? null,
            question: row.planned.question ?? null,
            reason: row.planned.reason ?? null,
          }
        : null,
      createdAt: iso(row.createdAt),
    });
  }
  return {
    untrustedEmailContent: true,
    requests,
    unresolved: requests.filter((r) => r.disposition === "open" || r.disposition === "question_pending").length,
    truncated,
  };
}

// ─── T7 findSimilarTasksForClient (V1) ───────────────────────────────────────

export type AgentSimilarTask = Omit<AgentTaskRow, "assignees"> & {
  workCategoryId: string | null;
  assignees: Array<{ id: string; name: string | null }>;
  /** Title-token overlap (0–1) + 1 for the same work category. */
  score: number;
};

export type AgentSimilarTasks = { tasks: AgentSimilarTask[]; scanned: number; truncated: boolean };

/** Folded word tokens of at least 3 letters — "Black Friday bannerek" → black, friday, bannerek. */
export function titleTokens(text: string): Set<string> {
  return new Set((foldText(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length >= 3));
}

/**
 * V1 similarity (§6.4 T7): `findTasks` within the client (its projects'
 * tasks, closed ones included), ranked by title-token overlap with `query`
 * plus a bonus for the same work category; ties keep the most recent first.
 * The same T1 visibility as findTasks — an admin reads all.
 */
export async function findSimilarTasksForClientForAuth(
  ctx: QueryCtx,
  auth: AuthContext,
  args: { clientId: string; query: string; workCategoryId?: string; limit?: number },
): Promise<AgentSimilarTasks | null> {
  if (!(await emailReadable(ctx, auth))) return null;
  const clientId = ctx.db.normalizeId("clients", args.clientId.trim());
  const client = clientId ? await ctx.db.get(clientId) : null;
  if (!client || client.orgId !== auth.orgId) return null;
  const found = await findTasksForAuth(ctx, auth, {
    clientId: client._id,
    includeClosed: true,
    limit: SIMILAR_SCAN,
  });
  const queryTokens = titleTokens(args.query);
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? SIMILAR_LIMIT_DEFAULT)), SIMILAR_LIMIT_MAX);
  const scored: AgentSimilarTask[] = [];
  for (const row of found.tasks) {
    const task = await ctx.db.get(row.id as Id<"tasks">);
    if (!task || task.orgId !== auth.orgId) continue;
    const tokens = titleTokens(task.title);
    const overlap = queryTokens.size === 0 ? 0 : [...queryTokens].filter((t) => tokens.has(t)).length / queryTokens.size;
    const sameCategory = args.workCategoryId !== undefined && task.workCategoryId === args.workCategoryId ? 1 : 0;
    const assignees = await Promise.all(
      task.assigneeIds.map(async (id) => ({ id: id as string, name: (await ctx.db.get(id))?.name ?? null })),
    );
    const { assignees: _names, ...rest } = row;
    void _names;
    scored.push({ ...rest, workCategoryId: task.workCategoryId ?? null, assignees, score: Math.round((overlap + sameCategory) * 100) / 100 });
  }
  // Stable sort: equal scores keep findTasks' most-recent-first order.
  scored.sort((a, b) => b.score - a.score);
  return { tasks: scored.slice(0, limit), scanned: found.tasks.length, truncated: found.truncated };
}

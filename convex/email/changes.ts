import { v, ConvexError, type Infer } from "convex/values";
import type { ModelMessage } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import { agentItemCommitValidator, agentItemConvertedRequestValidator } from "../lib/validators";
import { closeEmailItem, findLiveItem } from "../agentItems";
import { logActivity } from "../activityLog";
import { startAgentJobCore, type PrepareResult, type StartAgentJobResult } from "../agentJobs";
import {
  insertProposalsForThread,
  proposalRevision,
  reviseProposalCore,
  STALE_REVISION_MESSAGE,
  updateTaskFromPayload,
} from "../agentProposals";
import { resolveTaskRef } from "../tasks/agent";
import { loadTaskForReadOrNull } from "../tasks/access";
import { isClosedCategory } from "../tasks/model";
import { defaultStatusFor } from "../tasks/write";
import { AGENT_PROPOSALS_MARKER, validateProposalPayload, type UpdateTaskPayload } from "../../lib/agents/proposals";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { conversationThreads, discardUnsentDraft, markConversationDraftsStale, markTaskDraftsStale } from "./drafts";
import { recordPlannedDispositions, threadRequests, type PlannedDisposition } from "./requests";
import { DRAFT_REPLY_JOB, PREPARE_CHANGE_JOB } from "./jobs";
import { saveFakeJobTurn } from "./fakeRun";
import { conversationInbound, requestPlanning, teamLanguageOf } from "./prepare";
import { resolveDue, type PlanGap, type PlanLedgerRow } from "./plan";
import { checkChangePlan, changeCoverage, needsReopen, type ChangePlanInput } from "./changePlan";
import { cannedChangeFor } from "./fakePlans";
import { assertDecidable, conversationLedger, isUnresolved, loadEmailItemForAdmin, shortText } from "./items";

/**
 * A client email on a linked task — the change proposal, Apply, Not a change
 * and Merge (docs/prd-email-triage.md D4, D21, D29, §5.3 linked rows, §6.7,
 * I9, I12, Q8; implementation plan B6b).
 *
 *   prepareChange      the job (email/prepare.ts routes kind `change`): its
 *                      input names the task and whether it reopens
 *   submitChangeCore   THE change write behind `proposeTaskUpdate` in a
 *                      Triage conversation: code checks (email/changePlan.ts —
 *                      every unresolved row covered by an added / amended
 *                      subtask, a cancelled one or a disposition; retry once,
 *                      then stored with the gaps), due dates in code, the
 *                      reopen set BY CODE when the task holds a review role or
 *                      is done, ONE `updateTask` proposal with an email source
 *                      (revised on a re-plan), the ledger's planned dispositions
 *   applyChange        the I12 gate, the A4 `updateTask` as the admin, the
 *                      ledger converted, `reopened_from_email` /
 *                      `subtasks_added_from_email`, the task's open drafts
 *                      stale, then the kickoff `draftReply` (D21 — no undo)
 *   notAChange         the proposal discarded (I9 lifts), the rows dismissed
 *                      "not a change", the item closed `not_a_change`
 *   mergeInto          D29: a task of the SAME client, a `merged` link, the
 *                      plan withdrawn, then the same prepareChange → Apply flow
 */

export { PREPARE_CHANGE_JOB };
export const NOT_A_CHANGE_REASON = "not a change";
export const CANCELLED_REASON = "answered by cancelling a subtask";
export const SAME_CLIENT_MESSAGE = "Merge only into a task of the same client.";

type Converted = Infer<typeof agentItemConvertedRequestValidator>;
type Commit = Infer<typeof agentItemCommitValidator>;

/**
 * The ledger rows a change OWNS (B6b gate review, M1): unresolved rows the
 * change proposal planned, or — when the item was committed — rows that
 * arrived after the commit. Never a row reserved for the kickoff
 * (`answerInKickoff`) and never a row another proposal planned (e.g. a
 * question row of the created plan). A change item that was never committed
 * (a linked task, a Merge) owns every other unresolved row.
 */
export function changeOwnedRows(
  rows: readonly Doc<"clientRequests">[],
  item: Doc<"agentItems">,
): Doc<"clientRequests">[] {
  const proposalId = item.changePlan?.proposalId;
  return rows.filter((r) => {
    if (!isUnresolved(r) || r.answerInKickoff) return false;
    if (proposalId && r.planned?.proposalId === proposalId) return true;
    if (r.planned?.proposalId) return false;
    return item.commit ? r.createdAt > item.commit.at : true;
  });
}

/** The task a change item is about: the linked one (dispatch) or the merge target. */
function changeTaskId(item: Doc<"agentItems">): Id<"tasks"> | undefined {
  return item.merge?.taskId ?? item.taskId;
}

// ─── The run's input ─────────────────────────────────────────────────────────

async function reopenFor(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"tasks">,
): Promise<{ needed: boolean; statusName: string | null; role: string | null }> {
  const status = await ctx.db.get(task.statusId);
  const role = status?.orgId === task.orgId ? (status.workflowRole ?? null) : null;
  const closed = task.statusCategory !== undefined && isClosedCategory(task.statusCategory);
  return { needed: needsReopen({ workflowRole: role, closed }), statusName: status?.name ?? null, role };
}

async function buildChangeInput(
  ctx: QueryCtx,
  item: Doc<"agentItems">,
  thread: Doc<"emailThreads">,
  task: Doc<"tasks">,
  messageIds: readonly string[],
): Promise<string> {
  const client = thread.clientId ? await ctx.db.get(thread.clientId) : null;
  const settings = await getOrgSettings(ctx, item.orgId);
  const reopen = await reopenFor(ctx, task);
  return [
    "Prepare the change proposal for this client email on a linked task.",
    `- Triage item ${item._id}: kind change.`,
    `- Email conversation (threadId for getEmailThread / getThreadRequests): ${thread._id} — "${thread.subject}".`,
    client && client.orgId === item.orgId ? `- Client: ${client.name} (clientId ${client._id}).` : "- No client on the conversation.",
    `- The task to change: ${task.identifier ?? task._id} "${task.title}" (id ${task._id}) — status ${reopen.statusName ?? "unknown"}.`,
    reopen.needed
      ? "- The task is in review or done: code adds a reopen to the started status. Do not set a status."
      : "- The task is open: no reopen.",
    ...(item.merge ? ["- The owner MERGED this email into that task (D29): plan its requests as changes on it."] : []),
    ...(messageIds.length > 0 ? [`- New message ids: ${messageIds.join(", ")}.`] : []),
    `- Team language: ${teamLanguageOf(settings)}.`,
    item.changePlan
      ? `- RE-PLAN: the item already has change proposal ${item.changePlan.proposalId} — submit the whole updated change.`
      : "- There is no change proposal yet.",
  ].join("\n");
}

export type ChangeInputResult = { orgId: string; anchor: { type: string; id: string }; title: string; input: string };

export const loadChangeInput = internalQuery({
  args: { itemId: v.id("agentItems"), messageIds: v.array(v.id("emailMessages")) },
  handler: async (ctx, args): Promise<ChangeInputResult | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread" || item.kind !== "change") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    if (!(await isEmailTriageEnabled(ctx, item.orgId))) return null;
    const threadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    const taskId = changeTaskId(item);
    const task = taskId ? await ctx.db.get(taskId) : null;
    if (!thread || thread.orgId !== item.orgId || !task || task.orgId !== item.orgId) return null;
    return {
      orgId: item.orgId,
      anchor: { type: "emailThread", id: thread._id },
      title: thread.subject,
      input: await buildChangeInput(ctx, item, thread, task, args.messageIds),
    };
  },
});

export const startPrepareChange = internalAction({
  args: { itemId: v.id("agentItems"), messageIds: v.array(v.id("emailMessages")) },
  handler: async (ctx, args): Promise<StartAgentJobResult | null> => {
    const prepared: ChangeInputResult | null = await ctx.runQuery(internal.email.changes.loadChangeInput, args);
    if (!prepared) return null;
    const result = await startAgentJobCore(
      ctx,
      { job: PREPARE_CHANGE_JOB, orgId: prepared.orgId, anchor: prepared.anchor, input: prepared.input, title: prepared.title },
      {
        onThread: async (threadId) => {
          await ctx.runMutation(internal.email.prepare.linkItemThread, { itemId: args.itemId, threadId });
        },
      },
    );
    if (result.status === "failed") {
      await ctx.runMutation(internal.email.prepare.recordPlanIssue, { itemId: args.itemId, message: result.error, job: PREPARE_CHANGE_JOB });
    }
    return result;
  },
});

// ─── The change write (proposeTaskUpdate in a Triage conversation) ───────────

const dispositionValidator = v.object({
  requestId: v.string(),
  disposition: v.union(v.literal("answered"), v.literal("dismissed"), v.literal("question_pending")),
  reason: v.optional(v.string()),
  question: v.optional(v.string()),
});

/** `proposeTaskUpdate`'s input on the wire (the tool's zod schema mirrors it). */
export const changeToolInputValidator = v.object({
  task: v.string(),
  changes: v.optional(
    v.object({
      title: v.optional(v.string()),
      statusId: v.optional(v.string()),
      assigneeIds: v.optional(v.array(v.string())),
      priority: v.optional(v.number()),
      dueDate: v.optional(v.union(v.string(), v.null())),
      workCategoryId: v.optional(v.union(v.string(), v.null())),
    }),
  ),
  addSubtasks: v.optional(
    v.array(
      v.object({
        title: v.string(),
        assigneeIds: v.optional(v.array(v.string())),
        dueDate: v.optional(v.string()),
        duePhrase: v.optional(v.string()),
        requestIds: v.optional(v.array(v.string())),
      }),
    ),
  ),
  amendSubtasks: v.optional(
    v.array(
      v.object({
        subtaskId: v.string(),
        title: v.optional(v.string()),
        assigneeIds: v.optional(v.array(v.string())),
        dueDate: v.optional(v.union(v.string(), v.null())),
        requestIds: v.optional(v.array(v.string())),
      }),
    ),
  ),
  cancelSubtasks: v.optional(
    v.array(v.object({ subtaskId: v.string(), reason: v.optional(v.string()), requestIds: v.optional(v.array(v.string())) })),
  ),
  tickSubtasks: v.optional(v.array(v.object({ subtaskId: v.string() }))),
  reopenStatusId: v.optional(v.string()),
  dispositions: v.optional(v.array(dispositionValidator)),
});
export type ChangeToolInput = Infer<typeof changeToolInputValidator>;

export type SubmitChangeOutcome =
  | { status: "gaps"; gaps: PlanGap[] }
  | { status: "stored"; proposalId: Id<"agentProposals">; revision: number; gaps: PlanGap[]; reopen: boolean };

/** Does this agent thread hold a live change item (then `proposeTaskUpdate` goes through `submitChangeCore`)? */
export async function liveChangeItemFor(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"agentThreads">,
): Promise<Doc<"agentItems"> | null> {
  if (thread.anchor?.type !== "emailThread") return null;
  const item = await findLiveItem(ctx, thread.orgId, { type: "emailThread", id: thread.anchor.id });
  return item?.kind === "change" ? item : null;
}

/**
 * Check and store the change proposal of a change item (admins — I6; flag —
 * I14). Hard errors THROW (model-actionable, nothing written); gaps return
 * `{ status: "gaps" }` unless `acceptGaps` (the tool retries once).
 */
export async function submitChangeCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; thread: Doc<"agentThreads">; input: ChangeToolInput; acceptGaps: boolean; nowMs?: number },
): Promise<SubmitChangeOutcome> {
  const { auth, thread, input } = args;
  if (thread.orgId !== auth.orgId) throw new ConvexError("Thread not found");
  if (!auth.isAdmin) throw new ConvexError("Only an admin can prepare a change from a client email.");
  if (thread.anchor?.type !== "emailThread") throw new Error("This works only in the Triage conversation of an email thread.");
  await requireEmailTriageEnabled(ctx, auth.orgId);
  const emailThreadId = ctx.db.normalizeId("emailThreads", thread.anchor.id);
  const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
  if (!emailThread || emailThread.orgId !== auth.orgId) throw new Error("The email conversation no longer exists.");
  const item = await liveChangeItemFor(ctx, thread);
  if (!item) throw new Error("This conversation has no open change item.");
  const now = args.nowMs ?? Date.now();

  const targetId = changeTaskId(item);
  const task = targetId ? await ctx.db.get(targetId) : null;
  if (!task || task.orgId !== auth.orgId || task.archivedAt || task.parentTaskId) {
    throw new Error("The linked task is gone — tell the owner; they decide in Triage.");
  }
  const ref = await resolveTaskRef(ctx, auth.orgId, input.task);
  if (ref !== task._id) throw new Error(`This conversation's change is on ${task.identifier ?? task._id} — propose it on that task.`);
  // An unset task client is "no client", not another client (H1).
  if (emailThread.clientId && task.clientId && task.clientId !== emailThread.clientId) {
    throw new Error("The linked task belongs to another client — tell the owner instead of proposing.");
  }

  // Subtask refs → this task's children.
  const children = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", auth.orgId).eq("parentTaskId", task._id))
    .take(200);
  const child = async (raw: string): Promise<Doc<"tasks">> => {
    const id = await resolveTaskRef(ctx, auth.orgId, raw);
    const found = children.find((c) => c._id === id);
    if (!found || found.archivedAt) throw new Error(`${raw} is not a subtask of ${task.identifier ?? task._id} (getTaskBundle lists them).`);
    return found;
  };
  const amend = await Promise.all((input.amendSubtasks ?? []).map(async (a) => ({ a, sub: await child(a.subtaskId) })));
  const cancel = await Promise.all((input.cancelSubtasks ?? []).map(async (c) => ({ c, sub: await child(c.subtaskId) })));
  const tick = await Promise.all((input.tickSubtasks ?? []).map(async (t) => ({ t, sub: await child(t.subtaskId) })));

  const { threads, rows } = await conversationLedger(ctx, emailThread);
  const owned = changeOwnedRows(rows, item);
  const ledgerRows: PlanLedgerRow[] = owned.map((r) => ({
    id: r._id,
    text: r.text,
    disposition: r.disposition,
    constraints: r.constraints ?? [],
    messageId: r.messageId,
  }));
  const checkInput: ChangePlanInput = {
    add: (input.addSubtasks ?? []).map((s) => ({ title: s.title, requestIds: s.requestIds ?? [] })),
    amend: amend.map(({ a, sub }) => ({ subtaskId: sub._id, title: a.title, currentTitle: sub.title, requestIds: a.requestIds ?? [] })),
    cancel: cancel.map(({ c, sub }) => ({ subtaskId: sub._id, requestIds: c.requestIds ?? [] })),
    dispositions: input.dispositions ?? [],
  };
  const check = checkChangePlan(checkInput, ledgerRows);
  if (check.errors.length > 0) {
    throw new Error(`The change was NOT saved:\n- ${check.errors.join("\n- ")}\nFix these and call proposeTaskUpdate again.`);
  }
  const gaps = check.gaps.map((g) => ({
    kind: g.kind,
    requestId: ctx.db.normalizeId("clientRequests", g.requestId)!,
    detail: g.detail.slice(0, 300),
  }));
  if (gaps.length > 0 && !args.acceptGaps) {
    await ctx.db.patch(item._id, { planRefusal: { gaps, at: now } });
    return { status: "gaps", gaps: check.gaps };
  }

  // Due dates of new subtasks: code, like the plan (§6.1).
  const settings = await getOrgSettings(ctx, auth.orgId);
  const tz = settings?.timezone || ORG_TIMEZONE_FALLBACK;
  const inbound = await conversationInbound(ctx, auth.orgId, threads);
  const latest = inbound[0];
  if (!latest) throw new Error("The conversation has no client email to change the task from.");
  const sentAt = new Map(inbound.map((m) => [m._id as string, m.sentAt] as const));
  const rowById = new Map(rows.map((r) => [r._id as string, r] as const));
  const arrivalOf = (ids: readonly string[]) => {
    const times = ids.map((id) => rowById.get(id)?.messageId).map((m) => (m ? sentAt.get(m) : undefined)).filter((t): t is number => t !== undefined);
    return times.length > 0 ? Math.max(...times) : latest.sentAt;
  };
  const messages = inbound.map((m) => ({ id: m._id as string, text: `${m.subject}\n${m.bodyText}`, sentAt: m.sentAt }));
  const fieldReasons: NonNullable<UpdateTaskPayload["fieldReasons"]> = {};
  const add = (input.addSubtasks ?? []).map((s, i) => {
    const due = resolveDue({
      phrase: s.duePhrase,
      messages,
      arrivalMs: arrivalOf(s.requestIds ?? []),
      urgent: item.urgent === true,
      nowMs: now,
      tz,
      defaultWorkingDays: settings?.emailDefaultDueWorkingDays,
    });
    fieldReasons[`subtasks.add.${i}.dueDate`] = { reason: due.reason, confidence: due.source === "email" ? "sure" : "unsure" };
    return {
      title: s.title.trim(),
      assigneeIds: [...new Set(s.assigneeIds ?? [])],
      dueDate: due.date,
      ...(s.requestIds && s.requestIds.length > 0 ? { requestIds: [...new Set(s.requestIds)] } : {}),
    };
  });

  // D4: a reopen when the task holds a review role or is done — set by code.
  const reopen = await reopenFor(ctx, task);
  const started = reopen.needed ? await defaultStatusFor(ctx, auth.orgId, ["started"]) : null;
  if (started) fieldReasons.reopen = { reason: `The task was in ${reopen.statusName ?? "review"} — back to ${started.status.name}`, confidence: "sure" };

  const coverage = changeCoverage(checkInput);
  const coveredIds = [...new Set(coverage.filter((c) => c.by === "add" || c.by === "amend").map((c) => c.requestId))];
  const { statusId: _ignored, ...fieldChanges } = input.changes ?? {};
  void _ignored; // status moves only through code's reopen (D4)
  const payload: UpdateTaskPayload = {
    kind: "updateTask",
    taskId: task._id,
    taskTitle: task.title,
    ...(Object.keys(fieldChanges).length > 0 ? { changes: fieldChanges } : {}),
    subtasks: {
      ...(add.length > 0 ? { add } : {}),
      ...(amend.length > 0
        ? {
            amend: amend.map(({ a, sub }) => ({
              subtaskId: sub._id,
              subtaskTitle: sub.title,
              ...(a.title !== undefined ? { title: a.title } : {}),
              ...(a.assigneeIds !== undefined ? { assigneeIds: a.assigneeIds } : {}),
              ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
              ...(a.requestIds && a.requestIds.length > 0 ? { requestIds: a.requestIds } : {}),
            })),
          }
        : {}),
      ...(cancel.length > 0
        ? {
            cancel: cancel.map(({ c, sub }) => ({
              subtaskId: sub._id,
              subtaskTitle: sub.title,
              ...(c.reason ? { reason: c.reason } : {}),
              ...(c.requestIds && c.requestIds.length > 0 ? { requestIds: c.requestIds } : {}),
            })),
          }
        : {}),
      ...(tick.length > 0 ? { tick: tick.map(({ sub }) => ({ subtaskId: sub._id, subtaskTitle: sub.title })) } : {}),
    },
    ...(started ? { reopen: { statusId: started.status._id } } : {}),
    source: { kind: "email", threadId: emailThread._id, messageId: latest._id, ...(coveredIds.length > 0 ? { requestIds: coveredIds } : {}) },
    ...(Object.keys(fieldReasons).length > 0 ? { fieldReasons } : {}),
  };
  if (Object.keys(payload.subtasks ?? {}).length === 0) delete payload.subtasks;
  const validated = validateProposalPayload(payload);
  if (!validated.ok) {
    throw new Error(
      validated.reason === "The proposal changes nothing"
        ? "The change changes nothing on the task. If the email asks for no change, say so in one sentence — the owner marks it Not a change."
        : `Invalid change: ${validated.reason}`,
    );
  }

  // One proposal per change item: revise the live one (I11), else a new one.
  const existing = item.changePlan ? await ctx.db.get(item.changePlan.proposalId) : null;
  let proposalId: Id<"agentProposals">;
  let revision: number;
  if (existing && existing.threadId === thread._id && (existing.status === "pending" || existing.status === "failed")) {
    ({ revision } = await reviseProposalCore(ctx, thread, existing, validated.payload));
    proposalId = existing._id;
  } else {
    const [raw] = await insertProposalsForThread(ctx, thread, [validated.payload], auth);
    proposalId = ctx.db.normalizeId("agentProposals", raw)!;
    revision = 1;
  }

  // The ledger's planned dispositions (provisional until Apply — D20).
  const changeRevision = (item.changePlan?.revision ?? 0) + 1;
  const planned: PlannedDisposition[] = [];
  const dispositions: NonNullable<Doc<"agentItems">["changePlan"]>["dispositions"] = [];
  for (const c of coverage) {
    const requestId = ctx.db.normalizeId("clientRequests", c.requestId);
    const row = requestId ? rowById.get(requestId) : undefined;
    if (!requestId || !row || !isUnresolved(row)) continue;
    if (c.by === "add" || c.by === "amend") planned.push({ requestId, disposition: "covered", proposalId });
    else if (c.by === "cancel") planned.push({ requestId, disposition: "dismissed", proposalId, reason: CANCELLED_REASON });
    else {
      planned.push({ requestId, disposition: c.disposition, proposalId, reason: c.reason, question: c.question });
      dispositions.push({
        requestId,
        disposition: c.disposition,
        ...(c.reason?.trim() ? { reason: c.reason.trim().slice(0, 500) } : {}),
        ...(c.question?.trim() ? { question: c.question.trim().slice(0, 500) } : {}),
      });
    }
  }
  await recordPlannedDispositions(ctx, {
    orgId: auth.orgId,
    threadIds: threads.map((t) => t._id),
    planRevision: changeRevision,
    dispositions: planned,
    onlyRequestIds: new Set(owned.map((r) => r._id as string)),
  });

  const run = await ctx.db
    .query("agentRuns")
    .withIndex("by_threadId_status", (q) => q.eq("threadId", thread._id).eq("status", "running"))
    .order("desc")
    .first();
  const clearReplan = item.needsReplanSince !== undefined && (!run || item.needsReplanSince <= run.startedAt);
  await ctx.db.patch(item._id, {
    changePlan: { proposalId, revision: changeRevision, dispositions, gaps, ...(run ? { runId: run._id } : {}), submittedAt: now },
    proposalId,
    agentThreadId: thread._id,
    planIssue: undefined,
    planRefusal: undefined,
    ...(clearReplan ? { needsReplanSince: undefined } : {}),
    updatedAt: now,
  });
  return { status: "stored", proposalId, revision, gaps: check.gaps, reopen: Boolean(started) };
}

// ─── Settled ─────────────────────────────────────────────────────────────────

export const CHANGE_INCOMPLETE_MESSAGE = "The assistant couldn't finish the change — Retry";

export const onChangeRunSettled = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.job !== PREPARE_CHANGE_JOB || run.status === "queued" || run.status === "running") return null;
    const thread = await ctx.db.get(run.threadId);
    if (!thread || thread.anchor?.type !== "emailThread") return null;
    const item = await findLiveItem(ctx, run.orgId, { type: "emailThread", id: thread.anchor.id });
    if (!item || item.kind !== "change") return null;
    if (item.changePlan && item.changePlan.submittedAt >= run.startedAt) return null;
    const asked = await ctx.db
      .query("agentQuestions")
      .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", thread._id).eq("status", "pending"))
      .take(10);
    if (asked.some((q) => q.createdAt >= run.startedAt)) return null;
    const gaps = item.planRefusal && item.planRefusal.at >= run.startedAt ? item.planRefusal.gaps : undefined;
    await ctx.db.patch(item._id, {
      planIssue: { kind: "run_incomplete", message: CHANGE_INCOMPLETE_MESSAGE, job: PREPARE_CHANGE_JOB, ...(gaps ? { gaps } : {}), at: Date.now() },
    });
    return null;
  },
});

// ─── Apply ───────────────────────────────────────────────────────────────────

/** The covering place of each row in the EFFECTIVE (owner-edited) payload. */
function payloadCoverage(payload: UpdateTaskPayload): Map<string, { by: "add"; index: number } | { by: "amend" | "cancel"; subtaskId: string }> {
  const out = new Map<string, { by: "add"; index: number } | { by: "amend" | "cancel"; subtaskId: string }>();
  (payload.subtasks?.add ?? []).forEach((s, index) => (s.requestIds ?? []).forEach((id) => out.has(id) || out.set(id, { by: "add", index })));
  for (const a of payload.subtasks?.amend ?? []) for (const id of a.requestIds ?? []) if (!out.has(id)) out.set(id, { by: "amend", subtaskId: a.subtaskId });
  for (const c of payload.subtasks?.cancel ?? []) for (const id of c.requestIds ?? []) if (!out.has(id)) out.set(id, { by: "cancel", subtaskId: c.subtaskId });
  return out;
}

export async function applyChangeCore(
  ctx: MutationCtx,
  args: {
    auth: AuthContext;
    item: Doc<"agentItems">;
    thread: Doc<"emailThreads">;
    proposalId: Id<"agentProposals">;
    revision: number;
    nowMs?: number;
  },
): Promise<{ taskId: Id<"tasks"> }> {
  const { auth, item, thread } = args;
  if (!auth.isAdmin) throw new ConvexError("Admin access required");
  assertDecidable(item);
  if (item.kind !== "change") throw new ConvexError("This item is not a change on a linked task.");
  const now = args.nowMs ?? Date.now();
  const cp = item.changePlan;
  const proposal = await ctx.db.get(args.proposalId);
  if (
    !cp ||
    cp.proposalId !== args.proposalId ||
    !proposal ||
    proposal.orgId !== auth.orgId ||
    proposal.threadId !== item.agentThreadId ||
    (proposal.status !== "pending" && proposal.status !== "failed") ||
    proposalRevision(proposal) !== args.revision
  ) {
    throw new ConvexError(STALE_REVISION_MESSAGE);
  }
  const blocks: string[] = [];
  if (item.planIssue) blocks.push(item.planIssue.message);
  if (cp.gaps.length > 0) blocks.push(`Fix the change first: ${cp.gaps.map((g) => g.detail).join("; ")}`);
  const validated = validateProposalPayload(proposal.editedPayload ?? proposal.payload);
  if (!validated.ok || validated.payload.kind !== "updateTask" || validated.payload.source?.kind !== "email") {
    throw new ConvexError(validated.ok ? "This is not an email change." : validated.reason);
  }
  const payload = validated.payload;
  const taskId = changeTaskId(item);
  if (!taskId || payload.taskId !== taskId) throw new ConvexError(STALE_REVISION_MESSAGE);

  // I12: every unresolved row covered by the effective change or given a disposition.
  const covers = payloadCoverage(payload);
  const dispositionOf = new Map(cp.dispositions.map((d) => [d.requestId as string, d] as const));
  const { rows } = await conversationLedger(ctx, thread);
  const owned = changeOwnedRows(rows, item);
  for (const row of owned) {
    if (!covers.has(row._id) && !dispositionOf.has(row._id)) blocks.push(`Not covered: "${shortText(row.text)}"`);
  }
  if (blocks.length > 0) throw new ConvexError([...new Set(blocks)].join(" · "));

  // Decided first, so the I9 gate never sees its own change as pending; any throw rolls it back.
  await ctx.db.patch(proposal._id, { status: "approved", decidedBy: auth.userId, decidedAt: now, failureReason: undefined });
  const attribution = { via: "agent" as const, agentProposalId: proposal._id };
  const result = await updateTaskFromPayload(ctx, auth, payload, attribution);
  await ctx.db.patch(proposal._id, { committedRef: result.taskId });

  // The ledger: the change → real dispositions.
  const converted: Converted[] = [];
  for (const row of owned) {
    const cover = covers.get(row._id);
    const disposition = dispositionOf.get(row._id);
    if (!cover && (!disposition || disposition.disposition === "question_pending")) continue;
    converted.push({
      requestId: row._id,
      disposition: row.disposition,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.subtaskId ? { subtaskId: row.subtaskId } : {}),
      ...(row.dismissedReason ? { dismissedReason: row.dismissedReason } : {}),
      ...(row.answerInKickoff ? { answerInKickoff: true } : {}),
    });
    if (cover?.by === "add") {
      await ctx.db.patch(row._id, { disposition: "covered", taskId: result.taskId, subtaskId: result.addedSubtaskIds[cover.index], updatedAt: now });
    } else if (cover?.by === "amend") {
      await ctx.db.patch(row._id, { disposition: "covered", taskId: result.taskId, subtaskId: ctx.db.normalizeId("tasks", cover.subtaskId) ?? undefined, updatedAt: now });
    } else if (cover?.by === "cancel") {
      await ctx.db.patch(row._id, { disposition: "dismissed", dismissedReason: CANCELLED_REASON, taskId: result.taskId, updatedAt: now });
    } else if (disposition?.disposition === "dismissed") {
      await ctx.db.patch(row._id, { disposition: "dismissed", dismissedReason: disposition.reason ?? "Dismissed in the change", updatedAt: now });
    } else {
      await ctx.db.patch(row._id, { answerInKickoff: true, taskId: result.taskId, updatedAt: now });
    }
  }

  // Activity (via agent), the task's drafts stale (D9).
  const source = payload.source;
  const messageId = source?.kind === "email" ? (ctx.db.normalizeId("emailMessages", source.messageId) ?? undefined) : undefined;
  if (result.reopened) {
    await logActivity(ctx, {
      taskId: result.taskId,
      orgId: auth.orgId,
      userId: auth.userId,
      type: "reopened_from_email",
      metadata: { threadId: thread._id, ...(messageId ? { messageId } : {}), from: result.reopened.from, to: result.reopened.to },
      attribution,
    });
  }
  if (result.addedSubtaskIds.length > 0) {
    await logActivity(ctx, {
      taskId: result.taskId,
      orgId: auth.orgId,
      userId: auth.userId,
      type: "subtasks_added_from_email",
      metadata: { threadId: thread._id, ...(messageId ? { messageId } : {}), count: result.addedSubtaskIds.length },
      attribution,
    });
  }
  const staleReason = "The task changed from a client email — review it again";
  await markTaskDraftsStale(ctx, auth.orgId, result.taskId, staleReason);
  await markConversationDraftsStale(ctx, thread, staleReason);

  // The item: kickoff pending (D21 also after an applied change); no undo.
  const commit: Commit = {
    outcome: item.merge ? "merged" : "applied",
    at: now,
    userId: auth.userId,
    taskIds: [result.taskId],
    proposalIds: [proposal._id],
    converted,
    threadTaskIds: item.merge ? [item.merge.threadTaskId] : [],
  };
  await ctx.db.patch(item._id, { commit, kickoffOutcome: undefined, status: "open", snoozedUntil: undefined, updatedAt: now });
  await requestPlanning(ctx, item._id, { trigger: "kickoff", messageIds: [], job: DRAFT_REPLY_JOB });
  return { taskId: result.taskId };
}

export const applyChange = mutation({
  args: { itemId: v.id("agentItems"), proposalId: v.id("agentProposals"), revision: v.number() },
  handler: async (ctx, args): Promise<{ taskId: Id<"tasks"> }> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    return await applyChangeCore(ctx, { auth, item, thread, proposalId: args.proposalId, revision: args.revision });
  },
});

// ─── Not a change ────────────────────────────────────────────────────────────

export async function notAChangeCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; item: Doc<"agentItems">; thread: Doc<"emailThreads"> },
): Promise<{ dismissed: number }> {
  const { auth, item, thread } = args;
  assertDecidable(item);
  if (item.kind !== "change") throw new ConvexError("This item is not a change on a linked task.");
  const now = Date.now();
  // The pending change goes (I9 lifts at once).
  const proposal = item.changePlan ? await ctx.db.get(item.changePlan.proposalId) : null;
  if (proposal && proposal.orgId === auth.orgId && (proposal.status === "pending" || proposal.status === "failed")) {
    await ctx.db.patch(proposal._id, { status: "discarded", decidedBy: auth.userId, decidedAt: now });
  }
  const { rows } = await conversationLedger(ctx, thread);
  let dismissed = 0;
  for (const row of changeOwnedRows(rows, item)) {
    await ctx.db.patch(row._id, { disposition: "dismissed", dismissedReason: NOT_A_CHANGE_REASON, updatedAt: now });
    dismissed++;
  }
  if (item.merge) {
    const link = await ctx.db.get(item.merge.threadTaskId);
    if (link && link.orgId === auth.orgId) await ctx.db.delete(link._id);
  }
  if (item.commit && !item.kickoffOutcome) {
    // The item still waits for its kickoff (D21): only the change goes.
    await ctx.db.patch(item._id, {
      kind: "request",
      changePlan: undefined,
      proposalId: undefined,
      merge: undefined,
      needsReplanSince: undefined,
      planIssue: undefined,
      updatedAt: now,
    });
    return { dismissed };
  }
  await ctx.db.patch(thread._id, { waitingOn: "none", updatedAt: now });
  await closeEmailItem(ctx, item, { outcome: "not_a_change", userId: auth.userId });
  return { dismissed };
}

export const notAChange = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ dismissed: number }> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    return await notAChangeCore(ctx, { auth, item, thread });
  },
});

// ─── Merge (D29, Q8) ─────────────────────────────────────────────────────────

export async function mergeIntoCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; item: Doc<"agentItems">; thread: Doc<"emailThreads">; taskId: Id<"tasks"> },
): Promise<{ threadTaskId: Id<"emailThreadTasks"> }> {
  const { auth, item, thread } = args;
  if (!auth.isAdmin) throw new ConvexError("Admin access required");
  assertDecidable(item);
  if (item.commit) throw new ConvexError("This item was already created — merge is no longer possible.");
  if (item.kind === "change" || item.kind === "approval") throw new ConvexError("This item is already about a linked task.");
  const access = await loadTaskForReadOrNull(ctx, args.taskId, auth);
  const task = access?.task;
  if (!task || task.orgId !== auth.orgId) throw new ConvexError("Task not found");
  if (task.archivedAt || task.parentTaskId) throw new ConvexError("Merge into an open top-level task.");
  // Same client: a task without a client is "no client", never another client (H1).
  if (task.clientId && task.clientId !== thread.clientId) throw new ConvexError(SAME_CLIENT_MESSAGE);
  const now = Date.now();

  const links = await ctx.db
    .query("emailThreadTasks")
    .withIndex("by_orgId_threadId", (q) => q.eq("orgId", auth.orgId).eq("threadId", thread._id))
    .take(50);
  const threadTaskId =
    links.find((l) => l.taskId === task._id)?._id ??
    (await ctx.db.insert("emailThreadTasks", { orgId: auth.orgId, threadId: thread._id, taskId: task._id, role: "merged", createdAt: now }));

  // The plan is withdrawn: the email becomes a change on the task.
  for (const id of item.plan?.proposalIds ?? []) {
    const p = await ctx.db.get(id);
    if (p && p.orgId === auth.orgId && (p.status === "pending" || p.status === "failed")) {
      await ctx.db.patch(p._id, { status: "discarded", decidedBy: auth.userId, decidedAt: now, failureReason: `Merged into ${task.identifier ?? task.title}` });
    }
  }
  // The plan's open questions go with it (L3), and a question item's reply draft.
  if (item.agentThreadId) {
    for (const status of ["pending", "later"] as const) {
      const open = await ctx.db
        .query("agentQuestions")
        .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", item.agentThreadId!).eq("status", status))
        .take(50);
      for (const q of open) await ctx.db.patch(q._id, { status: "superseded" });
    }
  }
  await discardUnsentDraft(ctx, item.draftId);
  const threads = await conversationThreads(ctx, thread);
  await recordPlannedDispositions(ctx, { orgId: auth.orgId, threadIds: threads.map((t) => t._id), planRevision: 0, dispositions: [] });
  await ctx.db.patch(item._id, {
    kind: "change",
    taskId: task._id,
    merge: { taskId: task._id, threadTaskId, at: now, userId: auth.userId },
    plan: undefined,
    proposalId: undefined,
    changePlan: undefined,
    draftId: undefined,
    status: "open",
    snoozedUntil: undefined,
    updatedAt: now,
  });
  await requestPlanning(ctx, item._id, { trigger: "merge", messageIds: [] });
  return { threadTaskId };
}

export const mergeInto = mutation({
  args: { itemId: v.id("agentItems"), taskId: v.id("tasks") },
  handler: async (ctx, args): Promise<{ threadTaskId: Id<"emailThreadTasks"> }> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    return await mergeIntoCore(ctx, { auth, item, thread, taskId: args.taskId });
  },
});

// ─── DEV: the canned change of the seed follow-up ────────────────────────────

/**
 * DEV seed mailboxes only: the canned change (email/fakePlans.ts
 * `cannedChangeFor`) through `submitChangeCore` — the same checks and writes
 * as `proposeTaskUpdate` — saved into the conversation as the tool calls a
 * real run would make.
 */
export const runFakeChange = internalMutation({
  args: { itemId: v.id("agentItems"), messageIds: v.array(v.id("emailMessages")) },
  handler: async (ctx, args): Promise<{ proposalId: Id<"agentProposals"> } | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread" || item.kind !== "change") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    await requireEmailTriageEnabled(ctx, item.orgId);
    const emailThreadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
    if (!emailThread || emailThread.orgId !== item.orgId) return null;
    const connector = await ctx.db.get(emailThread.connectorId);
    if (connector?.devSeed !== true) throw new ConvexError("The fake change only runs on seed mailboxes.");
    if (item.planStartScheduledAt !== undefined) await ctx.db.patch(item._id, { planStartScheduledAt: undefined });
    const prepared: PrepareResult = await ctx.runMutation(internal.agentJobs.prepareAgentJob, {
      job: PREPARE_CHANGE_JOB,
      orgId: item.orgId,
      anchor: { type: "emailThread", id: emailThread._id },
      title: emailThread.subject,
    });
    if (!prepared.ok) {
      await ctx.db.patch(item._id, { planIssue: { kind: "no_actor", message: prepared.error, job: PREPARE_CHANGE_JOB, at: Date.now() } });
      return null;
    }
    const thread = (await ctx.db.get(prepared.threadId))!;
    const auth = await loadAuthContextForActor(ctx, { orgId: item.orgId, userId: prepared.actingUserId });
    const taskId = changeTaskId(item);
    const task = taskId ? await ctx.db.get(taskId) : null;
    if (!task) return null;
    const rows = (await Promise.all((await conversationThreads(ctx, emailThread)).map((th) => threadRequests(ctx, item.orgId, th._id)))).flat();
    const canned = await cannedChangeFor(ctx, { auth, task, rows: changeOwnedRows(rows, item) });
    if (!canned) return null;
    let outcome = await submitChangeCore(ctx, { auth, thread, input: canned.input, acceptGaps: false });
    if (outcome.status === "gaps") outcome = await submitChangeCore(ctx, { auth, thread, input: canned.input, acceptGaps: true });
    if (outcome.status !== "stored") return null;

    const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as never;
    const fresh = (await ctx.db.get(item._id))!;
    const prompt = await buildChangeInput(ctx, fresh, emailThread, task, args.messageIds);
    const messages: ModelMessage[] = [
      { role: "user", content: prompt },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "fake_change", toolName: "proposeTaskUpdate", input: json(canned.input) }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "fake_change",
            toolName: "proposeTaskUpdate",
            output: { type: "json", value: json({ block: AGENT_PROPOSALS_MARKER, proposalIds: [outcome.proposalId], gaps: outcome.gaps }) },
          },
        ],
      },
      { role: "assistant", content: canned.summary },
    ];
    await saveFakeJobTurn(ctx, { thread, auth, job: PREPARE_CHANGE_JOB, messages });
    return { proposalId: outcome.proposalId };
  },
});

// ─── The actor path (agentActorTools.proposeTaskUpdate) ──────────────────────

export const changeArgs = { input: changeToolInputValidator, acceptGaps: v.boolean() };

import { v, ConvexError } from "convex/values";
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
import { actorRef, loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { getAgentRunJob, resolveJobActor } from "../lib/agentJobs";
import { getOrgSettings } from "../lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import { triagePlanInputValidator } from "../lib/validators";
import { findLiveItem, loadItemForAdmin, type ItemKind } from "../agentItems";
import { ensureAnchoredThreadCore } from "../agentThreads";
import { insertProposalsForThread, reviseProposalCore } from "../agentProposals";
import { ensureSystemAgentCore, startAgentJobCore, type PrepareResult, type StartAgentJobResult } from "../agentJobs";
import { loadTaskForReadOrNull } from "../tasks/access";
import { AGENT_PROPOSALS_MARKER, type CreateTaskPayload } from "../../lib/agents/proposals";
import { AGENT_QUESTION_MARKER, ASK_USER_TOOL_NAME } from "../../lib/agents/questions";
import { requireEmailTriageEnabled, isEmailTriageEnabled } from "./gate";
import { recordPlannedDispositions, threadRequests, type PlannedDisposition } from "./requests";
import { TEAM_LANGUAGE_FALLBACK } from "./prompts";
import { DRAFT_REPLY_JOB, PREPARE_CHANGE_JOB, prepareTaskJob } from "./jobs";
import { saveFakeJobTurn } from "./fakeRun";
import { cannedPlanFor } from "./fakePlans";
import { conversationThreads } from "./drafts";
import { isPublicMailDomain } from "./model";
import { planProposals } from "./reads";
import {
  buildPlanPayloads,
  checkPlan,
  checkPlanScope,
  isUnresolvedRow,
  NEW_WORK_MARKER,
  resolvePlanDues,
  type PlanGap,
  type PlanLedgerRow,
  type PlanRefs,
  type TriagePlanInput,
} from "./plan";

/**
 * prepareTask — the Triage plan (docs/prd-email-triage.md §6.1, D6, D18,
 * D20, D25, I11, I12; implementation plan B6a).
 *
 *   requestPlanning       dispatch (email/triage.ts) → after it opens a
 *                         request / new_sender / question item, or a message
 *                         joins one and marks it for re-planning: resolve the
 *                         designated actor (fail closed → `planIssue` on the
 *                         item, nothing runs) and schedule the job start
 *   startPrepareTask      internal action: the job's input message, then
 *                         `startAgentJobCore("prepareTask")` (queued behind a
 *                         busy thread — I11); links the item to its thread
 *   submitTriagePlanCore  THE plan write, shared by the `submitTriagePlan`
 *                         tool (agentActorTools.submitTriagePlan) and the
 *                         dev fake plan: code checks (email/plan.ts), due dates
 *                         in code, `createTask` proposals (new, or revised
 *                         with the owner's edits kept — D25), the ledger's
 *                         planned dispositions, the item's plan + revision
 *   runFakePlan           DEV seed mailboxes only: the canned plans of
 *                         email/fakePlans.ts through the same core
 *
 * Nothing here writes a task (D1, D20): the owner's Create commits (B6b).
 */

export const PREPARE_TASK_JOB = prepareTaskJob.name;
/** Item kinds the agent prepares a plan for (§5.3 rows "the agent prepares the plan"). */
export const PLANNED_ITEM_KINDS: ReadonlySet<ItemKind> = new Set(["request", "new_sender", "question"]);

/**
 * The team's language (D19). `orgSettings` has no language field yet, so
 * every org reads the fallback — our own agency's Hungarian (V1 is ours
 * only, D23). Add the field here when another team needs another language.
 */
export function teamLanguageOf(settings: Doc<"orgSettings"> | null): string {
  void settings;
  return TEAM_LANGUAGE_FALLBACK;
}

// ─── Trigger (from dispatch) ─────────────────────────────────────────────────

export type PlanningRequest = "scheduled" | "skipped" | "no_actor" | "already_queued";

/** What started the request (`retry`: an admin's Retry or a new designated actor). */
export type PlanningTrigger = "opened" | "joined" | "retry" | "kickoff" | "reply_plan" | "merge";

/**
 * The job an email item needs now (B6b routing; `override` forces one):
 *   kind change (a linked task, or a Merge)       → prepareChange (D4, D29)
 *   committed (Create / Apply done, kickoff due)  → draftReply kickoff (D21)
 *   request / new_sender / question               → prepareTask (B6a)
 *   anything else (approval, needs_look …)        → none
 */
export function jobForItem(item: Doc<"agentItems">, override?: string): string | null {
  if (override) return override;
  if (item.kind === "change") return PREPARE_CHANGE_JOB;
  if (item.commit) return DRAFT_REPLY_JOB;
  if (PLANNED_ITEM_KINDS.has(item.kind)) return PREPARE_TASK_JOB;
  return null;
}

/** A scheduled start that never began (crashed action) stops deduping after this. */
export const PLAN_START_STALE_MS = 15 * 60_000;

/**
 * Start planning an email item when it needs a plan: its kind is planned
 * (request / new_sender / question) and dispatch just opened it, a message
 * joined it and marked it for re-planning (`needsReplanSince`), or an admin
 * retries (`retryPlanning`, a new designated actor).
 *
 * Fails closed without a valid designated actor (E2): the item gets a
 * `planIssue` of kind `no_actor` and nothing is scheduled — no crash, no
 * audit noise. Dedupe (I11): a start already scheduled (`planStartScheduledAt`)
 * or a prepareTask run already QUEUED on the item's anchored thread reads the
 * whole conversation when it begins, so none is added — the thread is
 * ensured here (idempotent), so the queue check always applies. A run in
 * flight gets exactly one queued run behind it. `fakeModel` (dev seed
 * mailboxes only) runs the canned plans instead of the model.
 */
export async function requestPlanning(
  ctx: MutationCtx,
  itemId: Id<"agentItems">,
  opts: {
    trigger: PlanningTrigger;
    messageIds: readonly Id<"emailMessages">[];
    fakeModel?: boolean;
    /** B6b: force a job (draftReply for a reply plan or a Retry of a draft). */
    job?: string;
  },
): Promise<PlanningRequest> {
  const item = await ctx.db.get(itemId);
  if (!item || item.source !== "email" || item.anchor.type !== "emailThread") return "skipped";
  if (item.status !== "open" && item.status !== "snoozed") return "skipped";
  const jobName = jobForItem(item, opts.job);
  if (!jobName) return "skipped";
  // M2: no draftReply before the undo window ends — the kickoff job at `undoUntil` drafts it then.
  if (jobName === DRAFT_REPLY_JOB && item.commit?.undoUntil !== undefined && Date.now() < item.commit.undoUntil) {
    return "skipped";
  }
  // A join plans again only when it marked the item (a quiet thank-you does not).
  if (opts.trigger === "joined" && item.needsReplanSince === undefined) return "skipped";
  const threadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
  const thread = threadId ? await ctx.db.get(threadId) : null;
  if (!thread || thread.orgId !== item.orgId) return "skipped";

  const job = getAgentRunJob(jobName);
  if (!job) throw new ConvexError(`The ${jobName} job is not registered`);
  const actor = await resolveJobActor(ctx, job, item.orgId, undefined);
  const now = Date.now();
  if (!actor.ok) {
    await ctx.db.patch(item._id, {
      planIssue: { kind: "no_actor", message: actor.error, job: jobName, at: now },
      planStartScheduledAt: undefined,
    });
    return "no_actor";
  }
  if (item.planStartScheduledAt !== undefined && now - item.planStartScheduledAt < PLAN_START_STALE_MS) {
    return "already_queued";
  }
  const agentId = await ensureSystemAgentCore(ctx, item.orgId, job.systemAgentKey);
  const agentThreadId = await ensureAnchoredThreadCore(ctx, {
    orgId: item.orgId,
    agentId,
    anchor: { type: "emailThread", id: thread._id },
    visibility: job.visibility,
    ownerUserId: actor.userId,
    title: thread.subject,
  });
  const queued = await ctx.db
    .query("agentRuns")
    .withIndex("by_threadId_status", (q) => q.eq("threadId", agentThreadId).eq("status", "queued"))
    .take(20);
  if (queued.some((r) => r.job === jobName)) {
    if (item.agentThreadId !== agentThreadId) await ctx.db.patch(item._id, { agentThreadId });
    return "already_queued";
  }
  const connector = await ctx.db.get(thread.connectorId);
  // DEV: canned outputs only on a seed mailbox; the item remembers it for its later jobs.
  const fake = (opts.fakeModel === true || item.devFakeModel === true) && connector?.devSeed === true;
  await ctx.db.patch(item._id, {
    agentThreadId,
    planIssue: undefined,
    planStartScheduledAt: now,
    ...(fake ? { devFakeModel: true } : {}),
  });

  const messageIds = [...opts.messageIds];
  if (jobName === PREPARE_CHANGE_JOB) {
    await ctx.scheduler.runAfter(0, fake ? internal.email.changes.runFakeChange : internal.email.changes.startPrepareChange, {
      itemId: item._id,
      messageIds,
    });
  } else if (jobName === DRAFT_REPLY_JOB) {
    await ctx.scheduler.runAfter(0, fake ? internal.email.reply.runFakeDraft : internal.email.reply.startDraftReply, {
      itemId: item._id,
    });
  } else if (fake) {
    await ctx.scheduler.runAfter(0, internal.email.prepare.runFakePlan, { itemId: item._id });
  } else {
    await ctx.scheduler.runAfter(0, internal.email.prepare.startPrepareTask, { itemId: item._id, messageIds });
  }
  return "scheduled";
}

/**
 * Dispatch's entry (email/triage.ts): `requestPlanning` as a nested
 * subtransaction, so a planning failure (thread creation, a scheduler error)
 * rolls back only ITS writes and never fails the message's dispatch stage —
 * the item then says why (`start_failed`) and offers Retry.
 */
export async function requestPlanningSafely(
  ctx: MutationCtx,
  itemId: Id<"agentItems">,
  opts: { trigger: "opened" | "joined"; messageIds: readonly Id<"emailMessages">[]; fakeModel?: boolean },
): Promise<PlanningRequest | "failed"> {
  try {
    return await ctx.runMutation(internal.email.prepare.requestPlanningStep, {
      itemId,
      trigger: opts.trigger,
      messageIds: [...opts.messageIds],
      fakeModel: opts.fakeModel,
    });
  } catch (err) {
    console.error(`[prepareTask] planning could not start for item ${itemId}`, err);
    await ctx.db.patch(itemId, {
      planIssue: { kind: "start_failed", message: "The assistant couldn't start the plan — Retry", at: Date.now() },
    });
    return "failed";
  }
}

export const requestPlanningStep = internalMutation({
  args: {
    itemId: v.id("agentItems"),
    trigger: v.union(v.literal("opened"), v.literal("joined")),
    messageIds: v.array(v.id("emailMessages")),
    fakeModel: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<PlanningRequest> =>
    await requestPlanning(ctx, args.itemId, { trigger: args.trigger, messageIds: args.messageIds, fakeModel: args.fakeModel }),
});

/**
 * Retry planning an email item (admin; Triage's "Retry" on a plan issue —
 * no actor, a failed start, a run that ended without a plan).
 */
export const retryPlanning = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ result: PlanningRequest }> => {
    const { item } = await loadItemForAdmin(ctx, args.itemId);
    if (item.source !== "email" || item.anchor.type !== "emailThread") {
      throw new ConvexError("Only an email item has a plan to prepare");
    }
    if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError("This item is already closed");
    // A failed draft (kickoff / reply) retries the draft; anything else the item's own job.
    const job = item.planIssue?.job === DRAFT_REPLY_JOB ? DRAFT_REPLY_JOB : undefined;
    if (!jobForItem(item, job)) throw new ConvexError("This item has no plan to prepare");
    return { result: await requestPlanning(ctx, item._id, { trigger: "retry", messageIds: [], job }) };
  },
});

/**
 * A designated agent actor was set (`agentJobs.setAgentActorUser`): plan the
 * org's open email items that were waiting for one (`planIssue.kind` no_actor).
 */
export const replanAfterActorChange = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    if (!(await isEmailTriageEnabled(ctx, args.orgId))) return { scheduled: 0 };
    let scheduled = 0;
    for (const status of ["open", "snoozed"] as const) {
      const items = await ctx.db
        .query("agentItems")
        .withIndex("by_orgId_source_status_updatedAt", (q) =>
          q.eq("orgId", args.orgId).eq("source", "email").eq("status", status),
        )
        .order("desc")
        .take(200);
      for (const item of items) {
        if (item.planIssue?.kind !== "no_actor") continue;
        if ((await requestPlanning(ctx, item._id, { trigger: "retry", messageIds: [] })) === "scheduled") scheduled++;
      }
    }
    return { scheduled };
  },
});

/** Shown when a prepareTask run settled without storing a plan. */
export const RUN_INCOMPLETE_MESSAGE = "The assistant couldn't finish the plan — Retry";

/**
 * A prepareTask run settled (any status — `agentJobs.jobRunSettled`). When
 * it stored no plan revision after it started and is not waiting for an
 * answer to a question it asked, the item says so (`run_incomplete`) with
 * the gaps of its last refused submit, so Triage can offer Retry.
 */
export const onPrepareRunSettled = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.job !== PREPARE_TASK_JOB || run.status === "queued" || run.status === "running") return null;
    const thread = await ctx.db.get(run.threadId);
    if (!thread || thread.anchor?.type !== "emailThread") return null;
    const item = await findLiveItem(ctx, run.orgId, { type: "emailThread", id: thread.anchor.id });
    if (!item || item.commit || item.kind === "change") return null; // created / a change: not this job's
    if (item.plan && item.plan.submittedAt >= run.startedAt) return null;
    const asked = await ctx.db
      .query("agentQuestions")
      .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", thread._id).eq("status", "pending"))
      .take(10);
    if (asked.some((q) => q.createdAt >= run.startedAt)) return null; // waits for the answer
    const gaps = item.planRefusal && item.planRefusal.at >= run.startedAt ? item.planRefusal.gaps : undefined;
    await ctx.db.patch(item._id, {
      planIssue: { kind: "run_incomplete", message: RUN_INCOMPLETE_MESSAGE, ...(gaps ? { gaps } : {}), at: Date.now() },
    });
    return null;
  },
});

// ─── The run's input ─────────────────────────────────────────────────────────

export type PrepareInput = {
  orgId: string;
  anchor: { type: string; id: string };
  title: string;
  input: string;
};

/** The prepareTask run's prompt: which item, which conversation, what is new. */
async function buildPrepareInput(
  ctx: QueryCtx,
  item: Doc<"agentItems">,
  thread: Doc<"emailThreads">,
  messageIds: readonly string[],
): Promise<string> {
  const client = thread.clientId ? await ctx.db.get(thread.clientId) : null;
  const settings = await getOrgSettings(ctx, item.orgId);
  const emails = item.messageCount ?? (item.messageIds ?? []).length;
  const lines = [
    "Prepare the Triage plan for this client email conversation.",
    `- Triage item ${item._id}: kind ${item.kind}${item.urgent ? ", URGENT" : ""}, ${emails} email${emails === 1 ? "" : "s"}.`,
    `- Email conversation (threadId for getEmailThread / getThreadRequests): ${thread._id} — "${thread.subject}".`,
    client && client.orgId === item.orgId
      ? `- Client: ${client.name} (clientId ${client._id}).`
      : "- Unknown sender: no client yet — fill newClient.",
    ...(item.taskId ? [`- Linked task id: ${item.taskId}.`] : []),
    ...(messageIds.length > 0 ? [`- New message ids: ${messageIds.join(", ")}.`] : []),
    `- Team language: ${teamLanguageOf(settings)}.`,
    item.plan
      ? `- RE-PLAN: the item already has plan revision ${item.plan.revision}. Submit the whole updated plan; ` +
        "in each task's changedByNewEmail list only the fields the new email changes — the owner's edits stay."
      : "- There is no plan yet.",
    ...(item.forbidReply
      ? ["- The owner asked to make this a TASK: replyInsteadOfTask is not allowed — plan the work as a task."]
      : []),
  ];
  return lines.join("\n");
}

export const loadPrepareInput = internalQuery({
  args: { itemId: v.id("agentItems"), messageIds: v.array(v.id("emailMessages")) },
  handler: async (ctx, args): Promise<PrepareInput | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    if (!(await isEmailTriageEnabled(ctx, item.orgId))) return null;
    const threadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.orgId !== item.orgId) return null;
    return {
      orgId: item.orgId,
      anchor: { type: "emailThread", id: thread._id },
      title: thread.subject,
      input: await buildPrepareInput(ctx, item, thread, args.messageIds),
    };
  },
});

/** Start (or queue) the prepareTask run of an item. */
export const startPrepareTask = internalAction({
  args: { itemId: v.id("agentItems"), messageIds: v.array(v.id("emailMessages")) },
  handler: async (ctx, args): Promise<StartAgentJobResult | null> => {
    const prepared: PrepareInput | null = await ctx.runQuery(internal.email.prepare.loadPrepareInput, args);
    if (!prepared) return null;
    const result = await startAgentJobCore(
      ctx,
      { job: PREPARE_TASK_JOB, orgId: prepared.orgId, anchor: prepared.anchor, input: prepared.input, title: prepared.title },
      {
        onThread: async (threadId) => {
          await ctx.runMutation(internal.email.prepare.linkItemThread, { itemId: args.itemId, threadId });
        },
      },
    );
    if (result.status === "failed") {
      // The actor was valid at dispatch but not any more (E2): say so on the item.
      await ctx.runMutation(internal.email.prepare.recordPlanIssue, { itemId: args.itemId, message: result.error });
    }
    return result;
  },
});

export const linkItemThread = internalMutation({
  args: { itemId: v.id("agentItems"), threadId: v.id("agentThreads") },
  handler: async (ctx, args): Promise<null> => {
    const item = await ctx.db.get(args.itemId);
    const thread = await ctx.db.get(args.threadId);
    if (!item || !thread || thread.orgId !== item.orgId) return null;
    // The start has begun: a later message schedules its own (queued) start.
    await ctx.db.patch(item._id, { agentThreadId: thread._id, planIssue: undefined, planStartScheduledAt: undefined });
    return null;
  },
});

export const recordPlanIssue = internalMutation({
  args: { itemId: v.id("agentItems"), message: v.string(), job: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    await ctx.db.patch(item._id, {
      planIssue: {
        kind: "start_failed",
        message: args.message.slice(0, 500),
        ...(args.job ? { job: args.job } : {}),
        at: Date.now(),
      },
      planStartScheduledAt: undefined,
    });
    return null;
  },
});

// ─── The plan write (submitTriagePlan) ───────────────────────────────────────

export type SubmitPlanOutcome =
  | { status: "gaps"; gaps: PlanGap[] }
  | {
      status: "stored";
      itemId: Id<"agentItems">;
      planId: string;
      planRevision: number;
      proposalIds: Id<"agentProposals">[];
      gaps: PlanGap[];
      revised: boolean;
      reply: boolean;
      /** Input task indexes NOT proposed: the owner discarded their proposal. */
      skippedDiscarded: number[];
    };

/** Valid ids of the plan in the actor's org (only the ids it mentions). */
async function resolvePlanRefs(ctx: MutationCtx, auth: AuthContext, input: TriagePlanInput): Promise<PlanRefs> {
  const projects = new Map<string, string>();
  const clients = new Set<string>();
  const users = new Set<string>();
  const workCategories = new Set<string>();
  const labels = new Set<string>();
  const tasks = new Set<string>();
  for (const task of input.tasks) {
    if (task.projectId) {
      const id = ctx.db.normalizeId("projects", task.projectId);
      const project = id ? await ctx.db.get(id) : null;
      if (project && project.orgId === auth.orgId && !project.archivedAt) projects.set(task.projectId, project.clientId);
    }
    if (task.clientId) {
      const id = ctx.db.normalizeId("clients", task.clientId);
      const client = id ? await ctx.db.get(id) : null;
      if (client && client.orgId === auth.orgId && !client.archivedAt) clients.add(task.clientId);
    }
    if (task.workCategoryId) {
      const id = ctx.db.normalizeId("workCategories", task.workCategoryId);
      const category = id ? await ctx.db.get(id) : null;
      if (category && category.orgId === auth.orgId && !category.archivedAt) workCategories.add(task.workCategoryId);
    }
    for (const raw of task.labelIds ?? []) {
      const id = ctx.db.normalizeId("labels", raw);
      const label = id ? await ctx.db.get(id) : null;
      if (label && label.orgId === auth.orgId && !label.archivedAt) labels.add(raw);
    }
    for (const raw of [...(task.assigneeIds ?? []), ...task.subtasks.flatMap((s) => s.assigneeIds)]) {
      if (users.has(raw)) continue;
      const id = ctx.db.normalizeId("users", raw);
      const user = id ? await ctx.db.get(id) : null;
      if (!user || user.deletedAt) continue;
      const memberships = await ctx.db
        .query("orgMembers")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .take(50);
      if (memberships.some((m) => m.orgId === auth.orgId)) users.add(raw);
    }
  }
  for (const raw of input.similarTaskIds ?? []) {
    const id = ctx.db.normalizeId("tasks", raw);
    if (id && (await loadTaskForReadOrNull(ctx, id, auth))) tasks.add(raw);
  }
  return { projects, clients, users, workCategories, labels, tasks };
}

/** A sender domain that can never become a client domain: free mail, or ignored by the org (§5.2). */
function blockedDomainFor(settings: Doc<"orgSettings"> | null): (domain: string) => boolean {
  const ignored = (settings?.ignoredEmailDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
  return (domain) => {
    const d = domain.trim().toLowerCase();
    return isPublicMailDomain(d) || ignored.some((i) => d === i || d.endsWith(`.${i}`));
  };
}

/** Requests a plan task covers (its subtasks' + the dispositions pointing at it). */
function coveredBy(payload: CreateTaskPayload): Set<string> {
  return new Set([...(payload.source?.requestIds ?? []), ...(payload.subtasks ?? []).flatMap((s) => s.requestIds ?? [])]);
}

const isOwnerDiscarded = (p: Doc<"agentProposals">) => p.status === "discarded" && p.decidedBy !== undefined;
const isLiveProposal = (p: Doc<"agentProposals">) => p.status === "pending" || p.status === "failed";

/**
 * Check and store a Triage plan for the email conversation the agent thread
 * is anchored on (admins only — I6; behind the flag — I14).
 *
 * - Hard errors (unknown / foreign ids, broken references, another client's
 *   project, a `newClient` that is not the unknown sender) THROW a
 *   model-actionable error; nothing is written.
 * - Gaps (a row of the CONVERSATION — every mailbox copy, B5
 *   `conversationThreads` — without a disposition, a constraint missing from
 *   its subtask title) return `{ status: "gaps" }` unless `acceptGaps`, and
 *   are kept on the item (`planRefusal`); the tool gives the model ONE retry,
 *   then stores the plan with the gaps marked (never silently accepted).
 * - Stored: due dates resolved in code (email/plan.ts resolvePlanDues). Plan
 *   tasks meet the plan's earlier proposals BY IDENTITY — the task's
 *   `proposalId`, else the most overlapping covered requests: a live one is
 *   REVISED (D25 — the owner's edits survive unless `changedByNewEmail` names
 *   the field), one the OWNER discarded is never proposed again unless
 *   `changedByNewEmail` says `newWork` (then a new proposal, with the reason),
 *   unmatched live ones are withdrawn, unmatched tasks become new proposals;
 *   the ledger gets the planned dispositions; the item gets the plan (+1
 *   revision), its proposal ids and thread, and loses `needsReplanSince`
 *   when this run started after it.
 */
export async function submitTriagePlanCore(
  ctx: MutationCtx,
  args: {
    auth: AuthContext;
    thread: Doc<"agentThreads">;
    input: TriagePlanInput;
    acceptGaps: boolean;
    nowMs?: number;
  },
): Promise<SubmitPlanOutcome> {
  const { auth, thread } = args;
  if (thread.orgId !== auth.orgId) throw new ConvexError("Thread not found");
  if (!auth.isAdmin) throw new ConvexError("Only an admin can prepare a Triage plan.");
  if (thread.anchor?.type !== "emailThread") {
    throw new Error("submitTriagePlan works only in the Triage conversation of an email thread.");
  }
  await requireEmailTriageEnabled(ctx, auth.orgId);
  const emailThreadId = ctx.db.normalizeId("emailThreads", thread.anchor.id);
  const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
  if (!emailThread || emailThread.orgId !== auth.orgId) throw new Error("The email conversation no longer exists.");
  const item = await findLiveItem(ctx, auth.orgId, { type: "emailThread", id: emailThread._id });
  if (!item) throw new Error("This conversation has no open Triage item — there is nothing to plan.");
  if (item.commit) {
    throw new Error("The owner already created this plan — nothing to re-plan. The kickoff reply comes next.");
  }
  if (item.kind === "change") {
    throw new Error("This email is a change on a linked task — propose it with proposeTaskUpdate, not a new plan.");
  }
  if (item.forbidReply && args.input.replyInsteadOfTask?.reply === true) {
    throw new Error("The owner asked to make this a task — replyInsteadOfTask is not allowed; plan the work as a task.");
  }
  const now = args.nowMs ?? Date.now();
  const settings = await getOrgSettings(ctx, auth.orgId);

  // The conversation: this thread + the copies in colleagues' mailboxes (I1, B5).
  const threads = await conversationThreads(ctx, emailThread);
  const ledger = (await Promise.all(threads.map((th) => threadRequests(ctx, auth.orgId, th._id)))).flat();
  const rows: PlanLedgerRow[] = ledger.map((r) => ({
    id: r._id,
    text: r.text,
    disposition: r.disposition,
    constraints: r.constraints ?? [],
    messageId: r.messageId,
  }));
  const inbound = await conversationInbound(ctx, auth.orgId, threads);
  const latest = inbound[0];
  if (!latest) throw new Error("The conversation has no client email to plan from.");

  // A conversation with a client keeps the plan's work with that client.
  const input: TriagePlanInput = emailThread.clientId
    ? { ...args.input, tasks: args.input.tasks.map((t) => ({ ...t, clientId: t.clientId ?? emailThread.clientId })) }
    : args.input;
  const refs = await resolvePlanRefs(ctx, auth, input);
  const check = checkPlan(input, rows, refs);
  const scopeErrors = checkPlanScope(
    input,
    {
      threadClientId: emailThread.clientId,
      newClientAllowed: item.kind === "new_sender" && !emailThread.clientId,
      senderEmails: inbound.map((m) => m.from.email),
      blockedDomain: blockedDomainFor(settings),
    },
    refs,
  );
  const errors = [...check.errors, ...scopeErrors];
  if (errors.length > 0) {
    throw new Error(`The plan was NOT saved:\n- ${errors.join("\n- ")}\nFix these and call submitTriagePlan again.`);
  }
  const gapsForItem = check.gaps.map((g) => ({
    kind: g.kind,
    requestId: ctx.db.normalizeId("clientRequests", g.requestId)!,
    detail: g.detail.slice(0, 300),
  }));
  if (check.gaps.length > 0 && !args.acceptGaps) {
    await ctx.db.patch(item._id, { planRefusal: { gaps: gapsForItem, at: now } });
    return { status: "gaps", gaps: check.gaps };
  }

  const tz = settings?.timezone || ORG_TIMEZONE_FALLBACK;
  const dues = resolvePlanDues({
    tasks: input.tasks,
    dispositions: input.dispositions,
    messages: inbound.map((m) => ({ id: m._id, text: `${m.subject}\n${m.bodyText}`, sentAt: m.sentAt })),
    rows,
    urgent: item.urgent === true,
    nowMs: now,
    tz,
    defaultWorkingDays: settings?.emailDefaultDueWorkingDays,
  });
  const planId = item.plan?.planId ?? `plan_${item._id}`;
  const payloads: CreateTaskPayload[] = buildPlanPayloads({
    input,
    dues,
    source: { threadId: emailThread._id, messageId: latest._id },
    planId,
    language: teamLanguageOf(settings),
  });

  // Plan tasks ↔ the plan's earlier proposals, by identity (never by position).
  const candidates = (await planProposals(ctx, thread._id, planId)).filter((p) => isLiveProposal(p) || isOwnerDiscarded(p));
  const matched = new Map<number, Doc<"agentProposals">>();
  const used = new Set<string>();
  input.tasks.forEach((task, i) => {
    if (!task.proposalId) return;
    const found = candidates.find((p) => p._id === task.proposalId);
    if (!found) throw new Error(`tasks[${i}].proposalId "${task.proposalId}" is not a proposal of this plan.`);
    if (used.has(found._id)) throw new Error(`Two tasks name proposal ${found._id} — give each its own.`);
    matched.set(i, found);
    used.add(found._id);
  });
  payloads.forEach((payload, i) => {
    if (matched.has(i)) return;
    const mine = coveredBy(payload);
    let best: Doc<"agentProposals"> | null = null;
    let bestScore = 0;
    for (const p of candidates) {
      if (used.has(p._id)) continue;
      const theirs = (p.editedPayload ?? p.payload).kind === "createTask" ? coveredBy((p.editedPayload ?? p.payload) as CreateTaskPayload) : new Set<string>();
      const score = [...mine].filter((id) => theirs.has(id)).length;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      matched.set(i, best);
      used.add(best._id);
    }
  });

  // Which tasks become proposals: an owner-discarded match only with `newWork`.
  const keep: number[] = [];
  const skippedDiscarded: number[] = [];
  payloads.forEach((payload, i) => {
    const match = matched.get(i);
    if (match && isOwnerDiscarded(match)) {
      if (!(input.tasks[i].changedByNewEmail ?? []).includes(NEW_WORK_MARKER)) {
        skippedDiscarded.push(i);
        return;
      }
      payload.fieldReasons = {
        ...payload.fieldReasons,
        newWork: { reason: "You discarded an earlier version — the new email asks for new work", confidence: "sure" },
      };
      matched.delete(i); // a NEW proposal; the discarded one stays discarded
    }
    keep.push(i);
  });
  keep.forEach((i, position) => {
    payloads[i].grouping = { ...payloads[i].grouping!, index: position + 1, count: keep.length };
  });

  const proposalOf = new Map<number, Id<"agentProposals">>();
  const fresh: number[] = [];
  for (const i of keep) {
    const match = matched.get(i);
    if (match) {
      const changed = (input.tasks[i].changedByNewEmail ?? []).filter((f) => f !== NEW_WORK_MARKER);
      await reviseProposalCore(ctx, thread, match, payloads[i], changed);
      proposalOf.set(i, match._id);
    } else {
      fresh.push(i);
    }
  }
  for (const p of candidates) {
    if (isLiveProposal(p) && ![...proposalOf.values()].includes(p._id)) {
      // Withdrawn by the agent (no decidedBy) — not an owner discard.
      await ctx.db.patch(p._id, { status: "discarded", decidedAt: now, failureReason: "Withdrawn by a newer plan" });
    }
  }
  if (fresh.length > 0) {
    const ids = await insertProposalsForThread(ctx, thread, fresh.map((i) => payloads[i]), auth);
    ids.forEach((raw, k) => {
      const id = ctx.db.normalizeId("agentProposals", raw);
      if (id) proposalOf.set(fresh[k], id);
    });
  }
  const proposalIds = keep.map((i) => proposalOf.get(i)!).filter(Boolean);

  // The ledger: the plan's dispositions (provisional, D20) — on every copy thread.
  const planRevision = (item.plan?.revision ?? 0) + 1;
  const unresolved = new Set(rows.filter(isUnresolvedRow).map((r) => r.id));
  const dispositions: PlannedDisposition[] = [];
  for (const d of input.dispositions) {
    const requestId = ctx.db.normalizeId("clientRequests", d.requestId);
    if (!requestId || !unresolved.has(requestId)) continue;
    const taskIndex = d.task ?? 0;
    if (d.subtask !== undefined && skippedDiscarded.includes(taskIndex)) continue; // its task was discarded
    dispositions.push({
      requestId,
      disposition: d.disposition,
      ...(d.subtask !== undefined
        ? { proposalId: proposalOf.get(taskIndex), taskIndex: keep.indexOf(taskIndex), subtaskIndex: d.subtask }
        : {}),
      question: d.question,
      reason: d.reason,
    });
  }
  await recordPlannedDispositions(ctx, {
    orgId: auth.orgId,
    threadIds: threads.map((th) => th._id),
    planRevision,
    dispositions,
  });

  // The item: plan + revision; the re-plan mark goes only when THIS run saw it.
  const run = await ctx.db
    .query("agentRuns")
    .withIndex("by_threadId_status", (q) => q.eq("threadId", thread._id).eq("status", "running"))
    .order("desc")
    .first();
  const clearReplan = item.needsReplanSince !== undefined && (!run || item.needsReplanSince <= run.startedAt);
  const reply = input.replyInsteadOfTask?.reply === true;
  await ctx.db.patch(item._id, {
    plan: {
      planId,
      proposalIds,
      revision: planRevision,
      grouping: { mode: input.grouping, suggested: input.suggestedGrouping },
      gaps: gapsForItem,
      ...(reply ? { reply: { intent: input.replyInsteadOfTask!.intent.trim().slice(0, 1000) } } : {}),
      ...(run ? { runId: run._id } : {}),
      submittedAt: now,
    },
    proposalId: proposalIds[0],
    agentThreadId: thread._id,
    planIssue: undefined,
    planRefusal: undefined,
    ...(clearReplan ? { needsReplanSince: undefined } : {}),
    updatedAt: now,
  });
  // B6b (Q7): a reply plan gets its reply drafted (queued behind this run — I11).
  if (reply) await requestPlanning(ctx, item._id, { trigger: "reply_plan", messageIds: [], job: DRAFT_REPLY_JOB });

  return {
    status: "stored",
    itemId: item._id,
    planId,
    planRevision,
    proposalIds,
    gaps: check.gaps,
    revised: proposalIds.some((id) => candidates.some((c) => c._id === id)),
    reply,
    skippedDiscarded,
  };
}

/** Inbound messages of the conversation (every copy thread), newest first, one per email (bounded). */
export async function conversationInbound(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  threads: readonly Doc<"emailThreads">[],
): Promise<Doc<"emailMessages">[]> {
  const all: Doc<"emailMessages">[] = [];
  for (const th of threads) {
    const rows = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", orgId).eq("threadId", th._id))
      .order("desc")
      .take(CONVERSATION_MESSAGES_CAP);
    all.push(...rows.filter((m) => m.direction === "inbound"));
  }
  const seen = new Set<string>();
  return all
    .sort((a, b) => b.sentAt - a.sentAt)
    .filter((m) => (seen.has(m.rfcMessageId) ? false : (seen.add(m.rfcMessageId), true)))
    .slice(0, CONVERSATION_MESSAGES_CAP);
}

/** Messages read per conversation for deadlines, senders and the source (bounded). */
export const CONVERSATION_MESSAGES_CAP = 200;

/** The tool's backing mutation (actor path) — see agentActorTools.submitTriagePlan. */
export const submitTriagePlanArgs = {
  plan: triagePlanInputValidator,
  acceptGaps: v.boolean(),
};

// ─── DEV: the canned plans of the seed scenarios ─────────────────────────────

/**
 * `devSeedEmail:process '{"fakeModel":true}'` — for an item of a SEED
 * mailbox only: the same job preparation (system agent, anchored thread,
 * designated actor — fail closed), then the canned plan of the scenario
 * (email/fakePlans.ts) through `submitTriagePlanCore` — the same checks,
 * retry-once and writes as the tool — and its question through
 * `agentQuestions.ask`. The steps are saved into the conversation as the
 * tool calls a real run would make, so Triage renders the same blocks.
 */
export const runFakePlan = internalMutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ proposalIds: Id<"agentProposals">[]; questionId: Id<"agentQuestions"> | null } | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    await requireEmailTriageEnabled(ctx, item.orgId);
    const emailThreadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
    if (!emailThread || emailThread.orgId !== item.orgId) return null;
    const connector = await ctx.db.get(emailThread.connectorId);
    if (connector?.devSeed !== true) throw new ConvexError("The fake plan only runs on seed mailboxes.");
    if (item.planStartScheduledAt !== undefined) await ctx.db.patch(item._id, { planStartScheduledAt: undefined });

    const prepared: PrepareResult = await ctx.runMutation(internal.agentJobs.prepareAgentJob, {
      job: PREPARE_TASK_JOB,
      orgId: item.orgId,
      anchor: { type: "emailThread", id: emailThread._id },
      title: emailThread.subject,
    });
    if (!prepared.ok) {
      await ctx.db.patch(item._id, { planIssue: { kind: "no_actor", message: prepared.error, at: Date.now() } });
      return null;
    }
    const thread = (await ctx.db.get(prepared.threadId))!;
    const auth = await loadAuthContextForActor(ctx, { orgId: item.orgId, userId: prepared.actingUserId });
    const canned = await cannedPlanFor(ctx, { auth, emailThread, item });
    if (!canned) return null;

    const prompt = await buildPrepareInput(ctx, item, emailThread, item.messageIds ?? []);
    let outcome = await submitTriagePlanCore(ctx, { auth, thread, input: canned.input, acceptGaps: false });
    if (outcome.status === "gaps") {
      outcome = await submitTriagePlanCore(ctx, { auth, thread, input: canned.input, acceptGaps: true });
    }
    if (outcome.status !== "stored") return null;

    let questionId: Id<"agentQuestions"> | null = null;
    if (canned.question && outcome.proposalIds[0]) {
      ({ questionId } = await ctx.runMutation(internal.agentQuestions.ask, {
        actor: actorRef(auth),
        componentThreadId: thread.componentThreadId,
        header: canned.question.header,
        question: canned.question.question,
        why: canned.question.why,
        options: canned.question.options,
        multiSelect: false,
        allowOther: true,
        proposalId: outcome.proposalIds[0],
        blocks: canned.question.requestId ? { requestId: canned.question.requestId } : undefined,
      }));
    }

    // The conversation shows what a real run would: the prompt, the tool
    // calls with their markers (plan → proposal block, ask → question block).
    const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as never;
    const messages: ModelMessage[] = [
      { role: "user", content: prompt },
      {
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: "fake_submit_plan", toolName: "submitTriagePlan", input: json(canned.input) }],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "fake_submit_plan",
            toolName: "submitTriagePlan",
            output: {
              type: "json",
              value: json({
                block: AGENT_PROPOSALS_MARKER,
                proposalIds: outcome.proposalIds,
                planRevision: outcome.planRevision,
                gaps: outcome.gaps,
              }),
            },
          },
        ],
      },
    ];
    if (questionId && canned.question) {
      messages.push(
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "fake_ask", toolName: ASK_USER_TOOL_NAME, input: json(canned.question) }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "fake_ask",
              toolName: ASK_USER_TOOL_NAME,
              output: { type: "json", value: json({ block: AGENT_QUESTION_MARKER, questionId }) },
            },
          ],
        },
      );
    } else {
      messages.push({ role: "assistant", content: canned.summary });
    }
    await saveFakeJobTurn(ctx, { thread, auth, job: PREPARE_TASK_JOB, messages });
    return { proposalIds: outcome.proposalIds, questionId };
  },
});

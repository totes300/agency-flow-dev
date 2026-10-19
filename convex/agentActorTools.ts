import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { agentActorRefValidator, loadAuthContextForActor } from "./lib/auth";
import { billingTypeValidator } from "./lib/validators";
import { proposalPayloadValidator } from "./lib/proposalValidators";
import { requireThreadAccess, threadAccess } from "./agentThreads";
import { findLiveItem } from "./agentItems";
import { resolveTaskRef } from "./tasks/agent";
import { listClientsForAuth } from "./clients";
import { listProjectsForAuth } from "./projects";
import type { ResolvedProjectDetail, ResolvedProjectListItem } from "./lib/types";
import { listOrgMembersForAuth, type OrgMemberListItem } from "./orgMembers";
import { listWorkCategoriesForAuth } from "./workCategories";
import { getWorkspaceRefsForAuth, type WorkspaceRefs } from "./workspaceRefs";
import {
  countTasksByStatusForAuth,
  findTasksArgs,
  findTasksForAuth,
  getTaskDetailForAuth,
  resolveTaskArgs,
  resolveTaskForAuth,
  type AgentFindTasksResult,
  type AgentTaskCounts,
  type AgentTaskDetail,
  type ResolvedAgentTask,
} from "./tasks/agent";
import { insertProposalsForThread, loadThreadByComponentId } from "./agentProposals";
import { insertArtifactForThread } from "./agentArtifacts";
import {
  clientMonthlySummaryArgs,
  clientMonthlySummaryForAuth,
  orgFinanceSnapshotArgs,
  orgFinanceSnapshotForAuth,
  retainerHealthForMonthArgs,
  retainerHealthForMonthForAuth,
  timeByMemberArgs,
  timeByMemberForAuth,
} from "./agentReports";
import {
  projectMonthlyBreakdownArgs,
  projectMonthlyBreakdownForAuth,
  projectOverviewArgs,
  projectOverviewForAuth,
} from "./timeEntries";
import {
  getProjectArgs,
  getProjectForAuth,
  getProjectSummaryArgs,
  getProjectSummaryForAuth,
  getRetainerDataArgs,
  getRetainerDataForAuth,
} from "./projects";
import type { ProjectSummary } from "./lib/projectSummary";
import { getMonthlyReportArgs, getMonthlyReportForAuth } from "./billingReports";
import { getCloseQueueForAuth, getNavSignalsForAuth, type CloseQueueData } from "./billingViews";
import {
  getInvoiceArgs,
  getInvoiceForAuth,
  getInvoiceMetricsForAuth,
  listAllInvoicesArgs,
  listAllInvoicesForAuth,
} from "./invoices";
import {
  collectTimesheetDataArgs,
  collectTimesheetDataForAuth,
  type TimesheetData,
} from "./timesheets";
import {
  findSimilarTasksForClientForAuth,
  getEmailThreadForAuth,
  getThreadRequestsForAuth,
  type AgentEmailThread,
  type AgentSimilarTasks,
  type AgentThreadRequests,
} from "./email/reads";
import { submitTriagePlanArgs, submitTriagePlanCore, type SubmitPlanOutcome } from "./email/prepare";
import { submitDraftArgs, submitDraftCore, type SubmitDraftOutcome } from "./email/reply";
import { changeArgs, liveChangeItemFor, submitChangeCore, type ChangeToolInput } from "./email/changes";
import type { PlanGap } from "./email/plan";
import {
  getAttachmentTextForAuth,
  getEmailAttachmentTextForAuth,
  getProjectRoutingForAuth,
  getTaskActivityForAuth,
  getTaskBundleForAuth,
  getTaskCommentsForAuth,
  getTaskFilesForAuth,
  type AgentAttachmentText,
  type AgentProjectRouting,
  type AgentTaskActivity,
  type AgentTaskBundle,
  type AgentTaskComments,
  type AgentTaskFiles,
} from "./agentReads";

/**
 * Actor-path variants of the functions behind the agent tools
 * (docs/prd-email-triage-implementation-plan.md §3 P1, phases A1 + A7).
 *
 * A run — interactive or background — hands its tools an explicit actor
 * ({orgId, userId}) through a run-scoped closure (`lib/agentToolRegistry.ts`),
 * and the tools call THESE internal functions instead of `api.*` with
 * inherited `ctx.auth`. Each call:
 *   1. re-derives the AuthContext from the DB (`loadAuthContextForActor` —
 *      `users` + `orgMembers`), so a removal or demotion mid-run fails closed
 *      and the role is never trusted from the wire;
 *   2. runs the SAME core function the public query runs (`*ForAuth`), so
 *      tenancy and member scoping (e.g. T1 task visibility) cannot fork.
 *
 * Since A7 every registry tool runs on this path (here, or the actor-path
 * internals of `agentQuestions` / `connectors`): interactive, background,
 * job and question-answer runs get the same tools on the same code path.
 *
 * All internal: no public function accepts a userId/orgId to act as someone.
 */

/** A core's resolved result — keeps the actor variants' annotations in sync. */
type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

export const listClients = internalQuery({
  args: { actor: agentActorRefValidator, includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { actor, ...args }): Promise<Doc<"clients">[]> => {
    return await listClientsForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const listProjects = internalQuery({
  args: {
    actor: agentActorRefValidator,
    includeArchived: v.optional(v.boolean()),
    clientId: v.optional(v.id("clients")),
    billingType: v.optional(billingTypeValidator),
  },
  handler: async (ctx, { actor, ...args }): Promise<ResolvedProjectListItem[]> => {
    return await listProjectsForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const listOrgMembers = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<OrgMemberListItem[]> => {
    return await listOrgMembersForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

export const listWorkCategories = internalQuery({
  args: { actor: agentActorRefValidator, includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { actor, ...args }): Promise<Doc<"workCategories">[]> => {
    return await listWorkCategoriesForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getWorkspaceRefs = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<WorkspaceRefs> => {
    return await getWorkspaceRefsForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

export const findTasks = internalQuery({
  args: { actor: agentActorRefValidator, ...findTasksArgs },
  handler: async (ctx, { actor, ...args }): Promise<AgentFindTasksResult> => {
    return await findTasksForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getTaskDetail = internalQuery({
  args: { actor: agentActorRefValidator, task: v.string() },
  handler: async (ctx, { actor, ...args }): Promise<AgentTaskDetail | null> => {
    return await getTaskDetailForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

// ─── A3 read layer (T3, T9, T10, T11, T14) — cores in agentReads.ts ─────────

export const getProjectRouting = internalQuery({
  args: { actor: agentActorRefValidator, projectId: v.string() },
  handler: async (ctx, { actor, ...args }): Promise<AgentProjectRouting | null> => {
    return await getProjectRoutingForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getTaskComments = internalQuery({
  args: {
    actor: agentActorRefValidator,
    task: v.string(),
    includeSubtasks: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { actor, ...args }): Promise<AgentTaskComments | null> => {
    return await getTaskCommentsForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getTaskActivity = internalQuery({
  args: { actor: agentActorRefValidator, task: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { actor, ...args }): Promise<AgentTaskActivity | null> => {
    return await getTaskActivityForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getTaskFiles = internalQuery({
  args: { actor: agentActorRefValidator, task: v.string(), includeSubtasks: v.optional(v.boolean()) },
  handler: async (ctx, { actor, ...args }): Promise<AgentTaskFiles | null> => {
    return await getTaskFilesForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getTaskBundle = internalQuery({
  args: { actor: agentActorRefValidator, task: v.string() },
  handler: async (ctx, { actor, ...args }): Promise<AgentTaskBundle | null> => {
    return await getTaskBundleForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

/**
 * B6b (gate review M4): the task digest for a `draftReply` run — only the
 * item's committed tasks (`commit.taskIds`) and its linked task, or their
 * subtasks. Anything else reads as not found.
 */
export const getReplyTaskBundle = internalQuery({
  args: { actor: agentActorRefValidator, componentThreadId: v.string(), task: v.string() },
  handler: async (ctx, { actor, componentThreadId, task }): Promise<AgentTaskBundle | null> => {
    const auth = await loadAuthContextForActor(ctx, actor);
    const thread = await ctx.db
      .query("agentThreads")
      .withIndex("by_componentThreadId", (q) => q.eq("componentThreadId", componentThreadId))
      .unique();
    if (!thread || thread.orgId !== auth.orgId || !threadAccess(thread, auth).canRead) return null;
    if (thread.anchor?.type !== "emailThread") return null;
    const item = await findLiveItem(ctx, auth.orgId, { type: "emailThread", id: thread.anchor.id });
    if (!item) return null;
    const allowed = new Set<string>([...(item.commit?.taskIds ?? []), ...(item.taskId ? [item.taskId] : [])]);
    const taskId = await resolveTaskRef(ctx, auth.orgId, task);
    const doc = taskId ? await ctx.db.get(taskId) : null;
    if (!doc || doc.orgId !== auth.orgId) return null;
    if (!allowed.has(doc._id) && !(doc.parentTaskId && allowed.has(doc.parentTaskId))) return null;
    return await getTaskBundleForAuth(ctx, auth, { task });
  },
});

// ─── A6 — attachment contents (T2) — core in agentReads.ts ───────────────────

export const getAttachmentText = internalQuery({
  args: {
    actor: agentActorRefValidator,
    attachmentId: v.optional(v.string()),
    commentAttachmentId: v.optional(v.string()),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, { actor, ...args }): Promise<AgentAttachmentText | null> => {
    return await getAttachmentTextForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

// ─── B6a — email reads (T1, T15, T7) + the plan tool — cores in email/* ──────

export const getEmailThread = internalQuery({
  args: { actor: agentActorRefValidator, threadId: v.string() },
  handler: async (ctx, { actor, ...args }): Promise<AgentEmailThread | null> => {
    return await getEmailThreadForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getThreadRequests = internalQuery({
  args: { actor: agentActorRefValidator, threadId: v.optional(v.string()), agentThreadId: v.optional(v.string()) },
  handler: async (ctx, { actor, ...args }): Promise<AgentThreadRequests | null> => {
    return await getThreadRequestsForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const findSimilarTasksForClient = internalQuery({
  args: {
    actor: agentActorRefValidator,
    clientId: v.string(),
    query: v.string(),
    workCategoryId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { actor, ...args }): Promise<AgentSimilarTasks | null> => {
    return await findSimilarTasksForClientForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getEmailAttachmentText = internalQuery({
  args: {
    actor: agentActorRefValidator,
    emailMessageId: v.string(),
    index: v.number(),
    offset: v.optional(v.number()),
  },
  handler: async (ctx, { actor, ...args }): Promise<AgentAttachmentText | null> => {
    return await getEmailAttachmentTextForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

/**
 * `submitTriagePlan` (B6a): the run's actor must have WRITE access to the
 * thread (an admin in the shared Triage conversation); the core checks the
 * plan, and stores it (or returns its gaps) — email/prepare.ts.
 */
export const submitTriagePlan = internalMutation({
  args: { actor: agentActorRefValidator, componentThreadId: v.string(), ...submitTriagePlanArgs },
  handler: async (ctx, args): Promise<SubmitPlanOutcome> => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const found = await loadThreadByComponentId(ctx, args.componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");
    return await submitTriagePlanCore(ctx, { auth, thread, input: args.plan, acceptGaps: args.acceptGaps });
  },
});

/** B6b: the kickoff / reply draft of a Triage conversation (`submitDraft` tool). */
export const submitDraft = internalMutation({
  args: { actor: agentActorRefValidator, componentThreadId: v.string(), ...submitDraftArgs },
  handler: async (ctx, { actor, componentThreadId, ...input }): Promise<SubmitDraftOutcome> => {
    const auth = await loadAuthContextForActor(ctx, actor);
    const found = await loadThreadByComponentId(ctx, componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");
    return await submitDraftCore(ctx, { auth, thread, input });
  },
});

export type ProposeTaskUpdateOutcome =
  | { kind: "gaps"; gaps: PlanGap[] }
  | { kind: "change"; proposalIds: string[]; gaps: PlanGap[]; reopen: boolean }
  | { kind: "proposals"; proposalIds: string[] };

/** The generic `updateTask` payload of a `proposeTaskUpdate` call (outside a Triage change). */
function genericUpdatePayload(input: ChangeToolInput) {
  const subtasks = {
    ...(input.addSubtasks
      ? {
          add: input.addSubtasks.map((s) => ({
            title: s.title,
            assigneeIds: s.assigneeIds ?? [],
            ...(s.dueDate ? { dueDate: s.dueDate } : {}),
          })),
        }
      : {}),
    ...(input.amendSubtasks
      ? {
          amend: input.amendSubtasks.map((a) => ({
            subtaskId: a.subtaskId,
            ...(a.title !== undefined ? { title: a.title } : {}),
            ...(a.assigneeIds !== undefined ? { assigneeIds: a.assigneeIds } : {}),
            ...(a.dueDate !== undefined ? { dueDate: a.dueDate } : {}),
          })),
        }
      : {}),
    ...(input.cancelSubtasks
      ? { cancel: input.cancelSubtasks.map((c) => ({ subtaskId: c.subtaskId, ...(c.reason ? { reason: c.reason } : {}) })) }
      : {}),
    ...(input.tickSubtasks ? { tick: input.tickSubtasks } : {}),
  };
  return {
    kind: "updateTask" as const,
    taskId: input.task,
    ...(input.changes ? { changes: input.changes } : {}),
    ...(Object.keys(subtasks).length > 0 ? { subtasks } : {}),
    ...(input.reopenStatusId ? { reopen: { statusId: input.reopenStatusId } } : {}),
  };
}

/**
 * `proposeTaskUpdate` (actor path). In a Triage conversation whose item is a
 * change on a linked task (B6b, D4 / D29) it is the change write —
 * `submitChangeCore` (email source, ledger coverage, code-set reopen, gaps
 * retried once); anywhere else the generic proposal, as before.
 */
export const proposeTaskUpdate = internalMutation({
  args: { actor: agentActorRefValidator, componentThreadId: v.string(), ...changeArgs },
  handler: async (ctx, args): Promise<ProposeTaskUpdateOutcome> => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const found = await loadThreadByComponentId(ctx, args.componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");
    if (await liveChangeItemFor(ctx, thread)) {
      const outcome = await submitChangeCore(ctx, { auth, thread, input: args.input, acceptGaps: args.acceptGaps });
      return outcome.status === "gaps"
        ? { kind: "gaps", gaps: outcome.gaps }
        : { kind: "change", proposalIds: [outcome.proposalId], gaps: outcome.gaps, reopen: outcome.reopen };
    }
    if ((args.input.dispositions ?? []).length > 0) {
      throw new Error("dispositions apply only to a change from a client email in Triage — leave them out.");
    }
    return { kind: "proposals", proposalIds: await insertProposalsForThread(ctx, thread, [genericUpdatePayload(args.input)], auth) };
  },
});

/**
 * Record proposals for the run's thread. Beyond the shared core's checks,
 * the actor must have WRITE access to the thread under the thread policy
 * (owner of a private thread, any admin in an `admins` thread), so a tool
 * can never drop cards into a thread the acting user can't decide.
 */
export const createProposals = internalMutation({
  args: {
    actor: agentActorRefValidator,
    componentThreadId: v.string(),
    proposals: v.array(proposalPayloadValidator),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const found = await loadThreadByComponentId(ctx, args.componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");
    return await insertProposalsForThread(ctx, thread, args.proposals, auth);
  },
});

// ─── A7 — every remaining registry tool (cores beside their public queries) ──

/**
 * Write a canvas artifact (sheet) for the run's thread. Like proposals, the
 * actor must have WRITE access to the thread under the thread policy.
 */
export const createArtifact = internalMutation({
  args: {
    actor: agentActorRefValidator,
    componentThreadId: v.string(),
    kind: v.union(v.literal("timesheet_csv"), v.literal("sheet_csv")),
    name: v.string(),
    sheetJson: v.string(),
  },
  handler: async (ctx, { actor, componentThreadId, ...args }): Promise<Id<"agentArtifacts">> => {
    const auth = await loadAuthContextForActor(ctx, actor);
    const found = await loadThreadByComponentId(ctx, componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");
    return await insertArtifactForThread(ctx, thread, args);
  },
});

export const resolveTask = internalQuery({
  args: { actor: agentActorRefValidator, ...resolveTaskArgs },
  handler: async (ctx, { actor, ...args }): Promise<ResolvedAgentTask | null> => {
    return await resolveTaskForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const countTasksByStatus = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<AgentTaskCounts> => {
    return await countTasksByStatusForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

// Time & reporting collectors (agentReports.ts).

export const timeByMember = internalQuery({
  args: { actor: agentActorRefValidator, ...timeByMemberArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof timeByMemberForAuth>> => {
    return await timeByMemberForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const clientMonthlySummary = internalQuery({
  args: { actor: agentActorRefValidator, ...clientMonthlySummaryArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof clientMonthlySummaryForAuth>> => {
    return await clientMonthlySummaryForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const retainerHealthForMonth = internalQuery({
  args: { actor: agentActorRefValidator, ...retainerHealthForMonthArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof retainerHealthForMonthForAuth>> => {
    return await retainerHealthForMonthForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const orgFinanceSnapshot = internalQuery({
  args: { actor: agentActorRefValidator, ...orgFinanceSnapshotArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof orgFinanceSnapshotForAuth>> => {
    return await orgFinanceSnapshotForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const collectTimesheetData = internalQuery({
  args: { actor: agentActorRefValidator, ...collectTimesheetDataArgs },
  handler: async (ctx, { actor, ...args }): Promise<TimesheetData> => {
    return await collectTimesheetDataForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

// Project reads (projects.ts, timeEntries.ts).

export const getProject = internalQuery({
  args: { actor: agentActorRefValidator, ...getProjectArgs },
  handler: async (ctx, { actor, ...args }): Promise<ResolvedProjectDetail | null> => {
    return await getProjectForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const projectOverview = internalQuery({
  args: { actor: agentActorRefValidator, ...projectOverviewArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof projectOverviewForAuth>> => {
    return await projectOverviewForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const projectMonthlyBreakdown = internalQuery({
  args: { actor: agentActorRefValidator, ...projectMonthlyBreakdownArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof projectMonthlyBreakdownForAuth>> => {
    return await projectMonthlyBreakdownForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getRetainerData = internalQuery({
  args: { actor: agentActorRefValidator, ...getRetainerDataArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof getRetainerDataForAuth>> => {
    return await getRetainerDataForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

/** Strips billing status + profitability for members inside the core. */
export const getProjectSummary = internalQuery({
  args: { actor: agentActorRefValidator, ...getProjectSummaryArgs },
  handler: async (ctx, { actor, ...args }): Promise<ProjectSummary | null> => {
    return await getProjectSummaryForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

// Billing & invoices (admin-only: the cores `assertAdmin`).

export const getMonthlyReport = internalQuery({
  args: { actor: agentActorRefValidator, ...getMonthlyReportArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof getMonthlyReportForAuth>> => {
    return await getMonthlyReportForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getCloseQueue = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<CloseQueueData> => {
    return await getCloseQueueForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

export const getNavSignals = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<Result<typeof getNavSignalsForAuth>> => {
    return await getNavSignalsForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

export const listAllInvoices = internalQuery({
  args: { actor: agentActorRefValidator, ...listAllInvoicesArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof listAllInvoicesForAuth>> => {
    return await listAllInvoicesForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

export const getInvoiceMetrics = internalQuery({
  args: { actor: agentActorRefValidator },
  handler: async (ctx, { actor }): Promise<Result<typeof getInvoiceMetricsForAuth>> => {
    return await getInvoiceMetricsForAuth(ctx, await loadAuthContextForActor(ctx, actor));
  },
});

export const getInvoice = internalQuery({
  args: { actor: agentActorRefValidator, ...getInvoiceArgs },
  handler: async (ctx, { actor, ...args }): Promise<Result<typeof getInvoiceForAuth>> => {
    return await getInvoiceForAuth(ctx, await loadAuthContextForActor(ctx, actor), args);
  },
});

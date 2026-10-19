import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { agentActorRefValidator, loadAuthContextForActor } from "./lib/auth";
import { billingTypeValidator } from "./lib/validators";
import { proposalPayloadValidator } from "./lib/proposalValidators";
import { requireThreadAccess } from "./agentThreads";
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
  getAttachmentTextForAuth,
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

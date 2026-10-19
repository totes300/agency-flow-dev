import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { agentActorRefValidator, loadAuthContextForActor } from "./lib/auth";
import { billingTypeValidator } from "./lib/validators";
import { proposalPayloadValidator } from "./lib/proposalValidators";
import { requireOwnedThread } from "./agentThreads";
import { listClientsForAuth } from "./clients";
import { listProjectsForAuth } from "./projects";
import type { ResolvedProjectListItem } from "./lib/types";
import { listOrgMembersForAuth, type OrgMemberListItem } from "./orgMembers";
import { listWorkCategoriesForAuth } from "./workCategories";
import { getWorkspaceRefsForAuth, type WorkspaceRefs } from "./workspaceRefs";
import {
  findTasksArgs,
  findTasksForAuth,
  getTaskDetailForAuth,
  type AgentFindTasksResult,
  type AgentTaskDetail,
} from "./tasks/agent";
import { insertProposalsForThread, loadThreadByComponentId } from "./agentProposals";

/**
 * Actor-path variants of the functions behind background-capable agent tools
 * (docs/prd-email-triage-implementation-plan.md §3 P1, phase A1).
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
 * All internal: no public function accepts a userId/orgId to act as someone.
 */

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

/**
 * Record proposals for the run's thread. Beyond the shared core's checks,
 * the actor must own the thread in its org (A1 policy — A2's shared `admins`
 * visibility will widen this), so a tool can never drop cards into a thread
 * the acting user can't decide.
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
    const thread = await requireOwnedThread(ctx, auth, found._id);
    return await insertProposalsForThread(ctx, thread, args.proposals);
  },
});

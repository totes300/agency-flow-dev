import { v, ConvexError, type ObjectType } from "convex/values";
import {
  internalAction,
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { loadAuthContextForActor } from "./lib/auth";
import {
  getAgentRunJob,
  NO_AGENT_ACTOR_MESSAGE,
  resolveJobActor,
} from "./lib/agentJobs";
import { getSystemAgentDefinition } from "./lib/systemAgents";
import {
  ensureAnchoredThreadCore,
  threadAnchorValidator,
} from "./agentThreads";
import { executeRun, type BackgroundBeginResult } from "./agentRunner";

/**
 * Agent job entry points (docs/prd-email-triage-implementation-plan.md §3
 * P2, A2b; PRD §5.1, §6, E2). The registry and `runLlmStep` live in
 * convex/lib/agentJobs.ts; this module holds the Convex functions.
 *
 * INTERNAL ONLY — jobs are started by server code (B-phase email pipeline,
 * crons, scheduled functions). No public function takes an org or a user to
 * run a job as.
 */

export { NO_AGENT_ACTOR_MESSAGE };

const anchorValidator = threadAnchorValidator;

// ─── Audit rows ──────────────────────────────────────────────────────────────

/** One `agentJobRuns` row (llm_step outcomes; fail-closed agent_run starts). */
export const recordJobRun = internalMutation({
  args: {
    orgId: v.string(),
    job: v.string(),
    tier: v.union(v.literal("llm_step"), v.literal("agent_run")),
    anchor: v.optional(anchorValidator),
    status: v.union(v.literal("succeeded"), v.literal("failed")),
    startedAt: v.number(),
    attempts: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"agentJobRuns">> => {
    return await ctx.db.insert("agentJobRuns", {
      ...args,
      error: args.error?.slice(0, 500),
      finishedAt: Date.now(),
    });
  },
});

// ─── System agents ───────────────────────────────────────────────────────────

/**
 * The org's agent row for a code-defined system agent
 * (convex/lib/systemAgents.ts): created on first use, re-synced to the code
 * definition when it drifted (name, description, instructions, default tools,
 * run permission; never archived). Idempotent; concurrent calls read the same
 * index range, so OCC serializes them and the loser finds the winner's row.
 */
export async function ensureSystemAgentCore(
  ctx: MutationCtx,
  orgId: string,
  key: string,
): Promise<Id<"agents">> {
  const def = getSystemAgentDefinition(key);
  if (!def) throw new ConvexError(`Unknown system agent "${key}"`);
  const fields = {
    name: def.name,
    description: def.description,
    instructions: def.instructions,
    tools: [...def.tools],
    runPermission: def.runPermission,
  };
  const existing = await ctx.db
    .query("agents")
    .withIndex("by_orgId_systemKey", (q) =>
      q.eq("orgId", orgId).eq("systemKey", key),
    )
    .first();
  const now = Date.now();
  if (existing) {
    const drifted =
      existing.archivedAt !== undefined ||
      existing.name !== fields.name ||
      existing.description !== fields.description ||
      existing.instructions !== fields.instructions ||
      existing.runPermission !== fields.runPermission ||
      JSON.stringify(existing.tools) !== JSON.stringify(fields.tools);
    if (drifted) {
      await ctx.db.patch(existing._id, {
        ...fields,
        archivedAt: undefined,
        updatedAt: now,
      });
    }
    return existing._id;
  }
  // `createdBy` is required on agents; a system agent's nominal creator is
  // the org's creator.
  const settings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .unique();
  if (!settings) throw new ConvexError("Organization not found");
  return await ctx.db.insert("agents", {
    orgId,
    ...fields,
    systemKey: key,
    trigger: "manual",
    createdBy: settings.createdBy,
    createdAt: now,
    updatedAt: now,
  });
}

export const ensureSystemAgent = internalMutation({
  args: { orgId: v.string(), key: v.string() },
  handler: async (ctx, args): Promise<Id<"agents">> =>
    await ensureSystemAgentCore(ctx, args.orgId, args.key),
});

// ─── Designated agent actor (E2) ─────────────────────────────────────────────

/**
 * Set (or clear with `null`) the org's designated agent actor — the admin
 * `admins`-visibility jobs run as. Internal for now (Settings UI later);
 * setting requires a CURRENT admin. Every job start re-checks it anyway.
 */
export const setAgentActorUser = internalMutation({
  args: { orgId: v.string(), userId: v.union(v.id("users"), v.null()) },
  handler: async (ctx, args): Promise<null> => {
    const settings = await ctx.db
      .query("orgSettings")
      .withIndex("by_orgId", (q) => q.eq("orgId", args.orgId))
      .unique();
    if (!settings) throw new ConvexError("Organization not found");
    if (args.userId) {
      const auth = await loadAuthContextForActor(ctx, {
        orgId: args.orgId,
        userId: args.userId,
      });
      if (!auth.isAdmin) {
        throw new ConvexError("The agent actor must be an admin of the organization");
      }
    }
    await ctx.db.patch(settings._id, {
      agentActorUserId: args.userId ?? undefined,
      updatedAt: Date.now(),
    });
    // Email items waiting for an actor plan now (B6a; the target checks the flag).
    if (args.userId) {
      await ctx.scheduler.runAfter(0, internal.email.prepare.replanAfterActorChange, { orgId: args.orgId });
    }
    return null;
  },
});

/**
 * Settle hooks of `agent_run` jobs (B6a): the runner schedules this when a
 * run with `job` settles — finished, failed, cancelled, or a queued run that
 * could not start. One switch, so the runner knows no job by name.
 */
const JOB_SETTLED_HOOKS: Record<string, typeof internal.email.prepare.onPrepareRunSettled> = {
  prepareTask: internal.email.prepare.onPrepareRunSettled,
  prepareChange: internal.email.changes.onChangeRunSettled,
  draftReply: internal.email.reply.onDraftRunSettled,
};

export const jobRunSettled = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    const hook = run?.job ? JOB_SETTLED_HOOKS[run.job] : undefined;
    if (hook) await ctx.runMutation(hook, { runId: args.runId });
    return null;
  },
});

// ─── agent_run start ─────────────────────────────────────────────────────────

export type PrepareResult =
  | { ok: true; threadId: Id<"agentThreads">; actingUserId: Id<"users"> }
  | { ok: false; jobRunId: Id<"agentJobRuns">; error: string };

/**
 * One transaction: resolve the actor (fail closed → a failed `agentJobRuns`
 * row, nothing else), ensure the system agent, ensure the anchored thread.
 */
export const prepareAgentJob = internalMutation({
  args: {
    job: v.string(),
    orgId: v.string(),
    anchor: anchorValidator,
    ownerUserId: v.optional(v.id("users")),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<PrepareResult> => {
    const job = getAgentRunJob(args.job);
    if (!job) throw new ConvexError(`Unknown agent_run job "${args.job}"`);
    if (job.visibility === "admins" && args.ownerUserId) {
      throw new ConvexError("ownerUserId is only accepted for private jobs");
    }
    if (job.visibility === "private" && !args.ownerUserId) {
      throw new ConvexError("A private job needs the thread owner (ownerUserId)");
    }

    // The shared resolver (convex/lib/agentJobs.ts) — re-run when the run
    // actually starts or a queued run is claimed (agentRunner).
    const actor = await resolveJobActor(ctx, job, args.orgId, args.ownerUserId);
    if (!actor.ok) {
      const now = Date.now();
      const jobRunId = await ctx.db.insert("agentJobRuns", {
        orgId: args.orgId,
        job: job.name,
        tier: "agent_run",
        anchor: { type: args.anchor.type, id: args.anchor.id },
        status: "failed",
        startedAt: now,
        finishedAt: now,
        error: actor.error,
      });
      return { ok: false, jobRunId, error: actor.error };
    }

    const agentId = await ensureSystemAgentCore(ctx, args.orgId, job.systemAgentKey);
    const threadId = await ensureAnchoredThreadCore(ctx, {
      orgId: args.orgId,
      agentId,
      anchor: args.anchor,
      visibility: job.visibility,
      ownerUserId: actor.userId,
      title: args.title,
    });
    return { ok: true, threadId, actingUserId: actor.userId };
  },
});

export type StartAgentJobResult =
  | { status: "started" | "queued"; runId: Id<"agentRuns">; threadId: Id<"agentThreads"> }
  | { status: "failed"; jobRunId: Id<"agentJobRuns">; error: string };

const startAgentJobArgs = {
  job: v.string(),
  orgId: v.string(),
  anchor: anchorValidator,
  input: v.string(),
  ownerUserId: v.optional(v.id("users")),
  title: v.optional(v.string()),
};

/**
 * Start an `agent_run` job (A2b): ensure the org's system agent and the
 * anchored thread (one per anchor for an `admins` job, one per owner for a
 * `private` job), resolve the actor (E2 — fails closed, nothing runs), then
 * start or QUEUE a background run through the existing path
 * (`beginBackgroundRun` → `executeRun`), recorded with `agentRuns.job`.
 *
 * `input` is the run's prompt message. `ownerUserId` is accepted for
 * `private` jobs only.
 */
export const startAgentJob = internalAction({
  args: startAgentJobArgs,
  handler: async (ctx, args): Promise<StartAgentJobResult> => await startAgentJobCore(ctx, args),
});

/**
 * The body of `startAgentJob`, callable from another internal action of the
 * same runtime (the guidelines: share code, don't nest actions). `onThread`
 * runs once the anchored thread exists and BEFORE the run executes — e.g. the
 * email pipeline links its item to the thread (B6a).
 */
export async function startAgentJobCore(
  ctx: ActionCtx,
  args: ObjectType<typeof startAgentJobArgs>,
  hooks: { onThread?: (threadId: Id<"agentThreads">) => Promise<void> } = {},
): Promise<StartAgentJobResult> {
  const message = args.input.trim();
  if (!message) throw new ConvexError("Job input is empty");
  const prepared: PrepareResult = await ctx.runMutation(
    internal.agentJobs.prepareAgentJob,
    {
      job: args.job,
      orgId: args.orgId,
      anchor: args.anchor,
      ownerUserId: args.ownerUserId,
      title: args.title,
    },
  );
  if (!prepared.ok) {
    return { status: "failed", jobRunId: prepared.jobRunId, error: prepared.error };
  }
  await hooks.onThread?.(prepared.threadId);
  const begun: BackgroundBeginResult = await ctx.runMutation(
    internal.agentRunner.beginBackgroundRun,
    {
      threadId: prepared.threadId,
      actingUserId: prepared.actingUserId,
      message,
      job: args.job,
    },
  );
  if (begun.queued) {
    return { status: "queued", runId: begun.runId, threadId: prepared.threadId };
  }
  const { runId } = await executeRun(ctx, begun.run);
  return { status: "started", runId, threadId: prepared.threadId };
}

import { v, ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { executeRun, type BeginRunResult } from "./agentRunner";

/**
 * Background agent runs (docs/prd-email-triage-implementation-plan.md §3 P1,
 * phase A1) — runs without a signed-in user, acting as a named org member.
 *
 * INTERNAL ONLY: reached from server code (future job registry, crons,
 * scheduled functions), never from a client. There is deliberately no public
 * function that accepts a userId/orgId to run as someone — `startRun` stays
 * the only public entry point.
 *
 * Guarantees, all enforced server-side in `beginBackgroundRun`:
 *   - the thread exists, and the run's org is the thread's org;
 *   - `actingUserId` is a CURRENT member of that org (re-checked from
 *     `orgMembers` at run time, role re-derived — never trusted from args);
 *   - the acting user owns the thread (A1; A2 adds shared `admins` threads);
 *   - the agent is live and runnable by the actor's role, no concurrent run.
 * Then the SAME loop as `startRun` runs (`executeRun`): instructions
 * assembly, stop handling, settle/finish, audit rows. Only `background: true`
 * tools are offered; the rest are recorded in the run's `droppedTools`.
 */
export const start = internalAction({
  args: {
    threadId: v.string(),
    actingUserId: v.id("users"),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const message = args.message.trim();
    if (!message) throw new ConvexError("Message is empty");
    const run: BeginRunResult = await ctx.runMutation(
      internal.agentRunner.beginBackgroundRun,
      { threadId: args.threadId, actingUserId: args.actingUserId, message },
    );
    return await executeRun(ctx, run);
  },
});

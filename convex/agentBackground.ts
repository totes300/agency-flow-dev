import { v, ConvexError } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  errorText,
  executeRun,
  type BackgroundBeginResult,
  type BeginRunResult,
} from "./agentRunner";

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
 *   - the acting user has WRITE access under the thread policy: the owner
 *     of a private thread, a current admin in an `admins` thread (A2a);
 *   - the agent is live and runnable by the actor's role.
 * A busy thread does not reject: the run is QUEUED (FIFO) and started by
 * `runNextQueued` once the active run settles, actor re-checked then (I11).
 * Otherwise the SAME loop as `startRun` runs (`executeRun`): instructions
 * assembly, stop handling, settle/finish, audit rows — with the same tool set
 * (every registry tool is on the actor path, A7) minus `interactiveOnly`
 * connector tools, which are recorded in the run's `droppedTools`.
 */
export const start = internalAction({
  args: {
    threadId: v.string(),
    actingUserId: v.id("users"),
    message: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ runId: Id<"agentRuns">; queued: boolean }> => {
    const message = args.message.trim();
    if (!message) throw new ConvexError("Message is empty");
    const begun: BackgroundBeginResult = await ctx.runMutation(
      internal.agentRunner.beginBackgroundRun,
      { threadId: args.threadId, actingUserId: args.actingUserId, message },
    );
    if (begun.queued) return { runId: begun.runId, queued: true };
    const { runId } = await executeRun(ctx, begun.run);
    return { runId, queued: false };
  },
});

/** Bad queued heads settled per pump before yielding to the next tick. */
const MAX_FAILED_HEADS_PER_PUMP = 25;

/**
 * Queue pump (A2a, I11): claim and execute the thread's next queued
 * background run. Scheduled by `finishRun` / the stale-run sweep (every
 * settle path) and by an enqueue onto an idle thread with a backlog. A no-op
 * when the thread is busy or the queue is empty; the claim re-checks the
 * actor. If opening the head throws after its checks (the claim rolled
 * back), the head is failed in its own transaction and the next one is
 * tried — a bad head never blocks the queue.
 */
export const runNextQueued = internalAction({
  args: { threadId: v.id("agentThreads") },
  handler: async (ctx, args): Promise<null> => {
    for (let i = 0; i < MAX_FAILED_HEADS_PER_PUMP; i++) {
      let run: BeginRunResult | null;
      try {
        run = await ctx.runMutation(internal.agentRunner.beginNextQueuedRun, {
          threadId: args.threadId,
        });
      } catch (err) {
        const failed: boolean = await ctx.runMutation(
          internal.agentRunner.failQueuedHead,
          { threadId: args.threadId, error: errorText(err) },
        );
        if (!failed) return null;
        continue;
      }
      if (run) await executeRun(ctx, run);
      return null;
    }
    // Still more bad heads: keep draining on a fresh invocation.
    await ctx.scheduler.runAfter(0, internal.agentBackground.runNextQueued, {
      threadId: args.threadId,
    });
    return null;
  },
});

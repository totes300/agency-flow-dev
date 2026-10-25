import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver } from "./mcpRefs";
import { requireTask } from "./mcpSaveTasks";
import type { TimerResult } from "./mcpWriteResults";
import { msToMinutes, timerElapsedMs, TIMER_MIN_SAVE_MS, TIMER_STALE_MS } from "./timer";
import { roundMinutes } from "./rounding";
import { startTimerForAuth, stopTimerForAuth } from "../timer";
import { TIME_ENTRY_NOTE_MAX } from "../../lib/mcp/limits";

/**
 * MCP `timer` (docs/prd-mcp.md §6): the caller's own timer through the
 * app's timer paths (timer.ts), so the app's timer bar shows it at once.
 *
 * - start: `startTimerForAuth` — one timer per user (a running or paused
 *   timer must be stopped first), members only on tasks they can work on,
 *   the rate for the category that will apply is checked up front.
 * - stop: `stopTimerForAuth` — creates the entry exactly as the app's stop
 *   (server-measured duration, capped at 16 h, ceiled to whole minutes,
 *   filed under the session's start day, the owner's category chain and
 *   rate snapshot). Under 30 seconds nothing is saved.
 * - status: task, session start and the minutes stop would save, computed
 *   here from the same measurement (`timerElapsedMs`).
 *
 * Read budget: start ~15 ranges (task ref, access, category chain, rates);
 * stop ~12 (task, project, client, settings, category chain, rates);
 * status 2.
 */

/** The minutes `stop` saves for `elapsedMs` (0 under 30 seconds, the app's rule). */
export function minutesToSave(elapsedMs: number): number {
  return elapsedMs < TIMER_MIN_SAVE_MS ? 0 : roundMinutes(msToMinutes(elapsedMs), 1);
}

export async function timerStatus(ctx: QueryCtx, auth: McpAuthContext, now: number) {
  const { user } = auth;
  if (!user.timerTaskId || !user.timerStatus) return { running: false as const };
  // As the app's timer bar (timer.getState): the task while it is in the org.
  const task = await ctx.db.get(user.timerTaskId);
  if (!task || task.orgId !== auth.orgId) return { running: false as const };
  const elapsedMs = timerElapsedMs(user, now);
  return {
    running: true as const,
    status: user.timerStatus,
    task: { identifier: task.identifier ?? task._id, title: task.title },
    /** Start of the current running segment (absent while paused). */
    startedAt: user.timerStartedAt ?? null,
    minutes: minutesToSave(elapsedMs),
    stale: elapsedMs >= TIMER_STALE_MS,
  };
}

export async function startTimer(ctx: MutationCtx, auth: McpAuthContext, taskRef: string): Promise<TimerResult> {
  const task = await requireTask(createRefResolver(ctx, auth), taskRef);
  await startTimerForAuth(ctx, auth, task._id);
  const user = (await ctx.db.get(auth.userId))!;
  return {
    tool: "timer",
    action: "started",
    task: { identifier: task.identifier ?? task._id, title: task.title },
    startedAt: user.timerStartedAt,
  };
}

export async function stopTimer(ctx: MutationCtx, auth: McpAuthContext, note: string | undefined): Promise<TimerResult> {
  if (note !== undefined && note.trim().length > TIME_ENTRY_NOTE_MAX) {
    throw new ConvexError(`note is ${note.trim().length} characters; at most ${TIME_ENTRY_NOTE_MAX} are accepted.`);
  }
  const stopped = await stopTimerForAuth(ctx, auth, { note });
  const task = await ctx.db.get(stopped.taskId);
  const taskRef = { identifier: task?.identifier ?? stopped.taskId, title: stopped.taskName };
  if (stopped.discarded) return { tool: "timer", action: "discarded", task: taskRef };
  return {
    tool: "timer",
    action: "stopped",
    task: taskRef,
    entryId: stopped.entryId,
    minutes: stopped.roundedMinutes,
    date: stopped.date,
    stale: stopped.isStale,
  };
}

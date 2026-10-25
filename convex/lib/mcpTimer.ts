import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { McpAuthContext } from "./mcpAuth";
import { createRefResolver } from "./mcpRefs";
import { orgClock } from "./mcpRecords";
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
 *   rate snapshot, a `time_entry_logged` row with "via"). Under 30 seconds
 *   nothing is saved.
 * - status (also on `fetch("me")`): task, current run start and the
 *   minutes stop would save, from the same measurement (`timerElapsedMs`).
 *
 * Timer state is per user, not per org: a timer on another org's task is
 * reported only as "in another workspace" — never its task — and start /
 * stop refuse it without touching it (timer.ts, TIMER_IN_OTHER_WORKSPACE).
 *
 * Read budget: start ~16 ranges (task ref, access, category chain, rates,
 * settings); stop ~15 (task, project, client, settings, category chain,
 * rates, the activity row); status 2.
 */

/** The minutes `stop` saves for `elapsedMs` (0 under 30 seconds, the app's rule). */
export function minutesToSave(elapsedMs: number): number {
  return elapsedMs < TIMER_MIN_SAVE_MS ? 0 : roundMinutes(msToMinutes(elapsedMs), 1);
}

/** The caller's timer as seen from this org. */
export async function timerState(ctx: QueryCtx, auth: McpAuthContext, now: number) {
  const { user } = auth;
  if (!user.timerTaskId || !user.timerStatus) return { state: "idle" as const };
  const task = await ctx.db.get(user.timerTaskId);
  // Deleted: stop clears it (the app's dangling-timer branch).
  if (!task) return { state: "orphaned" as const };
  if (task.orgId !== auth.orgId) return { state: "elsewhere" as const };
  const elapsedMs = timerElapsedMs(user, now);
  return {
    state: user.timerStatus,
    task: { identifier: task.identifier ?? task._id, title: task.title },
    /** Start of the current running segment (null while paused). */
    currentRunSince: user.timerStatus === "running" ? (user.timerStartedAt ?? null) : null,
    /** The session was paused before: time before `currentRunSince` counts too. */
    resumed: (user.timerAccumulatedMs ?? 0) > 0,
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
    timezone: (await orgClock(ctx, auth.orgId, Date.now())).timezone,
  };
}

export async function stopTimer(ctx: MutationCtx, auth: McpAuthContext, note: string | undefined): Promise<TimerResult> {
  if (note !== undefined && note.trim().length > TIME_ENTRY_NOTE_MAX) {
    throw new ConvexError(`note is ${note.trim().length} characters; at most ${TIME_ENTRY_NOTE_MAX} are accepted.`);
  }
  const stopped = await stopTimerForAuth(ctx, auth, { note });
  // The core refuses another org's task, so a task read here is this org's (or gone).
  const task = await ctx.db.get(stopped.taskId);
  const taskRef = task ? { identifier: task.identifier ?? task._id, title: task.title } : undefined;
  if (stopped.discarded) {
    return { tool: "timer", action: "discarded", task: taskRef, discardReason: stopped.discardReason };
  }
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

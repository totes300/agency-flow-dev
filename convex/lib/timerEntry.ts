/**
 * Single writer for timer-born time entries.
 *
 * Three callers share this: `timer.stop` (create-at-stop — the entry exists
 * the moment the timer stops, so a tab close can never lose measured time),
 * `timer.commitEntry` (the "Save as 1m" escape hatch), and the task-archive
 * auto-save (a running timer on an archived task is committed, not wiped).
 * One implementation = one rounding/anchoring/guard policy, no drift.
 *
 * Date anchoring rule:
 *   - Prefer the session's real start day (`sessionStartedAt`) so overnight
 *     sessions file under the day the work began (Toggl/Harvest behavior).
 *   - If that day is inside a settled retainer scope (closed or invoiced —
 *     possible when an admin settles a month the morning after an overnight
 *     session), fall back to TODAY instead of stranding the stop. Today can
 *     never be settled (both close and invoicing require the period to have
 *     ended), so the fallback always succeeds.
 *   - The stored `startedAt` always lands inside the chosen `date` (the
 *     ledger invariant `date === tzDay(startedAt)` holds).
 */

import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getDateInTimezone, msToMinutes, MAX_TIMER_MS, ORG_TIMEZONE_FALLBACK } from "./timer";
import { roundMinutes } from "./rounding";
import { resolveRateSnapshot } from "./orgHelpers";
import { findEntryDateBlocker } from "./settleGuards";

export async function insertTimerEntry(
  ctx: MutationCtx,
  opts: {
    orgId: string;
    /** Entry owner — the person whose timer measured the time. */
    ownerId: Id<"users">;
    /** Actor — same as owner on stop; the admin on archive auto-save. */
    createdBy: Id<"users">;
    task: Doc<"tasks">;
    project: Doc<"projects">;
    rawMinutes: number;
    /** Real wall-clock session start when known (running timers). */
    sessionStartedAt?: number;
    note?: string;
    isBillable: boolean;
    timezone: string;
  },
): Promise<{ entryId: Id<"timeEntries">; durationMinutes: number; date: string }> {
  // RAW LEDGER (2026-07-05 rounding-policy decision): entries store the
  // actual measured time, ceiled to a whole minute only. The workspace
  // rounding setting is an INVOICE-time presentation rule — it never
  // mutates the ledger. See docs/project-types-review-inventory.md.
  const rounded = roundMinutes(opts.rawMinutes, 1);
  if (rounded <= 0) {
    throw new ConvexError("Duration must be greater than 0");
  }

  // Rate snapshot for the OWNER (not the actor). Throws with a clear
  // config-fix message; callers decide whether that blocks (stop: yes,
  // transactional rollback keeps the timer alive) or degrades (archive
  // auto-save: reported, timer left running).
  const rateSnapshot = await resolveRateSnapshot(ctx, {
    userId: opts.ownerId,
    orgId: opts.orgId,
    task: opts.task,
    project: opts.project,
    isBillable: opts.isBillable,
  });

  const now = Date.now();
  const today = getDateInTimezone(now, opts.timezone);
  const synthetic = now - rounded * 60_000;

  let startedAt = opts.sessionStartedAt ?? synthetic;
  let date = getDateInTimezone(startedAt, opts.timezone);
  if (date !== today) {
    const blocker = await findEntryDateBlocker(ctx, opts.project, date);
    if (blocker) {
      // Settled start day — file under today rather than stranding the stop.
      date = today;
      startedAt =
        getDateInTimezone(synthetic, opts.timezone) === today ? synthetic : now;
    }
  }
  // Final guard (also covers the date === today path; today can never be
  // settled, so this only fires on genuinely blocked backdates).
  const blocker = await findEntryDateBlocker(ctx, opts.project, date);
  if (blocker) throw new ConvexError(blocker);

  const entryId = await ctx.db.insert("timeEntries", {
    orgId: opts.orgId,
    taskId: opts.task._id,
    userId: opts.ownerId,
    date,
    startedAt,
    durationMinutes: rounded,
    note: opts.note?.trim() || undefined,
    isBillable: opts.isBillable,
    method: "timer",
    costRate: rateSnapshot.costRate,
    billableRate: rateSnapshot.billableRate,
    rateCurrency: rateSnapshot.rateCurrency,
    snapshotCategoryId: opts.task.workCategoryId,
    createdAt: now,
    updatedAt: now,
    createdBy: opts.createdBy,
  });

  return { entryId, durationMinutes: rounded, date };
}

/**
 * Archive-time timer rescue: instead of silently wiping running/paused
 * timers on tasks being archived (the pre-2026-07-05 behavior — hours of
 * measured work vanished with no trace), commit each affected member's
 * elapsed time as a real entry, then clear the timer.
 *
 * Degradation: if an entry can't be created (e.g. the member's cost rate
 * was deleted mid-session), the timer is LEFT RUNNING and the failure is
 * reported to the caller — the member can stop it normally later. Losing
 * the measurement is never an option. Sub-30s timers are cleared without
 * an entry (nothing worth saving).
 */
export async function autoSaveTimersForTasks(
  ctx: MutationCtx,
  opts: {
    orgId: string;
    /** The admin performing the archive — recorded as `createdBy`. */
    actorUserId: Id<"users">;
    /** Task IDs being archived (task + subtasks), stringified. */
    taskIds: Set<string>;
    noteLabel: string;
  },
): Promise<{
  saved: Array<{ userName: string; minutes: number }>;
  failed: Array<{ userName: string; reason: string }>;
}> {
  const saved: Array<{ userName: string; minutes: number }> = [];
  const failed: Array<{ userName: string; reason: string }> = [];

  const orgSettings = await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", opts.orgId))
    .unique();
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK;

  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", opts.orgId))
    .collect();

  const now = Date.now();
  for (const member of members) {
    if (!member.userId) continue;
    const user = await ctx.db.get(member.userId);
    if (!user?.timerTaskId || !opts.taskIds.has(user.timerTaskId.toString())) {
      continue;
    }

    const accumulated = user.timerAccumulatedMs ?? 0;
    const running = user.timerStatus === "running" && user.timerStartedAt;
    // Same 16h ceiling as timer.stop — the rescue must never mint MORE
    // minutes than the owner's own stop would have.
    const elapsedMs = Math.min(
      running
        ? now - (user.timerStartedAt as number) + accumulated
        : accumulated,
      MAX_TIMER_MS,
    );

    const clear = () =>
      ctx.db.patch(member.userId as Id<"users">, {
        timerTaskId: undefined,
        timerStartedAt: undefined,
        timerAccumulatedMs: undefined,
        timerStatus: undefined,
      });

    if (elapsedMs < 30_000) {
      await clear();
      continue;
    }

    const task = await ctx.db.get(user.timerTaskId);
    const project = task?.projectId ? await ctx.db.get(task.projectId) : null;
    if (!task || !project) {
      await clear();
      continue;
    }

    try {
      const { durationMinutes } = await insertTimerEntry(ctx, {
        orgId: opts.orgId,
        ownerId: member.userId,
        createdBy: opts.actorUserId,
        task,
        project,
        rawMinutes: msToMinutes(elapsedMs),
        sessionStartedAt: running ? (user.timerStartedAt as number) : undefined,
        note: opts.noteLabel,
        isBillable: task.billable,
        timezone,
      });
      await clear();
      saved.push({ userName: user.name, minutes: durationMinutes });
    } catch (err) {
      // Leave the timer running — the member stops it normally later.
      const reason =
        err instanceof ConvexError ? String(err.data) : "could not save the entry";
      failed.push({ userName: user.name, reason });
    }
  }

  return { saved, failed };
}

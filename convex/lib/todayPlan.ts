/**
 * Pure set math for the derived My Tasks "Today" group.
 *
 * "Today" is not a status — it is derived from planSegments: a task is in my
 * Today iff one of MY segments covers today's date (org timezone, inclusive
 * bounds), the task is not archived, and the task is not already in the
 * "completed today" state (done/review type updated today).
 *
 * No Convex ctx dependency — mirrors myTaskHelpers.ts style, primary test
 * target of the feature (convex/lib/__tests__/todayPlan.test.ts).
 */

import type { Id } from "../_generated/dataModel";
import type { StatusType } from "./constants";
import { getDateInTimezone } from "./timer";

// ─── Constants ──────────────────────────────────────────────────────────────

/** How far back the "Earlier" leftovers section looks (PRD: 14 days). */
export const EARLIER_WINDOW_DAYS = 14;

/**
 * Scan guard for the covering-today segment query: segments starting more
 * than this many days ago cannot matter (a bar spanning 60+ days into today
 * is not a real plan). Bounds the by_orgId_userId_startDate index range.
 */
export const SEGMENT_SCAN_WINDOW_DAYS = 60;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal plan segment shape needed by the set math. */
export type MinimalSegment = {
  taskId: Id<"tasks">;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  createdAt: number;
};

/** Minimal task shape needed to partition (subset of MinimalTask). */
export type TodayPartitionTask = {
  _id: Id<"tasks">;
  statusType: StatusType;
  archivedAt?: number;
  updatedAt: number;
};

export type MyDayPartition = {
  /** Tasks planned for today, arrival order (earliest covering-segment createdAt first). */
  todayTaskIds: Id<"tasks">[];
  /** Planned-but-unfinished leftovers from the Earlier window, newest-ended first. */
  earlierTaskIds: Id<"tasks">[];
};

// ─── Date string math ───────────────────────────────────────────────────────

/**
 * Add (or subtract) whole days to a YYYY-MM-DD string. UTC string math —
 * timezone/DST-agnostic, same approach as plannerMath.segmentSpanDays.
 */
export function addDaysToDateString(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive covering check: startDate ≤ date ≤ endDate (string compare). */
export function segmentCoversDate(
  seg: Pick<MinimalSegment, "startDate" | "endDate">,
  date: string,
): boolean {
  return seg.startDate <= date && date <= seg.endDate;
}

// ─── Completed-today check ──────────────────────────────────────────────────

/**
 * "Completed today" state: done- or review-type status, updated today.
 * Same rule the My Tasks completed_today group uses — a task in this state
 * leaves Today (it burned down into Completed today).
 */
export function isCompletedToday(
  task: Pick<TodayPartitionTask, "statusType" | "updatedAt">,
  todayStr: string,
  timezone: string,
): boolean {
  return (
    (task.statusType === "done" || task.statusType === "review") &&
    getDateInTimezone(task.updatedAt, timezone) === todayStr
  );
}

// ─── partitionMyDay ─────────────────────────────────────────────────────────

/**
 * Partition tasks into the Today and Earlier sets given MY plan segments.
 *
 * Today: any segment covering todayStr, task not archived, not completed
 * today. Deduped per task; ordered by the earliest covering segment's
 * createdAt (arrival order — new entrants append at the bottom).
 *
 * Earlier: the task's newest segment (max endDate among the given segments)
 * ended before today but within the window, task not archived and not in a
 * finished state (done/review — pushing to review is the completion
 * gesture, so reviewed work is not a leftover). Ordered newest-ended first.
 *
 * Segments for other users must not be passed in — planning is personal.
 */
export function partitionMyDay(
  tasks: TodayPartitionTask[],
  mySegments: MinimalSegment[],
  todayStr: string,
  timezone: string,
  earlierWindowDays: number = EARLIER_WINDOW_DAYS,
): MyDayPartition {
  const segmentsByTask = new Map<string, MinimalSegment[]>();
  for (const seg of mySegments) {
    const key = seg.taskId as string;
    const list = segmentsByTask.get(key);
    if (list) list.push(seg);
    else segmentsByTask.set(key, [seg]);
  }

  const earlierFloor = addDaysToDateString(todayStr, -earlierWindowDays);

  const today: { taskId: Id<"tasks">; sortKey: number }[] = [];
  const earlier: { taskId: Id<"tasks">; sortKey: string }[] = [];

  for (const task of tasks) {
    if (task.archivedAt) continue;
    const segments = segmentsByTask.get(task._id as string);
    if (!segments || segments.length === 0) continue;

    const covering = segments.filter((s) => segmentCoversDate(s, todayStr));
    if (covering.length > 0) {
      if (isCompletedToday(task, todayStr, timezone)) continue;
      today.push({
        taskId: task._id,
        sortKey: Math.min(...covering.map((s) => s.createdAt)),
      });
      continue;
    }

    // Earlier: newest segment ended before today, within the window,
    // task not already finished.
    if (task.statusType === "done" || task.statusType === "review") continue;
    const maxEndDate = segments.reduce(
      (max, s) => (s.endDate > max ? s.endDate : max),
      segments[0].endDate,
    );
    if (maxEndDate < todayStr && maxEndDate >= earlierFloor) {
      earlier.push({ taskId: task._id, sortKey: maxEndDate });
    }
  }

  today.sort((a, b) => a.sortKey - b.sortKey);
  earlier.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return {
    todayTaskIds: today.map((t) => t.taskId),
    earlierTaskIds: earlier.map((t) => t.taskId),
  };
}

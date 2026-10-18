/**
 * LEGACY SHIM — remove in tasks-refactor slice 7 (docs/prd-tasks-refactor.md
 * §10, §12 Slice 5 row).
 *
 * The old "My Day" partition, kept only because the owner's uncommitted
 * dashboard board work in progress (`convex/dashboardBoard.ts`) still imports
 * `partitionMyDay` from `./todayPlan`. Nothing in the tasks refactor reads it;
 * Today semantics live in `convex/tasks/today.ts` (§5.6).
 */
import type { Id } from "../_generated/dataModel";
import type { StatusType } from "./constants";
import { getDateInTimezone } from "./timer";
import { addDaysToDateString, segmentCoversDate } from "./todayPlan";

/** How far back the "Earlier" leftovers section looks (PRD: 14 days). */
export const EARLIER_WINDOW_DAYS = 14;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal plan segment shape needed by the set math. */
export type MinimalSegment = {
  taskId: Id<"tasks">;
  startDate: string; // YYYY-MM-DD inclusive
  endDate: string;   // YYYY-MM-DD inclusive
  createdAt: number;
  /** Manual Today ordering (fractional key); unset = arrival order. */
  todaySortKey?: string;
};

/** Minimal task shape needed to partition (subset of MinimalTask). */
export type TodayPartitionTask = {
  _id: Id<"tasks">;
  statusType: StatusType;
  archivedAt?: number;
  updatedAt: number;
};

export type MyDayPartition = {
  /**
   * Tasks planned for today. Manual `todaySortKey` (min across covering
   * segments, code-point compare) wins between two keyed tasks; otherwise
   * arrival order (earliest covering-segment createdAt — new entrants
   * append at the bottom). Same comparator contract as sortWithinGroup.
   */
  todayTaskIds: Id<"tasks">[];
  /** The effective manual sort key per today task (for reorder neighbors). */
  todaySortKeys: Map<string, string | undefined>;
  /** Planned-but-unfinished leftovers from the Earlier window, newest-ended first. */
  earlierTaskIds: Id<"tasks">[];
  /** Per Earlier task, the newest segment endDate that qualified it (for the "Nd ago" chip). */
  earlierEndDates: Map<string, string>;
};

// ─── Date string math ───────────────────────────────────────────────────────

/**
 * Add (or subtract) whole days to a YYYY-MM-DD string. UTC string math —
 * timezone/DST-agnostic, same approach as plannerMath.segmentSpanDays.
 */
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

// ─── planRemovalOps ─────────────────────────────────────────────────────────

/** A segment shape with identity, as needed for removal surgery. */
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

  const today: { taskId: Id<"tasks">; manualKey?: string; createdAt: number }[] = [];
  const earlier: { taskId: Id<"tasks">; sortKey: string }[] = [];

  for (const task of tasks) {
    if (task.archivedAt) continue;
    const segments = segmentsByTask.get(task._id as string);
    if (!segments || segments.length === 0) continue;

    const covering = segments.filter((s) => segmentCoversDate(s, todayStr));
    if (covering.length > 0) {
      if (isCompletedToday(task, todayStr, timezone)) continue;
      const keys = covering
        .map((s) => s.todaySortKey)
        .filter((k): k is string => k != null);
      today.push({
        taskId: task._id,
        // Min by code-point order (fractional-indexing contract)
        manualKey: keys.length > 0 ? keys.reduce((a, b) => (b < a ? b : a)) : undefined,
        createdAt: Math.min(...covering.map((s) => s.createdAt)),
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

  today.sort((a, b) => {
    // Both manually keyed → code-point order (required by fractional-indexing)
    if (a.manualKey != null && b.manualKey != null) {
      if (a.manualKey < b.manualKey) return -1;
      if (a.manualKey > b.manualKey) return 1;
    }
    // Fallback: arrival order (new entrants append at the bottom)
    return a.createdAt - b.createdAt;
  });
  earlier.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  return {
    todayTaskIds: today.map((t) => t.taskId),
    todaySortKeys: new Map(today.map((t) => [t.taskId as string, t.manualKey])),
    earlierTaskIds: earlier.map((t) => t.taskId),
    // sortKey IS the newest qualifying endDate (see the earlier push above)
    earlierEndDates: new Map(earlier.map((t) => [t.taskId as string, t.sortKey])),
  };
}

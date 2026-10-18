/**
 * Pure date and segment math for plans (`planSegments`): date strings, the
 * covering check, and the "not today" removal surgery. The Today/carried
 * partition lives in `convex/tasks/today.ts` (tasks refactor §5.6).
 *
 * No Convex ctx dependency (convex/lib/__tests__/todayPlan.test.ts).
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Scan guard for the covering-today segment query: segments starting more
 * than this many days ago cannot matter (a bar spanning 60+ days into today
 * is not a real plan). Bounds the by_orgId_userId_startDate index range.
 */
export const SEGMENT_SCAN_WINDOW_DAYS = 60;

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
  seg: { startDate: string; endDate: string },
  date: string,
): boolean {
  return seg.startDate <= date && date <= seg.endDate;
}

// ─── planRemovalOps ─────────────────────────────────────────────────────────

/** A segment shape with identity, as needed for removal surgery. */
export type RemovableSegment = {
  _id: string | { toString(): string };
  startDate: string;
  endDate: string;
};

export type SegmentRemovalOp =
  | { op: "delete"; segmentId: string }
  | { op: "patch"; segmentId: string; startDate: string; endDate: string }
  /** Split remainder — copy every other field from the source segment. */
  | { op: "insert"; fromSegmentId: string; startDate: string; endDate: string };

/**
 * "Not today" surgery: given MY segments covering todayStr, produce the
 * operations that remove today without destroying the rest of the plan.
 * Per covering segment:
 * - single-day (== today)      → delete
 * - spans past AND future      → split: patch end = yesterday + insert tomorrow…end
 * - starts today (ends later)  → patch start = tomorrow
 * - ends today (started earlier) → patch end = yesterday
 *
 * Pure — callers apply the ops transactionally and derive toast copy from
 * the op kinds. Non-covering segments are ignored defensively.
 */
export function planRemovalOps(
  coveringSegments: RemovableSegment[],
  todayStr: string,
): SegmentRemovalOp[] {
  const yesterday = addDaysToDateString(todayStr, -1);
  const tomorrow = addDaysToDateString(todayStr, 1);
  const ops: SegmentRemovalOp[] = [];

  for (const seg of coveringSegments) {
    if (!segmentCoversDate(seg, todayStr)) continue;
    const id = seg._id.toString();
    const startsToday = seg.startDate === todayStr;
    const endsToday = seg.endDate === todayStr;

    if (startsToday && endsToday) {
      ops.push({ op: "delete", segmentId: id });
    } else if (startsToday) {
      ops.push({ op: "patch", segmentId: id, startDate: tomorrow, endDate: seg.endDate });
    } else if (endsToday) {
      ops.push({ op: "patch", segmentId: id, startDate: seg.startDate, endDate: yesterday });
    } else {
      // Spans past and future → keep the past in place, re-insert the future
      ops.push({ op: "patch", segmentId: id, startDate: seg.startDate, endDate: yesterday });
      ops.push({ op: "insert", fromSegmentId: id, startDate: tomorrow, endDate: seg.endDate });
    }
  }

  return ops;
}

/**
 * Toast-facing summary of a removal: "split" wins over "trimmed" wins over
 * "deleted" (the most surprising change is the one worth explaining).
 */
export function summarizeRemovalOps(
  ops: SegmentRemovalOp[],
): "deleted" | "trimmed" | "split" | null {
  if (ops.length === 0) return null;
  if (ops.some((o) => o.op === "insert")) return "split";
  if (ops.some((o) => o.op === "patch")) return "trimmed";
  return "deleted";
}

// LEGACY SHIM — re-exported for the owner's dashboard board WIP only; remove
// in slice 7 together with convex/lib/legacyMyDay.ts.
export {
  EARLIER_WINDOW_DAYS,
  isCompletedToday,
  partitionMyDay,
  type MinimalSegment,
  type MyDayPartition,
  type TodayPartitionTask,
} from "./legacyMyDay";

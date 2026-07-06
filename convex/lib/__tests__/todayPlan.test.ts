import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  segmentCoversDate,
  isCompletedToday,
  partitionMyDay,
  planRemovalOps,
  summarizeRemovalOps,
  EARLIER_WINDOW_DAYS,
  type MinimalSegment,
  type TodayPartitionTask,
  type RemovableSegment,
} from "../todayPlan";
import type { Id } from "../../_generated/dataModel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = "2026-07-06";
// Timestamp on TODAY in UTC
const TODAY_TS = new Date("2026-07-06T12:00:00Z").getTime();
const YESTERDAY_TS = new Date("2026-07-05T12:00:00Z").getTime();

let idCounter = 0;
function makeTask(overrides: Partial<TodayPartitionTask> = {}): TodayPartitionTask {
  idCounter++;
  return {
    _id: `task_${idCounter}` as unknown as Id<"tasks">,
    statusType: "in_progress",
    archivedAt: undefined,
    updatedAt: 1000 + idCounter,
    ...overrides,
  };
}

function makeSegment(
  taskId: Id<"tasks">,
  startDate: string,
  endDate: string,
  createdAt = 1000,
): MinimalSegment {
  return { taskId, startDate, endDate, createdAt };
}

function partition(
  tasks: TodayPartitionTask[],
  segments: MinimalSegment[],
  windowDays?: number,
) {
  return partitionMyDay(tasks, segments, TODAY, "UTC", windowDays);
}

// ─── addDaysToDateString ──────────────────────────────────────────────────────

describe("addDaysToDateString", () => {
  it("adds and subtracts days", () => {
    expect(addDaysToDateString("2026-07-06", 1)).toBe("2026-07-07");
    expect(addDaysToDateString("2026-07-06", -1)).toBe("2026-07-05");
  });

  it("crosses month and year boundaries", () => {
    expect(addDaysToDateString("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDaysToDateString("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysToDateString("2026-03-01", -1)).toBe("2026-02-28");
  });
});

// ─── segmentCoversDate ────────────────────────────────────────────────────────

describe("segmentCoversDate", () => {
  const seg = { startDate: "2026-07-04", endDate: "2026-07-08" };

  it("covers first, middle, and last day inclusively", () => {
    expect(segmentCoversDate(seg, "2026-07-04")).toBe(true);
    expect(segmentCoversDate(seg, "2026-07-06")).toBe(true);
    expect(segmentCoversDate(seg, "2026-07-08")).toBe(true);
  });

  it("does not cover dates outside the range", () => {
    expect(segmentCoversDate(seg, "2026-07-03")).toBe(false);
    expect(segmentCoversDate(seg, "2026-07-09")).toBe(false);
  });

  it("covers a single-day segment on exactly that day", () => {
    const single = { startDate: "2026-07-06", endDate: "2026-07-06" };
    expect(segmentCoversDate(single, "2026-07-06")).toBe(true);
    expect(segmentCoversDate(single, "2026-07-05")).toBe(false);
    expect(segmentCoversDate(single, "2026-07-07")).toBe(false);
  });
});

// ─── partitionMyDay: Today membership ─────────────────────────────────────────

describe("partitionMyDay — Today membership", () => {
  it("includes a task whose multi-day segment covers today (first/middle/last day)", () => {
    const first = makeTask();
    const middle = makeTask();
    const last = makeTask();
    const segments = [
      makeSegment(first._id, TODAY, "2026-07-08"),
      makeSegment(middle._id, "2026-07-04", "2026-07-08"),
      makeSegment(last._id, "2026-07-04", TODAY),
    ];
    const { todayTaskIds } = partition([first, middle, last], segments);
    expect(todayTaskIds).toContain(first._id);
    expect(todayTaskIds).toContain(middle._id);
    expect(todayTaskIds).toContain(last._id);
  });

  it("includes a single-day segment for today", () => {
    const task = makeTask();
    const { todayTaskIds } = partition([task], [makeSegment(task._id, TODAY, TODAY)]);
    expect(todayTaskIds).toEqual([task._id]);
  });

  it("excludes segments ending yesterday or starting tomorrow (boundary exclusive)", () => {
    const endedYesterday = makeTask();
    const startsTomorrow = makeTask();
    const segments = [
      makeSegment(endedYesterday._id, "2026-07-01", "2026-07-05"),
      makeSegment(startsTomorrow._id, "2026-07-07", "2026-07-09"),
    ];
    const { todayTaskIds } = partition([endedYesterday, startsTomorrow], segments);
    expect(todayTaskIds).not.toContain(startsTomorrow._id);
    expect(todayTaskIds).not.toContain(endedYesterday._id);
  });

  it("dedupes overlapping segments of the same task into one entry", () => {
    const task = makeTask();
    const segments = [
      makeSegment(task._id, "2026-07-04", "2026-07-07", 100),
      makeSegment(task._id, TODAY, TODAY, 200),
    ];
    const { todayTaskIds } = partition([task], segments);
    expect(todayTaskIds).toEqual([task._id]);
  });

  it("excludes archived tasks even with a covering segment", () => {
    const task = makeTask({ archivedAt: 999 });
    const { todayTaskIds } = partition([task], [makeSegment(task._id, TODAY, TODAY)]);
    expect(todayTaskIds).toEqual([]);
  });

  it("excludes completed-today tasks (done/review updated today)", () => {
    const doneToday = makeTask({ statusType: "done", updatedAt: TODAY_TS });
    const reviewToday = makeTask({ statusType: "review", updatedAt: TODAY_TS });
    const segments = [
      makeSegment(doneToday._id, TODAY, TODAY),
      makeSegment(reviewToday._id, TODAY, TODAY),
    ];
    const { todayTaskIds } = partition([doneToday, reviewToday], segments);
    expect(todayTaskIds).toEqual([]);
  });

  it("keeps a done-type task NOT updated today in Today (stale done, still planned)", () => {
    const doneEarlier = makeTask({ statusType: "done", updatedAt: YESTERDAY_TS });
    const { todayTaskIds } = partition(
      [doneEarlier],
      [makeSegment(doneEarlier._id, TODAY, TODAY)],
    );
    expect(todayTaskIds).toEqual([doneEarlier._id]);
  });

  it("orders by earliest covering-segment createdAt (arrival order)", () => {
    const a = makeTask();
    const b = makeTask();
    const c = makeTask();
    const segments = [
      makeSegment(b._id, TODAY, TODAY, 200),
      makeSegment(a._id, "2026-07-01", "2026-07-10", 100),
      makeSegment(c._id, TODAY, TODAY, 300),
      // c also has an older segment NOT covering today — must not affect order
      makeSegment(c._id, "2026-07-01", "2026-07-02", 50),
    ];
    const { todayTaskIds } = partition([a, b, c], segments);
    expect(todayTaskIds).toEqual([a._id, b._id, c._id]);
  });

  it("ignores tasks with no segments at all", () => {
    const planned = makeTask();
    const unplanned = makeTask();
    const { todayTaskIds, earlierTaskIds } = partition(
      [planned, unplanned],
      [makeSegment(planned._id, TODAY, TODAY)],
    );
    expect(todayTaskIds).toEqual([planned._id]);
    expect(earlierTaskIds).toEqual([]);
  });
});

// ─── partitionMyDay: Earlier ──────────────────────────────────────────────────

describe("partitionMyDay — Earlier", () => {
  it("includes a task whose newest segment ended before today", () => {
    const task = makeTask();
    const { earlierTaskIds } = partition(
      [task],
      [makeSegment(task._id, "2026-07-03", "2026-07-05")],
    );
    expect(earlierTaskIds).toEqual([task._id]);
  });

  it("windowing: includes at exactly 14 days back, excludes at 15", () => {
    const atWindow = makeTask();
    const pastWindow = makeTask();
    const day14 = addDaysToDateString(TODAY, -EARLIER_WINDOW_DAYS); // 2026-06-22
    const day15 = addDaysToDateString(TODAY, -(EARLIER_WINDOW_DAYS + 1));
    const segments = [
      makeSegment(atWindow._id, day14, day14),
      makeSegment(pastWindow._id, day15, day15),
    ];
    const { earlierTaskIds } = partition([atWindow, pastWindow], segments);
    expect(earlierTaskIds).toEqual([atWindow._id]);
  });

  it("excludes tasks with coverage today (they are in Today instead)", () => {
    const task = makeTask();
    const segments = [
      makeSegment(task._id, "2026-07-01", "2026-07-03"),
      makeSegment(task._id, TODAY, TODAY),
    ];
    const { todayTaskIds, earlierTaskIds } = partition([task], segments);
    expect(todayTaskIds).toEqual([task._id]);
    expect(earlierTaskIds).toEqual([]);
  });

  it("excludes finished tasks (done/review) and archived tasks", () => {
    const done = makeTask({ statusType: "done" });
    const review = makeTask({ statusType: "review" });
    const archived = makeTask({ archivedAt: 999 });
    const open = makeTask();
    const seg = (t: TodayPartitionTask) => makeSegment(t._id, "2026-07-04", "2026-07-05");
    const { earlierTaskIds } = partition(
      [done, review, archived, open],
      [seg(done), seg(review), seg(archived), seg(open)],
    );
    expect(earlierTaskIds).toEqual([open._id]);
  });

  it("uses the NEWEST segment: a future-planned task is not a leftover", () => {
    const replanned = makeTask();
    const segments = [
      makeSegment(replanned._id, "2026-07-03", "2026-07-04"),
      makeSegment(replanned._id, "2026-07-08", "2026-07-09"),
    ];
    const { todayTaskIds, earlierTaskIds } = partition([replanned], segments);
    expect(todayTaskIds).toEqual([]);
    expect(earlierTaskIds).toEqual([]);
  });

  it("orders newest-ended first", () => {
    const older = makeTask();
    const newer = makeTask();
    const segments = [
      makeSegment(older._id, "2026-07-01", "2026-07-02"),
      makeSegment(newer._id, "2026-07-04", "2026-07-05"),
    ];
    const { earlierTaskIds } = partition([older, newer], segments);
    expect(earlierTaskIds).toEqual([newer._id, older._id]);
  });

  it("respects a custom window", () => {
    const task = makeTask();
    const threeDaysAgo = addDaysToDateString(TODAY, -3);
    const { earlierTaskIds } = partition(
      [task],
      [makeSegment(task._id, threeDaysAgo, threeDaysAgo)],
      2,
    );
    expect(earlierTaskIds).toEqual([]);
  });
});

// ─── planRemovalOps ───────────────────────────────────────────────────────────

describe("planRemovalOps", () => {
  const seg = (id: string, startDate: string, endDate: string): RemovableSegment => ({
    _id: id,
    startDate,
    endDate,
  });

  it("single-day segment → delete", () => {
    const ops = planRemovalOps([seg("s1", TODAY, TODAY)], TODAY);
    expect(ops).toEqual([{ op: "delete", segmentId: "s1" }]);
    expect(summarizeRemovalOps(ops)).toBe("deleted");
  });

  it("spans past and future → split: patch to yesterday + insert from tomorrow", () => {
    const ops = planRemovalOps([seg("s1", "2026-07-02", "2026-07-10")], TODAY);
    expect(ops).toEqual([
      { op: "patch", segmentId: "s1", startDate: "2026-07-02", endDate: "2026-07-05" },
      { op: "insert", fromSegmentId: "s1", startDate: "2026-07-07", endDate: "2026-07-10" },
    ]);
    expect(summarizeRemovalOps(ops)).toBe("split");
  });

  it("starts today, ends later → trim start to tomorrow", () => {
    const ops = planRemovalOps([seg("s1", TODAY, "2026-07-09")], TODAY);
    expect(ops).toEqual([
      { op: "patch", segmentId: "s1", startDate: "2026-07-07", endDate: "2026-07-09" },
    ]);
    expect(summarizeRemovalOps(ops)).toBe("trimmed");
  });

  it("started earlier, ends today → trim end to yesterday", () => {
    const ops = planRemovalOps([seg("s1", "2026-07-03", TODAY)], TODAY);
    expect(ops).toEqual([
      { op: "patch", segmentId: "s1", startDate: "2026-07-03", endDate: "2026-07-05" },
    ]);
    expect(summarizeRemovalOps(ops)).toBe("trimmed");
  });

  it("multiple covering segments are all operated on at once", () => {
    const ops = planRemovalOps(
      [
        seg("single", TODAY, TODAY),
        seg("spanning", "2026-07-01", "2026-07-10"),
        seg("endsToday", "2026-07-05", TODAY),
      ],
      TODAY,
    );
    expect(ops).toHaveLength(4); // delete + (patch+insert) + patch
    expect(ops.filter((o) => o.op === "delete")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "insert")).toHaveLength(1);
    expect(ops.filter((o) => o.op === "patch")).toHaveLength(2);
    expect(summarizeRemovalOps(ops)).toBe("split");
  });

  it("ignores non-covering segments defensively and returns [] when nothing covers", () => {
    const ops = planRemovalOps(
      [seg("past", "2026-07-01", "2026-07-05"), seg("future", "2026-07-07", "2026-07-09")],
      TODAY,
    );
    expect(ops).toEqual([]);
    expect(summarizeRemovalOps(ops)).toBeNull();
  });
});

// ─── isCompletedToday ─────────────────────────────────────────────────────────

describe("isCompletedToday", () => {
  it("true for done/review updated today, false otherwise", () => {
    expect(isCompletedToday({ statusType: "done", updatedAt: TODAY_TS }, TODAY, "UTC")).toBe(true);
    expect(isCompletedToday({ statusType: "review", updatedAt: TODAY_TS }, TODAY, "UTC")).toBe(true);
    expect(isCompletedToday({ statusType: "done", updatedAt: YESTERDAY_TS }, TODAY, "UTC")).toBe(false);
    expect(isCompletedToday({ statusType: "in_progress", updatedAt: TODAY_TS }, TODAY, "UTC")).toBe(false);
  });
});

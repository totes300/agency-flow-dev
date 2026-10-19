import { describe, expect, it } from "vitest";
import {
  addDaysToDateString,
  segmentCoversDate,
  planRemovalOps,
  summarizeRemovalOps,
  type RemovableSegment,
} from "../todayPlan";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TODAY = "2026-07-06";

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

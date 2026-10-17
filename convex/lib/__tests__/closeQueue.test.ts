import { describe, it, expect } from "vitest";
import {
  summarizeQueueScope,
  groupQueueByMonth,
  type MonthGroupInput,
} from "../closeQueue";
import type { CloseFlag } from "../closeFlags";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;

/** The two fields `summarizeQueueScope` reads off a period view. */
function report(over: { entries?: unknown[]; usageMinutes?: number } = {}) {
  return { entries: [] as unknown[], usageMinutes: 0, ...over };
}

const scopeEntry = (over: { entryId?: Id<"timeEntries"> } = {}) => ({
  entryId: id<"timeEntries">("e_1"),
  ...over,
});

describe("summarizeQueueScope", () => {
  it("counts in-scope entries, review flags (excluding info), and billable minutes", () => {
    const scope = report({
      entries: [scopeEntry(), scopeEntry({ entryId: id<"timeEntries">("e_2") })],
      usageMinutes: 420,
    });
    const flags: CloseFlag[] = [
      { kind: "missing-note", severity: "warning", entryId: id<"timeEntries">("e_1") },
      { kind: "missing-overage-rate", severity: "blocking" },
      {
        kind: "carried-in",
        severity: "info",
        entryId: id<"timeEntries">("e_2"),
        carried: { reason: "skipped", originMonthKey: "2026-05" },
      },
    ];
    const s = summarizeQueueScope(scope, flags);
    expect(s.entryCount).toBe(2);
    expect(s.flagCount).toBe(2); // warning + blocking, info excluded
    expect(s.loggedMinutes).toBe(420);
  });

  it("reports zero flags for an all-clear period", () => {
    const s = summarizeQueueScope(report({ entries: [scopeEntry()] }), []);
    expect(s).toEqual({ entryCount: 1, flagCount: 0, loggedMinutes: 0 });
  });
});

describe("groupQueueByMonth (progress + totals)", () => {
  type Row = MonthGroupInput & { key: string };
  const rows: Row[] = [
    { key: "a", monthKey: "2026-06", amountMinor: 10010, currency: "USD" },
    { key: "b", monthKey: "2026-06", amountMinor: 5020, currency: "USD" },
    { key: "c", monthKey: "2026-05", amountMinor: 20000, currency: "USD" },
    { key: "d", monthKey: "2026-06", amountMinor: 3000, currency: "EUR" },
  ];

  it("groups oldest month first with per-currency totals summed in minor units", () => {
    const groups = groupQueueByMonth(rows, new Map());
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-05", "2026-06"]);
    const june = groups[1];
    expect(june.rows).toHaveLength(3);
    expect(june.totalsByCurrency).toEqual({ USD: 150.3, EUR: 30 });
  });

  it("computes N of M closed progress from committedByMonth", () => {
    const groups = groupQueueByMonth(rows, new Map([["2026-06", 2]]));
    const june = groups.find((g) => g.monthKey === "2026-06")!;
    expect(june.openCount).toBe(3);
    expect(june.closedCount).toBe(2);
    expect(june.totalCount).toBe(5); // 3 open + 2 committed
    const may = groups.find((g) => g.monthKey === "2026-05")!;
    expect(may.closedCount).toBe(0);
    expect(may.totalCount).toBe(1);
  });

  it("omits a fully-committed month that has no open rows", () => {
    const groups = groupQueueByMonth(rows, new Map([["2026-04", 3]]));
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-05", "2026-06"]);
  });
});

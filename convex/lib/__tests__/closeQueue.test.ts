import { describe, it, expect } from "vitest";
import {
  summarizeQueueScope,
  assignDisabledReasons,
  groupQueueByMonth,
  type DisableInput,
  type MonthGroupInput,
} from "../closeQueue";
import type { BillingScopeReport, ScopeEntry } from "../billingScope";
import type { CloseFlag } from "../closeFlags";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;

function scopeEntry(over: Partial<ScopeEntry> = {}): ScopeEntry {
  return {
    entryId: id<"timeEntries">("e_1"),
    date: "2026-06-10",
    durationMinutes: 60,
    isBillable: true,
    note: "worked",
    carried: false,
    originMonthKey: "2026-06",
    ...over,
  };
}

function report(over: Partial<BillingScopeReport> = {}): BillingScopeReport {
  return {
    billingType: "retainer",
    period: { start: "2026-06-01", end: "2026-06-30" },
    entries: [],
    usageMinutes: 0,
    includedMinutes: 600,
    overageMinutes: 0,
    overageAmount: 0,
    amount: 0,
    withinBudget: true,
    usageByMonth: {},
    carriedInMinutes: 0,
    monthlyBalances: [],
    balanceToDateMinutes: 0,
    committable: true,
    issues: [],
    fromSettlementStamps: false,
    ...over,
  };
}

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

describe("assignDisabledReasons (I3 oldest-first)", () => {
  const rows: DisableInput[] = [
    { key: "p1:2026-05", projectId: "p1", sortKey: "2026-05", committable: true, periodLabel: "May 2026" },
    { key: "p1:2026-06", projectId: "p1", sortKey: "2026-06", committable: false, periodLabel: "June 2026" },
    { key: "p1:2026-07", projectId: "p1", sortKey: "2026-07", committable: false, periodLabel: "July 2026" },
    { key: "p2:2026-06", projectId: "p2", sortKey: "2026-06", committable: true, periodLabel: "June 2026" },
  ];

  it("blocks later periods of a project pointing at its earliest open period", () => {
    const out = assignDisabledReasons(rows);
    expect(out.get("p1:2026-05")).toBeUndefined();
    expect(out.get("p1:2026-06")).toBe("Close May 2026 first");
    expect(out.get("p1:2026-07")).toBe("Close May 2026 first");
  });

  it("never disables a project's only (committable) row", () => {
    const out = assignDisabledReasons(rows);
    expect(out.get("p2:2026-06")).toBeUndefined();
  });

  it("uses the earliest period's label regardless of row order", () => {
    const shuffled = [rows[2], rows[0], rows[1]];
    const out = assignDisabledReasons(shuffled);
    expect(out.get("p1:2026-06")).toBe("Close May 2026 first");
    expect(out.get("p1:2026-07")).toBe("Close May 2026 first");
  });

  it("falls back to a generic hint when the earliest visible row is itself blocked", () => {
    // A project whose only visible row is non-committable — its true blocking
    // period produced no queue row (e.g. a $0 T&M month). Avoid a
    // self-referential "Close April first" on the April row.
    const out = assignDisabledReasons([
      {
        key: "p3:2026-04",
        projectId: "p3",
        sortKey: "2026-04",
        committable: false,
        periodLabel: "April 2026",
      },
    ]);
    expect(out.get("p3:2026-04")).toBe("Close earlier period first");
  });
});

describe("groupQueueByMonth (progress + totals)", () => {
  type Row = MonthGroupInput & { key: string };
  const rows: Row[] = [
    { key: "a", monthKey: "2026-06", amount: 100, currency: "USD" },
    { key: "b", monthKey: "2026-06", amount: 50, currency: "USD" },
    { key: "c", monthKey: "2026-05", amount: 200, currency: "USD" },
    { key: "d", monthKey: "2026-06", amount: 30, currency: "EUR" },
  ];

  it("groups oldest month first with per-currency totals", () => {
    const groups = groupQueueByMonth(rows, new Map());
    expect(groups.map((g) => g.monthKey)).toEqual(["2026-05", "2026-06"]);
    const june = groups[1];
    expect(june.rows).toHaveLength(3);
    expect(june.totalsByCurrency).toEqual({ USD: 150, EUR: 30 });
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

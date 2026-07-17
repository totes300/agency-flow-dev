import { describe, it, expect } from "vitest";
import { selectCommitEntries, isWholeCalendarMonth } from "../commitScope";
import type { BillingScopeReport } from "../billingScope";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;

function report(entries: BillingScopeReport["entries"]): BillingScopeReport {
  return {
    billingType: "retainer",
    period: { start: "2026-06-01", end: "2026-06-30" },
    entries,
    usageMinutes: 0,
    includedMinutes: 600,
    overageMinutes: 0,
    overageAmount: 0,
    amount: 0,
    withinBudget: true,
    usageByMonth: {},
    committable: true,
    issues: [],
    fromSettlementStamps: false,
  };
}

function entry(over: Partial<BillingScopeReport["entries"][number]>) {
  return {
    entryId: id<"timeEntries">("e"),
    date: "2026-06-10",
    durationMinutes: 60,
    isBillable: true,
    carried: false,
    originMonthKey: "2026-06",
    ...over,
  };
}

describe("selectCommitEntries", () => {
  it("invoice set = billable in-scope; settle set = all in-scope (incl non-billable)", () => {
    const r = report([
      entry({ entryId: id<"timeEntries">("a"), isBillable: true }),
      entry({ entryId: id<"timeEntries">("b"), isBillable: false }),
    ]);
    const sel = selectCommitEntries(r);
    expect([...sel.invoiceEntryIds].sort()).toEqual(["a"]);
    expect([...sel.settleEntryIds].sort()).toEqual(["a", "b"]);
  });

  it("empty scope yields empty sets (zero-scope close)", () => {
    const sel = selectCommitEntries(report([]));
    expect(sel.invoiceEntryIds.size).toBe(0);
    expect(sel.settleEntryIds.size).toBe(0);
  });
});

describe("isWholeCalendarMonth", () => {
  it("true only for a full calendar month", () => {
    expect(isWholeCalendarMonth("2026-06-01", "2026-06-30")).toBe(true);
    expect(isWholeCalendarMonth("2026-02-01", "2026-02-28")).toBe(true);
    expect(isWholeCalendarMonth("2026-06-01", "2026-06-15")).toBe(false); // partial
    expect(isWholeCalendarMonth("2026-06-05", "2026-06-30")).toBe(false); // not the 1st
    expect(isWholeCalendarMonth(undefined, "2026-06-30")).toBe(false);
    expect(isWholeCalendarMonth("2026-06-01", undefined)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { computeReportMonths } from "../reportMembership";
import { monthlySettlementPeriod } from "../settleEntries";
import type {
  ScopeProjectInput,
  ScopeEntryInput,
} from "../billingScope";
import type { DataModel, Id } from "../../_generated/dataModel";

const id = <T extends keyof DataModel>(s: string) => s as unknown as Id<T>;
const TODAY = "2026-07-13";

function retainerMonthly(over: Partial<ScopeProjectInput> = {}): ScopeProjectInput {
  return {
    _id: id<"projects">("p"),
    billingType: "retainer",
    startDate: "2026-05-01",
    rolloverEnabled: false,
    includedMinutesPerMonth: 600,
    overageRate: 100,
    ...over,
  };
}

let seq = 0;
function e(over: Partial<ScopeEntryInput> = {}): ScopeEntryInput {
  seq += 1;
  return {
    _id: id<"timeEntries">(`e_${seq}`),
    date: "2026-06-10",
    durationMinutes: 60,
    isBillable: true,
    ...over,
  };
}

describe("computeReportMonths", () => {
  it("settled entry → its stamped month (stable, ignores date)", () => {
    const settled = e({
      date: "2026-05-20",
      settledAt: 1,
      settledPeriodStart: "2026-06-01",
      settledPeriodEnd: "2026-06-30",
    });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [settled],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    // Stamped to June even though dated in May (carried-in that was settled).
    expect(m.get(settled._id.toString())).toBe("2026-06");
  });

  it("open entry → its effective (skip-aware) month", () => {
    // June entry skipped into July.
    const skipped = e({ date: "2026-06-20", skippedThrough: "2026-06-30" });
    // Plain June entry.
    const plain = e({ date: "2026-06-05" });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [skipped, plain],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(skipped._id.toString())).toBe("2026-07"); // moved forward
    expect(m.get(plain._id.toString())).toBe("2026-06");
  });

  it("open logged-late entry → the first open period (carried forward)", () => {
    // May is closed; an open entry dated in May resolves to June.
    const late = e({ date: "2026-05-10" });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [late],
      closedPeriods: [
        { periodStart: "2026-05-01", periodEnd: "2026-05-31", closedAt: 1 },
      ],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(late._id.toString())).toBe("2026-06");
  });

  it("draft-linked entry → its natural month (unchanged)", () => {
    const draft = e({ date: "2026-06-15", invoiceId: id<"invoices">("inv") });
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [draft],
      closedPeriods: [],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(draft._id.toString())).toBe("2026-06");
  });

  it("stability: a backdated open insert never lands in a closed month", () => {
    const closedMay = {
      periodStart: "2026-05-01",
      periodEnd: "2026-05-31",
      closedAt: 1,
    };
    const settledMay = e({
      date: "2026-05-10",
      settledAt: 1,
      settledPeriodStart: "2026-05-01",
      settledPeriodEnd: "2026-05-31",
    });
    const backdated = e({ date: "2026-05-25" }); // open, inserted after close
    const m = computeReportMonths({
      project: retainerMonthly(),
      entries: [settledMay, backdated],
      closedPeriods: [closedMay],
      invoices: [],
      todayStr: TODAY,
    });
    expect(m.get(settledMay._id.toString())).toBe("2026-05"); // stays
    expect(m.get(backdated._id.toString())).toBe("2026-06"); // carried forward, not May
  });
});

// ─── F3 (2026-07-19) — invoiced cycles must attribute per month ─────────────
//
// Before the stamp-invariant fix, cycle-invoice finalization stamped the whole
// CYCLE range on every entry, so `computeReportMonths` (settled → stamped
// month) collapsed all N months into month 1 on the Monthly Report and the
// settled-period worksheet. The load-bearing property is DIFFERENTIAL: a
// cycle billed by an overage invoice and the same cycle settled by
// `closeRetainerCycle` must attribute every entry to the SAME report month.
// Entries below are stamped exactly the way each production writer stamps
// them — both now route through `monthlySettlementPeriod`.

const CYCLE = { periodStart: "2026-04-01", periodEnd: "2026-06-30" };

function retainerCycle(): ScopeProjectInput {
  return {
    _id: id<"projects">("p_cycle"),
    billingType: "retainer",
    startDate: "2026-04-01",
    rolloverEnabled: true,
    cycleLength: 3,
    includedMinutesPerMonth: 600,
    overageRate: 100,
  };
}

/** Stamp fields as invoice finalization writes them since the F3 fix. */
function invoiceStamp(date: string): Partial<ScopeEntryInput> {
  const bucket = monthlySettlementPeriod(date, CYCLE);
  return {
    invoiceId: id<"invoices">("inv_cycle"),
    settledAt: 1,
    settledReason: "invoiced",
    settledPeriodStart: bucket.periodStart,
    settledPeriodEnd: bucket.periodEnd,
  };
}

/** Stamp fields as `closeRetainerCycle` writes them (same bucket rule). */
function closeStamp(date: string): Partial<ScopeEntryInput> {
  const bucket = monthlySettlementPeriod(date, CYCLE);
  return {
    settledAt: 1,
    settledReason: "retainer_included",
    settledPeriodStart: bucket.periodStart,
    settledPeriodEnd: bucket.periodEnd,
  };
}

const CYCLE_INVOICE = [
  {
    status: "invoiced" as const,
    periodStart: CYCLE.periodStart,
    periodEnd: CYCLE.periodEnd,
  },
];

describe("F3 — invoiced cycle report attribution", () => {
  it("each entry of an invoiced Apr–Jun cycle reports into its own month", () => {
    const apr = e({ date: "2026-04-10", ...invoiceStamp("2026-04-10") });
    const may = e({ date: "2026-05-10", ...invoiceStamp("2026-05-10") });
    const jun = e({ date: "2026-06-10", ...invoiceStamp("2026-06-10") });
    const m = computeReportMonths({
      project: retainerCycle(),
      entries: [apr, may, jun],
      closedPeriods: [],
      invoices: CYCLE_INVOICE,
      todayStr: "2026-07-19",
    });
    expect(m.get(apr._id.toString())).toBe("2026-04");
    expect(m.get(may._id.toString())).toBe("2026-05");
    expect(m.get(jun._id.toString())).toBe("2026-06");
  });

  it("a carried-in entry on the cycle invoice reports into the cycle's FIRST month", () => {
    // Dated before the cycle (skipped/logged-late into it) → receiving-period
    // rule → April bucket; the report renders it there as carried.
    const carried = e({ date: "2026-03-15", ...invoiceStamp("2026-03-15") });
    const m = computeReportMonths({
      project: retainerCycle(),
      entries: [carried],
      closedPeriods: [],
      invoices: CYCLE_INVOICE,
      todayStr: "2026-07-19",
    });
    expect(m.get(carried._id.toString())).toBe("2026-04");
  });

  it("differential: invoice path and close path attribute identically", () => {
    const dates = ["2026-04-10", "2026-05-10", "2026-06-10"];
    const invoiced = dates.map((d) => e({ date: d, ...invoiceStamp(d) }));
    const closed = dates.map((d) => e({ date: d, ...closeStamp(d) }));

    const invoicedMonths = computeReportMonths({
      project: retainerCycle(),
      entries: invoiced,
      closedPeriods: [],
      invoices: CYCLE_INVOICE,
      todayStr: "2026-07-19",
    });
    const closedMonths = computeReportMonths({
      project: retainerCycle(),
      entries: closed,
      closedPeriods: [
        { periodStart: "2026-04-01", periodEnd: "2026-04-30", closedAt: 1 },
        { periodStart: "2026-05-01", periodEnd: "2026-05-31", closedAt: 1 },
        { periodStart: "2026-06-01", periodEnd: "2026-06-30", closedAt: 1 },
      ],
      invoices: [],
      todayStr: "2026-07-19",
    });

    for (let i = 0; i < dates.length; i++) {
      expect(invoicedMonths.get(invoiced[i]._id.toString())).toBe(
        closedMonths.get(closed[i]._id.toString()),
      );
    }
  });

  it("worksheet compatibility: every invoice-path stamp is a single-month span", () => {
    // The settled-period worksheet filters `settledPeriodStart === YYYY-MM-01`
    // (worksheetsHelpers.ts) — valid only while stamps span one month.
    for (const d of ["2026-04-10", "2026-05-10", "2026-06-10", "2026-03-15"]) {
      const s = invoiceStamp(d);
      expect(s.settledPeriodStart!.slice(8)).toBe("01");
      expect(s.settledPeriodStart!.slice(0, 7)).toBe(
        s.settledPeriodEnd!.slice(0, 7),
      );
    }
  });
});

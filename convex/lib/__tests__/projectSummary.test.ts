import { describe, it, expect } from "vitest";
import {
  computeTmSummary,
  computeFixedSummary,
  computeRetainerSummary,
  resolveDateRange,
  filterEntriesByDate,
  type EntryInput,
  type LineItemInput,
  type DateRange,
  type RetainerCycleContext,
} from "../projectSummary";

// ─── Helpers ────────────────────────────────────────────────────────────────

const allRange: DateRange = {
  preset: "all",
  from: "0000-01-01",
  to: "9999-12-31",
};

function entry(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    durationMinutes: 60,
    isBillable: true,
    invoiceId: null,
    costRate: 50,
    billableRate: 120,
    date: "2026-04-01",
    ...overrides,
  };
}

// ─── T&M ────────────────────────────────────────────────────────────────────

describe("computeTmSummary", () => {
  const defaultArgs = {
    currency: "EUR",
    subtitle: "Time & Materials Billing",
    isAdmin: true,
    dateRange: allRange,
  };

  it("empty project — all zero, margin null", () => {
    const result = computeTmSummary({ ...defaultArgs, entries: [] });
    expect(result.timeBreakdown).toEqual({
      totalMinutes: 0,
      billableMinutes: 0,
      nonBillableMinutes: 0,
    });
    expect(result.billingStatus).toEqual({
      billedMinutes: 0,
      unbilledMinutes: 0,
      billedAmount: 0,
      unbilledAmount: 0,
    });
    expect(result.profitability).toEqual({
      revenue: 0,
      totalCost: 0,
      profit: 0,
      marginPercent: null,
      currency: "EUR",
    });
  });

  it("happy path — 3 billable (1 invoiced), 1 non-billable", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 120, isBillable: true, invoiceId: "inv1", billableRate: 100, costRate: 40 }),
      entry({ durationMinutes: 60,  isBillable: true, invoiceId: null,   billableRate: 100, costRate: 40 }),
      entry({ durationMinutes: 180, isBillable: true, invoiceId: null,   billableRate: 150, costRate: 60 }),
      entry({ durationMinutes: 30,  isBillable: false, costRate: 40 }),
    ];
    const result = computeTmSummary({ ...defaultArgs, entries });

    expect(result.timeBreakdown.totalMinutes).toBe(390);
    expect(result.timeBreakdown.billableMinutes).toBe(360);
    expect(result.timeBreakdown.nonBillableMinutes).toBe(30);

    // Billed: 120 min × 100€/h = 200€
    expect(result.billingStatus?.billedAmount).toBe(200);
    expect(result.billingStatus?.billedMinutes).toBe(120);

    // Unbilled: 60 × 100 + 180 × 150 = 100 + 450 = 550€
    expect(result.billingStatus?.unbilledAmount).toBe(550);
    expect(result.billingStatus?.unbilledMinutes).toBe(240);

    // Revenue = Billed + Unbilled = 750
    expect(result.profitability?.revenue).toBe(750);

    // Cost: (120+60)/60 × 40 + 180/60 × 60 + 30/60 × 40
    //     = 120 + 180 + 20 = 320
    expect(result.profitability?.totalCost).toBe(320);

    expect(result.profitability?.profit).toBe(430);
    // margin = 430/750 ≈ 57.33 → 57
    expect(result.profitability?.marginPercent).toBe(57);
  });

  it("date range filter — excludes entries outside range", () => {
    const entries: EntryInput[] = [
      entry({ date: "2026-01-15", durationMinutes: 60, billableRate: 100, costRate: 40 }),
      entry({ date: "2026-04-10", durationMinutes: 60, billableRate: 100, costRate: 40 }),
      entry({ date: "2026-04-20", durationMinutes: 60, billableRate: 100, costRate: 40 }),
    ];
    const result = computeTmSummary({
      ...defaultArgs,
      entries,
      dateRange: { preset: "this_month", from: "2026-04-01", to: "2026-04-30" },
    });

    expect(result.timeBreakdown.totalMinutes).toBe(120);
    expect(result.profitability?.revenue).toBe(200);
    expect(result.profitability?.totalCost).toBe(80);
  });

  it("all non-billable — revenue 0, margin null, cost positive", () => {
    const entries: EntryInput[] = [
      entry({ isBillable: false, durationMinutes: 120, costRate: 50 }),
      entry({ isBillable: false, durationMinutes: 60,  costRate: 50 }),
    ];
    const result = computeTmSummary({ ...defaultArgs, entries });

    expect(result.profitability?.revenue).toBe(0);
    expect(result.profitability?.totalCost).toBe(150);
    expect(result.profitability?.profit).toBe(-150);
    expect(result.profitability?.marginPercent).toBeNull();
  });

  it("custom range — inclusive boundaries", () => {
    const entries: EntryInput[] = [
      entry({ date: "2026-03-31", durationMinutes: 60 }),
      entry({ date: "2026-04-01", durationMinutes: 60 }),
      entry({ date: "2026-04-30", durationMinutes: 60 }),
      entry({ date: "2026-05-01", durationMinutes: 60 }),
    ];
    const result = computeTmSummary({
      ...defaultArgs,
      entries,
      dateRange: { preset: "custom", from: "2026-04-01", to: "2026-04-30" },
    });
    expect(result.timeBreakdown.totalMinutes).toBe(120);
  });

  it("member view (isAdmin=false) — only timeBreakdown", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 60, isBillable: true, costRate: 40, billableRate: 100 }),
    ];
    const result = computeTmSummary({ ...defaultArgs, entries, isAdmin: false });

    expect(result.timeBreakdown.totalMinutes).toBe(60);
    expect(result.billingStatus).toBeUndefined();
    expect(result.profitability).toBeUndefined();
  });

  it("costRate=0 entries — margin 100%, no warning (intentional)", () => {
    // D1: costRate=0 is a valid configuration (e.g. unpaid intern).
    const entries: EntryInput[] = [
      entry({ durationMinutes: 120, isBillable: true, billableRate: 150, costRate: 0 }),
    ];
    const result = computeTmSummary({ ...defaultArgs, entries });
    expect(result.profitability?.totalCost).toBe(0);
    expect(result.profitability?.marginPercent).toBe(100);
  });
});

// ─── Fixed ──────────────────────────────────────────────────────────────────

describe("computeFixedSummary", () => {
  const defaultArgs = {
    currency: "EUR",
    subtitle: "Fixed Fee Billing",
    isAdmin: true,
    estimatedBudgetMinutes: null,
  };

  it("empty project — contract value = fixedPrice, slot=unbilled, cost 0", () => {
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.fixedPrice).toBe(5000);
    expect(result.billingStatus?.billedAmount).toBe(0);
    expect(result.billingStatus?.slot).toBe("unbilled");
    expect(result.billingStatus?.slotAmount).toBe(5000);
    expect(result.profitability?.revenue).toBe(5000);
    expect(result.profitability?.totalCost).toBe(0);
    expect(result.profitability?.marginPercent).toBe(100);
  });

  it("billed < fee — slot=unbilled with remaining amount", () => {
    const lineItems: LineItemInput[] = [
      { lineType: "fixed", amount: 2000, invoiceStatus: "invoiced" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "invoiced", total: 2000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.slot).toBe("unbilled");
    expect(result.billingStatus?.billedAmount).toBe(2000);
    expect(result.billingStatus?.slotAmount).toBe(3000);
    expect(result.profitability?.revenue).toBe(5000);
  });

  it("billed = fee — slot=fully_invoiced, slotAmount=0", () => {
    const lineItems: LineItemInput[] = [
      { lineType: "fixed", amount: 5000, invoiceStatus: "invoiced" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "invoiced", total: 5000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.slot).toBe("fully_invoiced");
    expect(result.billingStatus?.slotAmount).toBe(0);
    expect(result.profitability?.revenue).toBe(5000);
  });

  it("fixed invoiced fully + extra manual line — slot=fully_invoiced, contract value lifts to manual total", () => {
    // Slot tracks fixed-line progress (billedAmount === fixedPrice → fully_invoiced).
    // Manual line does NOT change the slot, but lifts Contract Value via totalBilledAcrossLineTypes.
    const lineItems: LineItemInput[] = [
      { lineType: "fixed",  amount: 5000, invoiceStatus: "invoiced" },
      { lineType: "manual", amount: 1000, invoiceStatus: "invoiced" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "invoiced", total: 6000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.slot).toBe("fully_invoiced");
    expect(result.billingStatus?.billedAmount).toBe(5000);
    expect(result.billingStatus?.slotAmount).toBe(0);
    // Contract value picks up the manual line: max(5000, 5000+1000) = 6000.
    expect(result.profitability?.revenue).toBe(6000);
  });

  it("manual extra only (no fixed line invoiced) — slot=unbilled, contract value includes manual", () => {
    const lineItems: LineItemInput[] = [
      { lineType: "manual", amount: 1000, invoiceStatus: "invoiced" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "invoiced", total: 1000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.billedAmount).toBe(0);
    expect(result.billingStatus?.slot).toBe("unbilled");
    expect(result.billingStatus?.slotAmount).toBe(5000);
    // Contract value = max(5000, 1000) = 5000 (floor holds)
    expect(result.profitability?.revenue).toBe(5000);
  });

  it("billed > fee (fixed line overbilled directly) — slot=extra_billed, slotAmount positive", () => {
    const lineItems: LineItemInput[] = [
      { lineType: "fixed", amount: 6000, invoiceStatus: "invoiced" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "invoiced", total: 6000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.slot).toBe("extra_billed");
    expect(result.billingStatus?.billedAmount).toBe(6000);
    expect(result.billingStatus?.slotAmount).toBe(1000);
    expect(result.profitability?.revenue).toBe(6000);
  });

  it("draft invoice excluded from billedAmount and contract value", () => {
    const lineItems: LineItemInput[] = [
      { lineType: "fixed",  amount: 5000, invoiceStatus: "draft" },
      { lineType: "manual", amount: 1000, invoiceStatus: "draft" },
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [{ status: "draft", total: 6000 }],
      lineItems,
      fixedPrice: 5000,
    });
    expect(result.billingStatus?.billedAmount).toBe(0);
    expect(result.billingStatus?.slot).toBe("unbilled");
    expect(result.profitability?.revenue).toBe(5000);
  });

  it("fixedPrice=null — contract value 0, margin null", () => {
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [],
      lineItems: [],
      fixedPrice: null,
    });
    expect(result.billingStatus?.fixedPrice).toBeNull();
    expect(result.profitability?.revenue).toBe(0);
    expect(result.profitability?.marginPercent).toBeNull();
  });

  it("cost accrues from all entries regardless of billable flag", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 120, isBillable: true,  costRate: 50 }),
      entry({ durationMinutes: 60,  isBillable: false, costRate: 50 }),
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
    });
    // 120/60 × 50 + 60/60 × 50 = 100 + 50 = 150
    expect(result.profitability?.totalCost).toBe(150);
    expect(result.timeBreakdown.totalMinutes).toBe(180);
  });

  it("estimated budget → remaining minutes computed", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 300 }),
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: 1000,
    });
    expect(result.timeBreakdown.estimatedBudgetMinutes).toBe(1000);
    expect(result.timeBreakdown.remainingMinutes).toBe(700);
  });

  it("member view (isAdmin=false) — only timeBreakdown", () => {
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [entry({ durationMinutes: 60 })],
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      isAdmin: false,
    });
    expect(result.timeBreakdown.totalMinutes).toBe(60);
    expect(result.billingStatus).toBeUndefined();
    expect(result.profitability).toBeUndefined();
  });

  // ─── Expected / Effective hourly rate ───────────────────────────────────

  it("under budget — effective rate > expected rate (tracking ahead)", () => {
    // $5000 / 50h = $100/h expected. 48h logged → $5000/48 ≈ $104.17/h effective.
    const entries: EntryInput[] = [
      entry({ durationMinutes: 2880, isBillable: true, costRate: 40 }), // 48h
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: 3000, // 50h
    });
    expect(result.profitability?.expectedHourlyRate).toBe(100);
    expect(result.profitability?.effectiveHourlyRate).toBeCloseTo(104.17, 1);
  });

  it("on budget — expected equals effective rate", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 3000, isBillable: true, costRate: 40 }), // 50h
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: 3000,
    });
    expect(result.profitability?.expectedHourlyRate).toBe(100);
    expect(result.profitability?.effectiveHourlyRate).toBe(100);
  });

  it("over budget (scope creep) — effective rate < expected rate", () => {
    // $5000 / 50h = $100/h sold, but 60h logged → effective $83.33/h.
    const entries: EntryInput[] = [
      entry({ durationMinutes: 3600, isBillable: true, costRate: 40 }), // 60h
    ];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: 3000,
    });
    expect(result.profitability?.expectedHourlyRate).toBe(100);
    expect(result.profitability?.effectiveHourlyRate).toBeCloseTo(83.33, 1);
  });

  it("no budget set — expected rate null", () => {
    const entries: EntryInput[] = [entry({ durationMinutes: 60 })];
    const result = computeFixedSummary({
      ...defaultArgs,
      entries,
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: null,
    });
    expect(result.profitability?.expectedHourlyRate).toBeNull();
    // Effective still computable since fixedPrice + totalMinutes exist.
    expect(result.profitability?.effectiveHourlyRate).toBe(5000);
  });

  it("no time logged — effective rate null", () => {
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [],
      invoices: [],
      lineItems: [],
      fixedPrice: 5000,
      estimatedBudgetMinutes: 3000,
    });
    expect(result.profitability?.expectedHourlyRate).toBe(100);
    expect(result.profitability?.effectiveHourlyRate).toBeNull();
  });

  it("fixedPrice null — both rates null", () => {
    const result = computeFixedSummary({
      ...defaultArgs,
      entries: [entry({ durationMinutes: 60 })],
      invoices: [],
      lineItems: [],
      fixedPrice: null,
      estimatedBudgetMinutes: 3000,
    });
    expect(result.profitability?.expectedHourlyRate).toBeNull();
    expect(result.profitability?.effectiveHourlyRate).toBeNull();
  });
});

// ─── Retainer ───────────────────────────────────────────────────────────────

describe("computeRetainerSummary", () => {
  const cycle: RetainerCycleContext = {
    number: 1,
    offset: 0,
    start: "2026-04-01",
    end: "2026-04-30",
    length: 1,
    isCycleClosed: false,
    hasPreviousCycle: false,
    hasNextCycle: false,
    hasUninvoicedClosedMonth: false,
  };
  const defaultArgs = {
    currency: "EUR",
    subtitle: "Apr 2026 · 1-month monthly",
    isAdmin: true,
    monthlyFee: 2000,
    overageRate: 150,
    includedMinutesPerMonth: 600, // 10 hours
    cycle,
    // Pooled-cycle math (the pre-2026-07-05 behavior all tests below
    // assert). Non-rollover per-month overage has its own cases at the end.
    rolloverEnabled: true,
  };

  it("empty cycle — revenue = fee only, cost 0, no overage", () => {
    const result = computeRetainerSummary({ ...defaultArgs, entries: [] });

    expect(result.timeBreakdown.cycleBudgetMinutes).toBe(600);
    expect(result.timeBreakdown.totalMinutes).toBe(0);
    expect(result.overage?.overBudgetMinutes).toBe(0);
    expect(result.overage?.overageDueAmount).toBe(0);
    expect(result.profitability?.revenue).toBe(2000);
    expect(result.profitability?.totalCost).toBe(0);
  });

  it("half-consumed cycle — no overage", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 300, isBillable: true, costRate: 60 }),
    ];
    const result = computeRetainerSummary({ ...defaultArgs, entries });
    expect(result.timeBreakdown.billableMinutes).toBe(300);
    expect(result.overage?.overBudgetMinutes).toBe(0);
    expect(result.overage?.overageDueAmount).toBe(0);
    expect(result.profitability?.revenue).toBe(2000);
    expect(result.profitability?.totalCost).toBe(300);
  });

  it("over-budget open cycle — live overage reflected in revenue", () => {
    // 720 min billable, budget 600 → 120 min over, @150€/h = 300€ overage
    const entries: EntryInput[] = [
      entry({ durationMinutes: 720, isBillable: true, costRate: 60 }),
    ];
    const result = computeRetainerSummary({ ...defaultArgs, entries });
    expect(result.overage?.overBudgetMinutes).toBe(120);
    expect(result.overage?.overageDueAmount).toBe(300);
    expect(result.profitability?.revenue).toBe(2300); // fee 2000 + overage 300
  });

  it("closed cycle — same formula (fee + settled overage)", () => {
    const closed: RetainerCycleContext = { ...cycle, isCycleClosed: true };
    const entries: EntryInput[] = [
      entry({ durationMinutes: 720, isBillable: true, costRate: 60 }),
    ];
    const result = computeRetainerSummary({
      ...defaultArgs,
      cycle: closed,
      entries,
    });
    expect(result.cycle.isCycleClosed).toBe(true);
    expect(result.overage?.overageDueAmount).toBe(300);
    expect(result.profitability?.revenue).toBe(2300);
  });

  it("multi-month cycle — budget = monthly × length", () => {
    const threeMonthCycle: RetainerCycleContext = {
      ...cycle,
      length: 3,
      start: "2026-04-01",
      end: "2026-06-30",
    };
    const result = computeRetainerSummary({
      ...defaultArgs,
      cycle: threeMonthCycle,
      entries: [],
    });
    expect(result.timeBreakdown.cycleBudgetMinutes).toBe(1800); // 600 × 3
    expect(result.profitability?.revenue).toBe(6000); // 2000 × 3
  });

  it("non-billable time does not consume budget but contributes to cost", () => {
    const entries: EntryInput[] = [
      entry({ durationMinutes: 600, isBillable: true,  costRate: 60 }),
      entry({ durationMinutes: 120, isBillable: false, costRate: 60 }),
    ];
    const result = computeRetainerSummary({ ...defaultArgs, entries });
    // Billable = 600 → exactly at budget, no overage.
    expect(result.overage?.overBudgetMinutes).toBe(0);
    // Cost = (600+120)/60 × 60 = 720
    expect(result.profitability?.totalCost).toBe(720);
    // Revenue = fee, no overage.
    expect(result.profitability?.revenue).toBe(2000);
  });

  it("hasUninvoicedClosedMonth flag propagates", () => {
    const closedWithUninvoiced: RetainerCycleContext = {
      ...cycle,
      isCycleClosed: true,
      hasUninvoicedClosedMonth: true,
    };
    const result = computeRetainerSummary({
      ...defaultArgs,
      cycle: closedWithUninvoiced,
      entries: [],
    });
    expect(result.cycle.hasUninvoicedClosedMonth).toBe(true);
  });

  it("member view (isAdmin=false) — only timeBreakdown and cycle meta", () => {
    const result = computeRetainerSummary({
      ...defaultArgs,
      entries: [entry({ durationMinutes: 600, isBillable: true })],
      isAdmin: false,
    });
    expect(result.timeBreakdown.totalMinutes).toBe(600);
    expect(result.cycle.number).toBe(1);
    expect(result.overage).toBeUndefined();
    expect(result.profitability).toBeUndefined();
  });

  it("non-rollover multi-month: overage sums per-month excess (idle months don't absorb)", () => {
    // 3-month cycle, 10h/month budget. Month 1 works 20h (10h over),
    // months 2–3 idle. Pooled math would report 0 overage (20h < 30h
    // budget) — the bug this fixes. Per-month math reports 10h.
    const threeMonthCycle: RetainerCycleContext = {
      ...cycle,
      end: "2026-06-30",
      length: 3,
    };
    const result = computeRetainerSummary({
      ...defaultArgs,
      cycle: threeMonthCycle,
      rolloverEnabled: false,
      monthBillableMinutes: new Map([["2026-04", 1200]]),
      entries: [entry({ durationMinutes: 1200, isBillable: true })],
    });
    expect(result.overage?.overBudgetMinutes).toBe(600);
    expect(result.overage?.overageDueAmount).toBe((600 / 60) * 150);
  });

  it("rollover multi-month: same shape stays pooled (no overage under aggregate budget)", () => {
    const threeMonthCycle: RetainerCycleContext = {
      ...cycle,
      end: "2026-06-30",
      length: 3,
    };
    const result = computeRetainerSummary({
      ...defaultArgs,
      cycle: threeMonthCycle,
      rolloverEnabled: true,
      monthBillableMinutes: new Map([["2026-04", 1200]]),
      entries: [entry({ durationMinutes: 1200, isBillable: true })],
    });
    expect(result.overage?.overBudgetMinutes).toBe(0);
  });
});

// ─── Date range helpers ─────────────────────────────────────────────────────

describe("resolveDateRange", () => {
  it("this_month — starts at the 1st of current month", () => {
    const r = resolveDateRange("this_month", "2026-04-15");
    expect(r).toEqual({ preset: "this_month", from: "2026-04-01", to: "2026-04-15" });
  });

  it("this_quarter — Q2 boundary", () => {
    const r = resolveDateRange("this_quarter", "2026-05-10");
    expect(r).toEqual({ preset: "this_quarter", from: "2026-04-01", to: "2026-05-10" });
  });

  it("this_quarter — Q1 boundary", () => {
    const r = resolveDateRange("this_quarter", "2026-02-05");
    expect(r).toEqual({ preset: "this_quarter", from: "2026-01-01", to: "2026-02-05" });
  });

  it("this_quarter — Q4 boundary", () => {
    const r = resolveDateRange("this_quarter", "2026-12-15");
    expect(r).toEqual({ preset: "this_quarter", from: "2026-10-01", to: "2026-12-15" });
  });

  it("this_year — starts Jan 1", () => {
    const r = resolveDateRange("this_year", "2026-08-20");
    expect(r).toEqual({ preset: "this_year", from: "2026-01-01", to: "2026-08-20" });
  });

  it("all — wide bounds", () => {
    const r = resolveDateRange("all", "2026-04-15");
    expect(r.from <= "0001-01-01").toBe(true);
    expect(r.to >= "2099-01-01").toBe(true);
  });

  it("custom — uses provided bounds", () => {
    const r = resolveDateRange("custom", "2026-04-15", {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(r).toEqual({ preset: "custom", from: "2026-03-01", to: "2026-03-31" });
  });

  it("custom — missing bounds fall back sensibly", () => {
    const r = resolveDateRange("custom", "2026-04-15");
    expect(r.from).toBeTruthy();
    expect(r.to).toBe("2026-04-15");
  });
});

describe("filterEntriesByDate", () => {
  it("inclusive boundaries", () => {
    const entries: EntryInput[] = [
      entry({ date: "2026-03-31" }),
      entry({ date: "2026-04-01" }),
      entry({ date: "2026-04-30" }),
      entry({ date: "2026-05-01" }),
    ];
    const filtered = filterEntriesByDate(entries, {
      preset: "this_month",
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(filtered).toHaveLength(2);
    expect(filtered.map((e) => e.date)).toEqual(["2026-04-01", "2026-04-30"]);
  });
});

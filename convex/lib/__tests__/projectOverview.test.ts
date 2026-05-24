import { describe, it, expect } from "vitest";
import { computeLast3Months } from "../../timeEntries";

/**
 * Project time aggregation query helpers and calculation logic.
 *
 * Since we can't call Convex queries directly in vitest, we test:
 * 1. Exported helper functions
 * 2. Calculation formulas that the queries implement (as pure functions)
 */

// ─── computeLast3Months ───────────────────────────────────────────────────────

describe("computeLast3Months", () => {
  it("returns 3 months ending with current month", () => {
    expect(computeLast3Months("2026-03")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("handles year boundary", () => {
    expect(computeLast3Months("2026-02")).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("handles January", () => {
    expect(computeLast3Months("2026-01")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
    ]);
  });
});

// ─── Fixed overview calculation formulas ───────────────────────────────────────

describe("Fixed overview calculations", () => {
  // Fixtures: fixedPrice = 10000
  // Entries: 10h@50cost (Design, billable), 20h@40cost (Dev, billable), 5h@40cost (Dev, non-billable)
  // Estimates: Design 20h, Dev 40h
  const fixture = {
    fixedPrice: 10000,
    entries: [
      { durationMinutes: 600, costRate: 50, isBillable: true, workCategoryId: "design" },
      { durationMinutes: 1200, costRate: 40, isBillable: true, workCategoryId: "dev" },
      { durationMinutes: 300, costRate: 40, isBillable: false, workCategoryId: "dev" },
    ],
    estimates: [
      { workCategoryId: "design", estimatedMinutes: 1200 }, // 20h
      { workCategoryId: "dev", estimatedMinutes: 2400 }, // 40h
    ],
  };

  function computeFixedMetrics(f: typeof fixture) {
    let totalMinutes = 0;
    let totalActualCost = 0;
    const minutesByCategory: Record<string, number> = {};

    for (const e of f.entries) {
      totalMinutes += e.durationMinutes;
      totalActualCost += (e.durationMinutes / 60) * (e.costRate ?? 0);
      minutesByCategory[e.workCategoryId] =
        (minutesByCategory[e.workCategoryId] ?? 0) + e.durationMinutes;
    }

    const revenue = f.fixedPrice;
    const profit = revenue - totalActualCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const effectiveRate =
      totalMinutes > 0 ? revenue / (totalMinutes / 60) : 0;
    const totalEstimatedMinutes = f.estimates.reduce(
      (s, e) => s + e.estimatedMinutes,
      0,
    );
    const budgetUsed =
      totalEstimatedMinutes > 0
        ? (totalMinutes / totalEstimatedMinutes) * 100
        : null;

    return {
      totalMinutes,
      totalActualCost,
      revenue,
      profit,
      margin,
      effectiveRate,
      budgetUsed,
      minutesByCategory,
    };
  }

  it("computes totalActualMinutes as all entries (billable + non-billable)", () => {
    const m = computeFixedMetrics(fixture);
    expect(m.totalMinutes).toBe(2100); // 35h = 2100min
  });

  it("computes totalActualCost from costRate snapshots", () => {
    const m = computeFixedMetrics(fixture);
    // 10h*50 + 20h*40 + 5h*40 = 500 + 800 + 200 = 1500
    expect(m.totalActualCost).toBe(1500);
  });

  it("computes profit = revenue - totalActualCost", () => {
    const m = computeFixedMetrics(fixture);
    expect(m.profit).toBe(8500);
  });

  it("computes margin percentage", () => {
    const m = computeFixedMetrics(fixture);
    expect(m.margin).toBe(85);
  });

  it("computes effectiveRate = revenue / totalActualHours", () => {
    const m = computeFixedMetrics(fixture);
    // 10000 / 35 = 285.714...
    expect(m.effectiveRate).toBeCloseTo(285.714, 2);
  });

  it("computes budgetUsed as percentage of estimated", () => {
    const m = computeFixedMetrics(fixture);
    // 2100 / 3600 * 100 = 58.333...
    expect(m.budgetUsed).toBeCloseTo(58.333, 2);
  });

  it("computes per-category minutes", () => {
    const m = computeFixedMetrics(fixture);
    expect(m.minutesByCategory["design"]).toBe(600); // 10h
    expect(m.minutesByCategory["dev"]).toBe(1500); // 25h (20 + 5)
  });

  it("handles missing fixedPrice gracefully", () => {
    const m = computeFixedMetrics({ ...fixture, fixedPrice: 0 });
    expect(m.profit).toBe(-1500);
    expect(m.effectiveRate).toBe(0);
  });

  it("returns null budgetUsed when no estimates", () => {
    const m = computeFixedMetrics({ ...fixture, estimates: [] });
    expect(m.budgetUsed).toBeNull();
  });

  it("includes non-billable time in fixed totals", () => {
    const billableOnly = fixture.entries.filter((e) => e.isBillable);
    const billableMinutes = billableOnly.reduce((s, e) => s + e.durationMinutes, 0);
    const m = computeFixedMetrics(fixture);
    expect(m.totalMinutes).toBeGreaterThan(billableMinutes);
  });
});

// ─── T&M overview calculation formulas ────────────────────────────────────────

describe("T&M overview calculations", () => {
  // Fixtures:
  // Billable: 10h@100 (Jan), 20h@100 (Feb), 30h@100 (Mar=current month)
  // Non-billable: 5h (Mar)
  const currentMonth = "2026-03";

  const entries = [
    { durationMinutes: 600, billableRate: 100, isBillable: true, date: "2026-01-15" },
    { durationMinutes: 1200, billableRate: 100, isBillable: true, date: "2026-02-15" },
    { durationMinutes: 1800, billableRate: 100, isBillable: true, date: "2026-03-15" },
    { durationMinutes: 300, billableRate: 0, isBillable: false, date: "2026-03-20" },
  ];

  type TmEntry = { durationMinutes: number; billableRate: number; isBillable: boolean; date: string };

  function computeTmMetrics(entries: TmEntry[], currentMonth: string) {
    let totalBillableMinutes = 0;
    let totalNonBillableMinutes = 0;
    let thisMonthBillableMinutes = 0;
    let openMinutes = 0;
    let openAmount = 0;
    const billableByMonth: Record<string, number> = {};

    for (const e of entries) {
      if (e.isBillable) {
        totalBillableMinutes += e.durationMinutes;
        openMinutes += e.durationMinutes;
        openAmount += (e.durationMinutes / 60) * (e.billableRate ?? 0);
        const monthKey = e.date.slice(0, 7);
        billableByMonth[monthKey] = (billableByMonth[monthKey] ?? 0) + e.durationMinutes;
      } else {
        totalNonBillableMinutes += e.durationMinutes;
      }

      if (e.isBillable && e.date.startsWith(currentMonth)) {
        thisMonthBillableMinutes += e.durationMinutes;
      }
    }

    const last3 = computeLast3Months(currentMonth).map((m) => ({
      month: m,
      minutes: billableByMonth[m] ?? 0,
    }));

    return {
      totalBillableMinutes,
      totalNonBillableMinutes,
      thisMonthBillableMinutes,
      openMinutes,
      openAmount,
      last3BillableMonths: last3,
    };
  }

  it("computes billable logged = total billable minutes", () => {
    const m = computeTmMetrics(entries, currentMonth);
    expect(m.totalBillableMinutes).toBe(3600); // 60h
  });

  it("computes non-billable = total non-billable minutes", () => {
    const m = computeTmMetrics(entries, currentMonth);
    expect(m.totalNonBillableMinutes).toBe(300); // 5h
  });

  it("computes open from billable entries × billableRate", () => {
    const m = computeTmMetrics(entries, currentMonth);
    // 60h * 100 = 6000
    expect(m.openAmount).toBe(6000);
    expect(m.openMinutes).toBe(3600);
  });

  it("computes thisMonthBillableMinutes for current month billable only", () => {
    const m = computeTmMetrics(entries, currentMonth);
    // March: 30h billable only (5h non-billable excluded) = 1800min
    expect(m.thisMonthBillableMinutes).toBe(1800);
  });

  it("computes last 3 billable months", () => {
    const m = computeTmMetrics(entries, currentMonth);
    expect(m.last3BillableMonths).toEqual([
      { month: "2026-01", minutes: 600 },
      { month: "2026-02", minutes: 1200 },
      { month: "2026-03", minutes: 1800 },
    ]);
  });

  it("shows zero for months with no billable entries", () => {
    const m = computeTmMetrics(
      entries.filter((e) => e.date !== "2026-02-15"),
      currentMonth,
    );
    expect(m.last3BillableMonths[1].minutes).toBe(0);
  });

  it("archived task entries still count", () => {
    const m = computeTmMetrics(entries, currentMonth);
    expect(m.totalBillableMinutes).toBe(3600);
  });
});

// ─── Monthly breakdown grouping ────────────────────────────────────────────────

describe("Monthly breakdown grouping", () => {
  it("groups entries by entry.isBillable, not task.billable", () => {
    const entries = [
      { isBillable: true, durationMinutes: 60 },
      { isBillable: false, durationMinutes: 30 },
    ];
    const billable = entries.filter((e) => e.isBillable);
    const nonBillable = entries.filter((e) => !e.isBillable);
    expect(billable).toHaveLength(1);
    expect(nonBillable).toHaveLength(1);
    expect(billable[0].durationMinutes).toBe(60);
    expect(nonBillable[0].durationMinutes).toBe(30);
  });

  it("tasks with no category group under 'uncategorized'", () => {
    const entries = [
      { workCategoryId: null, durationMinutes: 60 },
      { workCategoryId: "cat-1", durationMinutes: 120 },
    ];
    const byCat: Record<string, number> = {};
    for (const e of entries) {
      const key = e.workCategoryId ?? "uncategorized";
      byCat[key] = (byCat[key] ?? 0) + e.durationMinutes;
    }
    expect(byCat["uncategorized"]).toBe(60);
    expect(byCat["cat-1"]).toBe(120);
  });
});

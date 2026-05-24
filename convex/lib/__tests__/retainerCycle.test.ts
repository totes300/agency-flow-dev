import { describe, it, expect } from "vitest";
import {
  getCyclePeriods,
  __test_applyOverageRule as applyOverageRule,
} from "../retainerCycle";

/**
 * Phase 8 Slice 2 — tests for the shared retainer-cycle helpers.
 *
 * The async overage wrappers (`computePeriodOverageContext` /
 * `computeCycleOverageContext`) are exercised end-to-end by the period-close
 * mutation tests in Slice 3; here we cover the two pure layers that
 * everything else builds on: cycle boundary construction and the
 * rollover-vs-non-rollover overage rule.
 */

// ─── getCyclePeriods ────────────────────────────────────────────────────────

describe("getCyclePeriods — monthly (cycleLength=1)", () => {
  it("returns a single-month cycle for the project's start month", () => {
    const cycle = getCyclePeriods({
      startDate: "2026-01-15",
      cycleLength: 1,
      todayStr: "2026-01-20",
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.periods).toHaveLength(1);
    expect(cycle!.periods[0]).toMatchObject({
      year: 2026,
      month: 1,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(cycle!.cycleIndex).toBe(0);
    expect(cycle!.currentCycleIndex).toBe(0);
    expect(cycle!.isCycleClosed).toBe(false); // today inside cycle
    expect(cycle!.isCurrentCycle).toBe(true);
  });

  it("marks a past cycle as closed", () => {
    const cycle = getCyclePeriods({
      startDate: "2026-01-01",
      cycleLength: 1,
      todayStr: "2026-03-15",
      cycleOffset: -2, // January cycle, today is March
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.cycleStart).toBe("2026-01-01");
    expect(cycle!.cycleEnd).toBe("2026-01-31");
    expect(cycle!.isCycleClosed).toBe(true);
    expect(cycle!.isCurrentCycle).toBe(false);
  });
});

describe("getCyclePeriods — rollover (cycleLength > 1)", () => {
  it("returns N consecutive monthly periods aligned to the project start", () => {
    const cycle = getCyclePeriods({
      startDate: "2026-01-01",
      cycleLength: 3,
      todayStr: "2026-02-10",
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.periods.map((p) => p.periodStart)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
    expect(cycle!.cycleEnd).toBe("2026-03-31");
    expect(cycle!.isCycleClosed).toBe(false);
    expect(cycle!.isCurrentCycle).toBe(true);
  });

  it("handles year wrap-around inside a cycle", () => {
    // Project starts 2025-11-01; cycle length 3 ⇒ Nov, Dec, Jan(2026).
    const cycle = getCyclePeriods({
      startDate: "2025-11-01",
      cycleLength: 3,
      todayStr: "2026-01-15",
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.periods.map((p) => `${p.year}-${p.month}`)).toEqual([
      "2025-11",
      "2025-12",
      "2026-1",
    ]);
    expect(cycle!.cycleEnd).toBe("2026-01-31");
  });

  it("walks to the previous cycle via cycleOffset=-1", () => {
    const cycle = getCyclePeriods({
      startDate: "2026-01-01",
      cycleLength: 3,
      todayStr: "2026-05-10",
      cycleOffset: -1,
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.cycleIndex).toBe(0);
    expect(cycle!.currentCycleIndex).toBe(1);
    expect(cycle!.cycleStart).toBe("2026-01-01");
    expect(cycle!.cycleEnd).toBe("2026-03-31");
    expect(cycle!.isCycleClosed).toBe(true);
    expect(cycle!.isCurrentCycle).toBe(false);
  });

  it("walks to the next cycle via cycleOffset=+1", () => {
    const cycle = getCyclePeriods({
      startDate: "2026-01-01",
      cycleLength: 3,
      todayStr: "2026-02-15",
      cycleOffset: 1,
    });
    expect(cycle).not.toBeNull();
    expect(cycle!.cycleStart).toBe("2026-04-01");
    expect(cycle!.cycleEnd).toBe("2026-06-30");
    expect(cycle!.isCycleClosed).toBe(false);
  });

  it("returns null when asking for a cycle before the project started", () => {
    expect(
      getCyclePeriods({
        startDate: "2026-01-01",
        cycleLength: 3,
        todayStr: "2026-02-15",
        cycleOffset: -1,
      }),
    ).toBeNull();
  });
});

// ─── applyOverageRule ───────────────────────────────────────────────────────

describe("applyOverageRule — monthly-isolated (non-rollover)", () => {
  it("within budget → not due, zero overage", () => {
    const r = applyOverageRule({
      mode: "monthly-isolated",
      workedMinutes: 10 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 100,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.overageMinutes).toBe(0);
    expect(r.overageAmount).toBe(0);
    expect(r.endBalance).toBe(10 * 60);
  });

  it("over budget → due, amount = overageHours × rate", () => {
    const r = applyOverageRule({
      mode: "monthly-isolated",
      workedMinutes: 25 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 100,
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageMinutes).toBe(5 * 60);
    expect(r.overageAmount).toBe(500);
    expect(r.endBalance).toBe(-5 * 60);
  });

  it("exact-budget → not due, zero amount", () => {
    const r = applyOverageRule({
      mode: "monthly-isolated",
      workedMinutes: 20 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 100,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.endBalance).toBe(0);
  });
});

describe("applyOverageRule — rollover-monthly", () => {
  // The whole point: a rollover monthly is NEVER due at the monthly level —
  // overage settles at cycle end via the cycle helper.
  it("over budget mid-cycle → still NOT due", () => {
    const r = applyOverageRule({
      mode: "rollover-monthly",
      workedMinutes: 25 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 100,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.overageMinutes).toBe(0);
    expect(r.overageAmount).toBe(0);
    // endBalance is still tracked for display
    expect(r.endBalance).toBe(-5 * 60);
  });

  it("within budget → not due (same as any other state)", () => {
    const r = applyOverageRule({
      mode: "rollover-monthly",
      workedMinutes: 5 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 100,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.endBalance).toBe(15 * 60);
  });
});

describe("applyOverageRule — rollover-cycle", () => {
  it("cycle over budget → due, amount on cycle aggregate", () => {
    // 3-month cycle: 20h × 3 = 60h budget, 75h used → 15h overage.
    const r = applyOverageRule({
      mode: "rollover-cycle",
      workedMinutes: 75 * 60,
      budgetMinutes: 20 * 60 * 3,
      overageRate: 80,
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageMinutes).toBe(15 * 60);
    expect(r.overageAmount).toBe(1200);
  });

  it("cycle within budget → not due", () => {
    const r = applyOverageRule({
      mode: "rollover-cycle",
      workedMinutes: 50 * 60,
      budgetMinutes: 60 * 60,
      overageRate: 80,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.overageMinutes).toBe(0);
  });
});

// ─── Cross-mode invariants ──────────────────────────────────────────────────

describe("applyOverageRule — invariants", () => {
  it("endBalance always = budgetMinutes - workedMinutes regardless of mode", () => {
    const cases = [
      { mode: "monthly-isolated" as const, w: 100, b: 60 },
      { mode: "rollover-monthly" as const, w: 100, b: 60 },
      { mode: "rollover-cycle" as const, w: 100, b: 60 },
    ];
    for (const c of cases) {
      const r = applyOverageRule({
        mode: c.mode,
        workedMinutes: c.w,
        budgetMinutes: c.b,
        overageRate: 100,
      });
      expect(r.endBalance).toBe(c.b - c.w);
    }
  });

  it("isOverageDue=false implies overageMinutes=0 and overageAmount=0", () => {
    const cases = [
      { mode: "monthly-isolated" as const, w: 10, b: 60 },
      { mode: "rollover-monthly" as const, w: 100, b: 60 }, // would be over, but rule blocks
      { mode: "rollover-cycle" as const, w: 10, b: 60 },
    ];
    for (const c of cases) {
      const r = applyOverageRule({
        mode: c.mode,
        workedMinutes: c.w,
        budgetMinutes: c.b,
        overageRate: 100,
      });
      if (!r.isOverageDue) {
        expect(r.overageMinutes).toBe(0);
        expect(r.overageAmount).toBe(0);
      }
    }
  });

  it("overageRate=0 still flips isOverageDue when balance is negative — amount is 0", () => {
    const r = applyOverageRule({
      mode: "monthly-isolated",
      workedMinutes: 30 * 60,
      budgetMinutes: 20 * 60,
      overageRate: 0,
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageMinutes).toBe(10 * 60);
    expect(r.overageAmount).toBe(0);
  });
});

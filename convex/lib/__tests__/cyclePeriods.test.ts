import { describe, it, expect } from "vitest";
import { getCyclePeriods } from "../billing/periods";

/** The project pages' cycle navigator (ported from the deleted lib/retainerCycle). */

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


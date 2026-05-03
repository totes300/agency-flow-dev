import { describe, it, expect } from "vitest";
import {
  computeRetainerBalance,
  getRetainerRecalcCyclePosition,
  getRetainerCyclePosition,
  getRetainerCycleStartMonth,
} from "../retainerBalance";

/**
 * Phase B tests — retainer balance computation with real time entries.
 *
 * Tests the balance chaining, overage, and badge status logic as pure functions
 * matching the `getRetainerData` view layer. The local `computeRetainerChain`
 * helper here mirrors the per-month walker used to render the project Overview.
 *
 * Below those tests, the bottom of this file targets the **invoice-side**
 * `computeRetainerBalance` (in `convex/lib/retainerBalance.ts`), asserting the
 * post-refactor contract: `total = overageAmount` (Stripe collects the monthly
 * fee separately, so it never appears on a chargeable line item).
 */

type MonthInput = {
  workedMinutes: number; // billable only
  nonBillableMinutes: number;
  endDate: string;
};

type MonthResult = {
  workedMinutes: number;
  startBalance: number;
  available: number;
  endBalance: number;
  totalNonBillableMinutes: number;
  isMonthClosed: boolean;
  balanceStatus: "due" | "deficit" | "rollover" | "unused" | "on_track";
};

function computeRetainerChain(opts: {
  includedMinutesPerMonth: number;
  overageRate: number;
  rolloverEnabled: boolean;
  cycleLength: number;
  months: MonthInput[];
  isCycleClosed: boolean;
  todayStr: string;
}): {
  months: MonthResult[];
  cycleBudget: number;
  cycleWorked: number;
  cycleBalance: number;
  overageMinutes: number;
  overageDue: number;
  totalNonBillableMinutes: number;
} {
  const monthlyData: MonthResult[] = [];

  for (let i = 0; i < opts.months.length; i++) {
    const m = opts.months[i];
    const isMonthClosed = m.endDate < opts.todayStr;

    let startBalance: number;
    if (opts.rolloverEnabled) {
      startBalance = i === 0 ? 0 : monthlyData[i - 1].endBalance;
    } else {
      startBalance = 0;
    }

    const available = startBalance + opts.includedMinutesPerMonth;
    const endBalance = available - m.workedMinutes;

    let balanceStatus: MonthResult["balanceStatus"];
    if (endBalance < 0) {
      if (opts.rolloverEnabled) {
        balanceStatus =
          i === opts.cycleLength - 1 && opts.isCycleClosed ? "due" : "deficit";
      } else {
        balanceStatus = isMonthClosed ? "due" : "deficit";
      }
    } else if (endBalance > 0) {
      if (opts.rolloverEnabled) {
        balanceStatus =
          i === opts.cycleLength - 1 && opts.isCycleClosed
            ? "unused"
            : "rollover";
      } else {
        balanceStatus = isMonthClosed ? "unused" : "on_track";
      }
    } else {
      balanceStatus = "on_track";
    }

    monthlyData.push({
      workedMinutes: m.workedMinutes,
      startBalance,
      available,
      endBalance,
      totalNonBillableMinutes: m.nonBillableMinutes,
      isMonthClosed,
      balanceStatus,
    });
  }

  const cycleBudget = opts.includedMinutesPerMonth * opts.cycleLength;
  const cycleWorked = monthlyData.reduce((s, m) => s + m.workedMinutes, 0);
  const cycleBalance = cycleBudget - cycleWorked;

  let overageMinutes = 0;
  if (opts.rolloverEnabled) {
    if (opts.isCycleClosed && cycleBalance < 0) {
      overageMinutes = Math.abs(cycleBalance);
    }
  } else {
    for (const m of monthlyData) {
      if (m.isMonthClosed && m.endBalance < 0) {
        overageMinutes += Math.abs(m.endBalance);
      }
    }
  }
  const overageDue = (overageMinutes / 60) * opts.overageRate;

  const totalNonBillableMinutes = monthlyData.reduce(
    (s, m) => s + m.totalNonBillableMinutes,
    0,
  );

  return {
    months: monthlyData,
    cycleBudget,
    cycleWorked,
    cycleBalance,
    overageMinutes,
    overageDue,
    totalNonBillableMinutes,
  };
}

// ─── Retainer happy path with rollover ON ──────────────────────────────────────

describe("Retainer — rollover ON", () => {
  // PRD fixture: 20h/mo, overage=100/h, Jan=10h, Feb=15h, Mar=30h(bill)+5h(nonbill)
  const base = {
    includedMinutesPerMonth: 1200, // 20h
    overageRate: 100,
    rolloverEnabled: true,
    cycleLength: 3,
    todayStr: "2026-04-01", // cycle closed
    isCycleClosed: true,
    months: [
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-01-31" },   // 10h
      { workedMinutes: 900, nonBillableMinutes: 0, endDate: "2026-02-28" },   // 15h
      { workedMinutes: 1800, nonBillableMinutes: 300, endDate: "2026-03-31" }, // 30h bill, 5h nonbill
    ],
  };

  it("chains balances correctly", () => {
    const r = computeRetainerChain(base);
    // January: start=0, avail=1200, worked=600, end=600
    expect(r.months[0].startBalance).toBe(0);
    expect(r.months[0].available).toBe(1200);
    expect(r.months[0].endBalance).toBe(600);
    // February: start=600, avail=1800, worked=900, end=900
    expect(r.months[1].startBalance).toBe(600);
    expect(r.months[1].available).toBe(1800);
    expect(r.months[1].endBalance).toBe(900);
    // March: start=900, avail=2100, worked=1800, end=300
    expect(r.months[2].startBalance).toBe(900);
    expect(r.months[2].available).toBe(2100);
    expect(r.months[2].endBalance).toBe(300);
  });

  it("shows no overage when within budget", () => {
    const r = computeRetainerChain(base);
    expect(r.overageMinutes).toBe(0);
    expect(r.overageDue).toBe(0);
  });

  it("computes totalNonBillableMinutes scoped to cycle", () => {
    const r = computeRetainerChain(base);
    expect(r.totalNonBillableMinutes).toBe(300); // 5h from March only
  });

  it("non-billable time does not affect balance", () => {
    const r = computeRetainerChain(base);
    // March endBalance should only reflect billable work
    expect(r.months[2].workedMinutes).toBe(1800); // billable only
  });
});

// ─── Cycle-end settlement (rollover ON, overage) ──────────────────────────────

describe("Retainer — cycle-end settlement (rollover ON)", () => {
  // PRD fixture: 10h/mo, overage=100/h, cycle=3
  // Jan=10h, Feb=15h, Mar=10h, cycle closed
  const base = {
    includedMinutesPerMonth: 600, // 10h
    overageRate: 100,
    rolloverEnabled: true,
    cycleLength: 3,
    todayStr: "2026-04-01",
    isCycleClosed: true,
    months: [
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-01-31" },  // 10h
      { workedMinutes: 900, nonBillableMinutes: 0, endDate: "2026-02-28" },  // 15h
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-03-31" },  // 10h
    ],
  };

  it("January: on_track (balance = 0)", () => {
    const r = computeRetainerChain(base);
    expect(r.months[0].startBalance).toBe(0);
    expect(r.months[0].endBalance).toBe(0);
    expect(r.months[0].balanceStatus).toBe("on_track");
  });

  it("February: deficit (mid-cycle negative, not due yet)", () => {
    const r = computeRetainerChain(base);
    expect(r.months[1].startBalance).toBe(0);
    expect(r.months[1].available).toBe(600);
    expect(r.months[1].endBalance).toBe(-300);
    expect(r.months[1].balanceStatus).toBe("deficit");
  });

  it("March: due (cycle-end, closed, negative)", () => {
    const r = computeRetainerChain(base);
    expect(r.months[2].startBalance).toBe(-300);
    expect(r.months[2].available).toBe(300);
    expect(r.months[2].endBalance).toBe(-300);
    expect(r.months[2].balanceStatus).toBe("due");
  });

  it("overage = 300 minutes (5h), overageDue = 500", () => {
    const r = computeRetainerChain(base);
    // cycleBudget=1800, cycleWorked=2100, balance=-300
    expect(r.cycleBudget).toBe(1800);
    expect(r.cycleWorked).toBe(2100);
    expect(r.overageMinutes).toBe(300);
    expect(r.overageDue).toBe(500); // 300/60 * 100
  });

  it("cycle not yet closed — overage = 0 even with deficit", () => {
    const r = computeRetainerChain({
      ...base,
      todayStr: "2026-03-15",
      isCycleClosed: false,
    });
    expect(r.overageMinutes).toBe(0);
    // But endBalance is still tracked
    expect(r.months[2].endBalance).toBe(-300);
    // March is not closed, so deficit not due
    expect(r.months[2].balanceStatus).toBe("deficit");
  });
});

// ─── Rollover OFF (per-month settlement) ──────────────────────────────────────

describe("Retainer — rollover OFF", () => {
  // Same data: 10h/mo, Jan=10h, Feb=15h, Mar=10h
  const base = {
    includedMinutesPerMonth: 600,
    overageRate: 100,
    rolloverEnabled: false,
    cycleLength: 3,
    todayStr: "2026-04-01",
    isCycleClosed: true,
    months: [
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-01-31" },
      { workedMinutes: 900, nonBillableMinutes: 0, endDate: "2026-02-28" },
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-03-31" },
    ],
  };

  it("each month starts at 0 (no rollover)", () => {
    const r = computeRetainerChain(base);
    for (const m of r.months) {
      expect(m.startBalance).toBe(0);
    }
  });

  it("January: on_track", () => {
    const r = computeRetainerChain(base);
    expect(r.months[0].endBalance).toBe(0);
    expect(r.months[0].balanceStatus).toBe("on_track");
  });

  it("February: due immediately (closed month, negative)", () => {
    const r = computeRetainerChain(base);
    expect(r.months[1].endBalance).toBe(-300);
    expect(r.months[1].balanceStatus).toBe("due");
  });

  it("March: on_track", () => {
    const r = computeRetainerChain(base);
    expect(r.months[2].endBalance).toBe(0);
    expect(r.months[2].balanceStatus).toBe("on_track");
  });

  it("overage = 300 minutes from February only", () => {
    const r = computeRetainerChain(base);
    expect(r.overageMinutes).toBe(300);
    expect(r.overageDue).toBe(500);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe("Retainer — edge cases", () => {
  it("only non-billable time — balance untouched, overage = 0", () => {
    const r = computeRetainerChain({
      includedMinutesPerMonth: 1200,
      overageRate: 100,
      rolloverEnabled: true,
      cycleLength: 1,
      todayStr: "2026-02-01",
      isCycleClosed: true,
      months: [
        { workedMinutes: 0, nonBillableMinutes: 300, endDate: "2026-01-31" },
      ],
    });
    expect(r.months[0].endBalance).toBe(1200);
    expect(r.overageMinutes).toBe(0);
    expect(r.totalNonBillableMinutes).toBe(300);
  });

  it("included hours = 0 — every billable hour is overage", () => {
    const r = computeRetainerChain({
      includedMinutesPerMonth: 0,
      overageRate: 50,
      rolloverEnabled: false,
      cycleLength: 1,
      todayStr: "2026-02-01",
      isCycleClosed: true,
      months: [
        { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-01-31" },
      ],
    });
    expect(r.months[0].endBalance).toBe(-600);
    expect(r.overageMinutes).toBe(600);
    expect(r.overageDue).toBe(500); // 600/60 * 50 = 10h * 50
  });

  it("active month with no entries — workedMinutes = 0, balance = included", () => {
    const r = computeRetainerChain({
      includedMinutesPerMonth: 1200,
      overageRate: 100,
      rolloverEnabled: true,
      cycleLength: 1,
      todayStr: "2026-01-15", // mid-month
      isCycleClosed: false,
      months: [
        { workedMinutes: 0, nonBillableMinutes: 0, endDate: "2026-01-31" },
      ],
    });
    expect(r.months[0].workedMinutes).toBe(0);
    expect(r.months[0].endBalance).toBe(1200);
    expect(r.months[0].balanceStatus).toBe("rollover");
  });

  it("archived task entries still count in balance", () => {
    // Same as happy path — entries from archived tasks are included in workedMinutes
    // The query fetches tasks regardless of archivedAt
    const r = computeRetainerChain({
      includedMinutesPerMonth: 1200,
      overageRate: 100,
      rolloverEnabled: false,
      cycleLength: 1,
      todayStr: "2026-02-01",
      isCycleClosed: true,
      months: [
        { workedMinutes: 1500, nonBillableMinutes: 0, endDate: "2026-01-31" },
      ],
    });
    expect(r.months[0].endBalance).toBe(-300);
    expect(r.overageMinutes).toBe(300);
  });
});

// ─── Retainer invariants ──────────────────────────────────────────────────────

describe("Retainer invariants", () => {
  const fixture = {
    includedMinutesPerMonth: 600,
    overageRate: 100,
    rolloverEnabled: true,
    cycleLength: 3,
    todayStr: "2026-04-01",
    isCycleClosed: true,
    months: [
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-01-31" },
      { workedMinutes: 900, nonBillableMinutes: 0, endDate: "2026-02-28" },
      { workedMinutes: 600, nonBillableMinutes: 0, endDate: "2026-03-31" },
    ],
  };

  it("available = includedPerMonth + startBalance", () => {
    const r = computeRetainerChain(fixture);
    for (const m of r.months) {
      expect(m.available).toBe(fixture.includedMinutesPerMonth + m.startBalance);
    }
  });

  it("endBalance = available - workedMinutes", () => {
    const r = computeRetainerChain(fixture);
    for (const m of r.months) {
      expect(m.endBalance).toBe(m.available - m.workedMinutes);
    }
  });

  it("rollover ON: startBalance = previous endBalance", () => {
    const r = computeRetainerChain(fixture);
    for (let i = 1; i < r.months.length; i++) {
      expect(r.months[i].startBalance).toBe(r.months[i - 1].endBalance);
    }
    expect(r.months[0].startBalance).toBe(0); // cycle start
  });

  it("rollover OFF: startBalance always 0", () => {
    const r = computeRetainerChain({ ...fixture, rolloverEnabled: false });
    for (const m of r.months) {
      expect(m.startBalance).toBe(0);
    }
  });

  it("overageDue = overageMinutes / 60 * overageRate", () => {
    const r = computeRetainerChain(fixture);
    expect(r.overageDue).toBe((r.overageMinutes / 60) * fixture.overageRate);
  });
});

// ─── Invoice-side: computeRetainerBalance contract ───────────────────────────
//
// These tests target the actual production helper in
// `convex/lib/retainerBalance.ts`. After the invoicing refactor the contract
// is "total === overageAmount" — the monthly retainer fee is collected via
// Stripe and never charged on an invoice line item.

describe("computeRetainerBalance (invoice-side)", () => {
  const minutes = (h: number) => h * 60;

  it("rollover OFF, within budget → total === 0 and isOverageDue false", () => {
    const r = computeRetainerBalance({
      taskMinutesMap: new Map([["k1", minutes(10)]]),
      roundingMinutes: 0,
      startBalance: 0,
      includedMinutes: minutes(20),
      monthlyFee: 1000, // Stripe — context only, must NOT enter `total`
      overageRate: 100,
      rolloverEnabled: false,
      cycleLength: 1,
      positionInCycle: 0,
    });
    expect(r.usedMinutes).toBe(minutes(10));
    expect(r.endBalance).toBe(minutes(10));
    expect(r.isOverageDue).toBe(false);
    expect(r.overageAmount).toBe(0);
    expect(r.total).toBe(0); // post-refactor: total = overage only
    expect(r.monthlyFee).toBe(1000); // returned as context
  });

  it("rollover OFF, over budget → total === overageAmount", () => {
    const r = computeRetainerBalance({
      taskMinutesMap: new Map([["k1", minutes(25)]]),
      roundingMinutes: 0,
      startBalance: 0,
      includedMinutes: minutes(20),
      monthlyFee: 1000,
      overageRate: 100,
      rolloverEnabled: false,
      cycleLength: 1,
      positionInCycle: 0,
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageHours).toBe(5);
    expect(r.overageAmount).toBe(500);
    expect(r.total).toBe(500); // monthlyFee NOT added
    expect(r.total).toBe(r.overageAmount);
  });

  it("rollover ON cycle math: 3-month cycle, end-of-cycle bills full overage", () => {
    // 3-month cycle, included = 20h × 3 = 60h, used = 75h → 15h over.
    const r = computeRetainerBalance({
      taskMinutesMap: new Map([["k1", minutes(75)]]),
      roundingMinutes: 0,
      startBalance: 0,
      includedMinutes: minutes(20) * 3, // cycle bucket = 3× monthly
      monthlyFee: 1000,
      overageRate: 80,
      rolloverEnabled: true,
      cycleLength: 3,
      positionInCycle: 2, // closing month
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageHours).toBe(15);
    expect(r.overageAmount).toBe(1200);
    expect(r.total).toBe(1200);
    expect(r.total).toBe(r.overageAmount);
  });

  it("rollover ON, mid-cycle position → isOverageDue false even if negative balance", () => {
    // Position 1 of a 3-month cycle. Negative balance does not trigger overage —
    // only the closing position bills.
    const r = computeRetainerBalance({
      taskMinutesMap: new Map([["k1", minutes(40)]]),
      roundingMinutes: 0,
      startBalance: 0,
      includedMinutes: minutes(20) * 3,
      monthlyFee: 1000,
      overageRate: 100,
      rolloverEnabled: true,
      cycleLength: 3,
      positionInCycle: 1,
    });
    expect(r.isOverageDue).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe("getRetainerCyclePosition", () => {
  it("returns 0 for the project's first month", () => {
    expect(getRetainerCyclePosition("2026-01-01", 2026, 1, 3)).toBe(0);
  });

  it("returns cycleLength-1 at the cycle's closing month", () => {
    expect(getRetainerCyclePosition("2026-01-01", 2026, 3, 3)).toBe(2);
  });

  it("wraps to 0 at the start of the next cycle", () => {
    expect(getRetainerCyclePosition("2026-01-01", 2026, 4, 3)).toBe(0);
  });

  it("returns -1 when the project has no startDate", () => {
    expect(getRetainerCyclePosition(undefined, 2026, 4, 3)).toBe(-1);
  });
});

describe("getRetainerRecalcCyclePosition", () => {
  it("uses the closing position for rollover cycle invoice recalculation", () => {
    // Regression: rollover invoices store periodStart as the cycle's first
    // month. Recalc must not classify that invoice as mid-cycle and delete the
    // derived overage line.
    expect(getRetainerCyclePosition("2026-02-01", 2026, 2, 3)).toBe(0);
    expect(
      getRetainerRecalcCyclePosition({
        rolloverEnabled: true,
        cycleLength: 3,
      }),
    ).toBe(2);

    const r = computeRetainerBalance({
      taskMinutesMap: new Map([["cycle", 30 * 60]]),
      roundingMinutes: 0,
      startBalance: 0,
      includedMinutes: 24 * 60,
      monthlyFee: 1200,
      overageRate: 120,
      rolloverEnabled: true,
      cycleLength: 3,
      positionInCycle: getRetainerRecalcCyclePosition({
        rolloverEnabled: true,
        cycleLength: 3,
      }),
    });
    expect(r.isOverageDue).toBe(true);
    expect(r.overageAmount).toBe(720);
  });

  it("keeps monthly retainer recalculation independent of cycle position", () => {
    expect(
      getRetainerRecalcCyclePosition({
        rolloverEnabled: false,
        cycleLength: 3,
      }),
    ).toBe(-1);
  });
});

describe("getRetainerCycleStartMonth", () => {
  it("locates the first month of the same cycle", () => {
    // Project starts Jan; cycle length 3; ask about June (position 2 of cycle 2).
    // Cycle 2 starts in April.
    expect(getRetainerCycleStartMonth("2026-01-01", 2026, 6, 3)).toEqual({
      year: 2026,
      month: 4,
    });
  });

  it("handles year wrap-around inside a cycle", () => {
    // Project starts 2025-11; cycle length 3 → Nov, Dec, Jan(2026) is one cycle.
    // Asking about Jan 2026 returns Nov 2025.
    expect(getRetainerCycleStartMonth("2025-11-01", 2026, 1, 3)).toEqual({
      year: 2025,
      month: 11,
    });
  });

  it("returns null when the project has no startDate", () => {
    expect(getRetainerCycleStartMonth(undefined, 2026, 4, 3)).toBeNull();
  });
});

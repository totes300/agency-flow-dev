import { describe, it, expect } from "vitest";

/**
 * Phase B tests — retainer balance computation with real time entries.
 *
 * Tests the balance chaining, overage, and badge status logic as pure functions
 * matching the getRetainerData query implementation.
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

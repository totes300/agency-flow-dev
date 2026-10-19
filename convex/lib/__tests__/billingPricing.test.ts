/**
 * Pricing (docs/prd-billing-refactor.md §7, §11) — the one function every
 * money surface calls. Pure; amounts in minor units.
 */

import { describe, expect, it } from "vitest";
import { priceScope, type PricedMember, type PricingProject } from "../billing/pricing";
import type { Period } from "../billing/periods";

const MAR: Period = { start: "2026-03-01", end: "2026-03-31" };
const Q1: Period = { start: "2026-01-01", end: "2026-03-31" };

const retainer: PricingProject = {
  billingType: "retainer",
  startDate: "2026-01-01",
  includedMinutesPerMonth: 600,
  overageRateMinor: 9000, // 90.00/h
};
const cycle: PricingProject = { ...retainer, rolloverEnabled: true, cycleLength: 3 };
const tm: PricingProject = { billingType: "t_and_m" };

let seq = 0;
function m(
  date: string,
  minutes: number,
  over: Partial<PricedMember["entry"]> & { carried?: PricedMember["carried"] } = {},
): PricedMember {
  seq += 1;
  const { carried, ...entry } = over;
  return {
    entry: {
      _id: `e${seq}`,
      date,
      minutes,
      isBillable: true,
      taskId: "t1",
      billableRateMinor: 0,
      ...entry,
    },
    ...(carried ? { carried } : {}),
  };
}

const price = (
  project: PricingProject,
  period: Period,
  members: PricedMember[],
  roundingMinutes = 1,
  todayStr = "2026-12-01",
) => priceScope({ project, period, members, roundingMinutes, todayStr });

describe("T&M", () => {
  it("prices each (category, task, rate) line from rounded minutes", () => {
    const r = price(
      tm,
      MAR,
      [
        m("2026-03-03", 20, { taskId: "design", billableRateMinor: 10000 }),
        m("2026-03-09", 50, { taskId: "build", billableRateMinor: 9000 }),
      ],
      15,
    );
    // design 20 → 30 min × 100 = 50.00; build 50 → 60 min × 90 = 90.00
    expect(r.lines.map((l) => [l.taskId, l.minutes, l.billedMinutes, l.amountMinor])).toEqual([
      ["design", 20, 30, 5000],
      ["build", 50, 60, 9000],
    ]);
    expect(r.amountMinor).toBe(14000);
    expect(r.withinBudget).toBe(true);
  });

  it("rounds once per line, not per entry", () => {
    const r = price(
      tm,
      MAR,
      [m("2026-03-03", 10, { billableRateMinor: 10000 }), m("2026-03-04", 10, { billableRateMinor: 10000 })],
      15,
    );
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].billedMinutes).toBe(30); // 20 → 30, not 15 + 15
    expect(r.amountMinor).toBe(5000);
  });

  it("splits lines by rate and category", () => {
    const r = price(tm, MAR, [
      m("2026-03-03", 60, { billableRateMinor: 10000 }),
      m("2026-03-04", 60, { billableRateMinor: 12000 }),
      m("2026-03-05", 60, { billableRateMinor: 10000, categoryId: "c2" }),
    ]);
    expect(r.lines).toHaveLength(3);
    expect(r.amountMinor).toBe(10000 + 12000 + 10000);
  });

  it("20 minutes at 100/h is 33.33, never 33.00 via 0.33 h (B5)", () => {
    expect(price(tm, MAR, [m("2026-03-03", 20, { billableRateMinor: 10000 })]).amountMinor).toBe(3333);
  });

  it("non-billable entries never produce lines", () => {
    const r = price(tm, MAR, [m("2026-03-03", 60, { isBillable: false, billableRateMinor: 10000 })]);
    expect(r.lines).toEqual([]);
    expect(r.amountMinor).toBe(0);
  });
});

describe("retainer", () => {
  it("prices overage from raw minutes (B1)", () => {
    const r = price({ ...retainer, includedMinutesPerMonth: 60, overageRateMinor: 10000 }, MAR, [
      m("2026-03-10", 67),
    ]);
    expect(r.overageMinutes).toBe(7);
    expect(r.amountMinor).toBe(1167); // 11.67, not 12.00
    expect(r.overage).toEqual({ minutes: 7, rateMinor: 10000, amountMinor: 1167 });
  });

  it("ignores line rounding — retainer math is always raw", () => {
    const r = price({ ...retainer, includedMinutesPerMonth: 60, overageRateMinor: 10000 }, MAR, [m("2026-03-10", 67)], 15);
    expect(r.overageMinutes).toBe(7);
    expect(r.lines[0].billedMinutes).toBe(67);
  });

  it("time lines are a $0 work report; non-billable never counts toward usage", () => {
    const r = price(retainer, MAR, [
      m("2026-03-04", 400),
      m("2026-03-18", 255),
      m("2026-03-20", 120, { isBillable: false }),
    ]);
    expect(r.usageMinutes).toBe(655);
    expect(r.lines.every((l) => l.amountMinor === 0)).toBe(true);
    expect(r.overageMinutes).toBe(55);
    expect(r.amountMinor).toBe(8250); // the consistency suite's 82.50
  });

  it("budget flip: within budget bills nothing", () => {
    const r = price(retainer, MAR, [m("2026-03-04", 600)]);
    expect(r.withinBudget).toBe(true);
    expect(r.overage).toBeNull();
    expect(r.amountMinor).toBe(0);
    expect(price(retainer, MAR, [m("2026-03-04", 601)]).withinBudget).toBe(false);
  });

  it("zero scope is a valid within-budget close", () => {
    const r = price(retainer, MAR, []);
    expect(r).toMatchObject({ usageMinutes: 0, amountMinor: 0, withinBudget: true, issues: [] });
  });

  it("missing overage rate is a blocking issue only when over budget", () => {
    const noRate = { ...retainer, overageRateMinor: 0 };
    expect(price(noRate, MAR, [m("2026-03-04", 700)]).issues).toEqual(["missing-overage-rate"]);
    expect(price(noRate, MAR, [m("2026-03-04", 500)]).issues).toEqual([]);
  });

  it("carried-in minutes consume the receiving period's budget", () => {
    const r = price(retainer, MAR, [m("2026-02-20", 300, { carried: "skipped" }), m("2026-03-04", 400)]);
    expect(r.usageMinutes).toBe(700);
    expect(r.overageMinutes).toBe(100);
    expect(r.carriedInMinutes).toBe(300);
  });
});

describe("cycle retainer", () => {
  it("includes perMonth × cycle length and builds the balance ladder", () => {
    const r = price(cycle, Q1, [
      m("2025-12-15", 60, { carried: "logged-late" }),
      m("2026-01-10", 500),
      m("2026-02-10", 700),
      m("2026-03-10", 640),
    ]);
    expect(r.includedMinutes).toBe(1800);
    expect(r.usageMinutes).toBe(1900);
    expect(r.overageMinutes).toBe(100);
    expect(r.amountMinor).toBe(15000); // 100 min × 90/h
    // Carried-in work counts on the first month (its §8.3 bucket).
    expect(r.monthlyBalances).toEqual([
      {
        monthKey: "2026-01", includedMinutes: 600, carriedInMinutes: 60, loggedMinutes: 500, usedMinutes: 560,
        startBalanceMinutes: 0, availableMinutes: 600, balanceMinutes: 40, endingBalanceMinutes: 40,
        overageMinutes: 0, overageAmountMinor: 0, includedToDateMinutes: 600, usedToDateMinutes: 560,
        remainingMinutes: 1240, pending: false, isLast: false,
      },
      {
        monthKey: "2026-02", includedMinutes: 600, carriedInMinutes: 0, loggedMinutes: 700, usedMinutes: 700,
        startBalanceMinutes: 40, availableMinutes: 640, balanceMinutes: -60, endingBalanceMinutes: -60,
        overageMinutes: 60, overageAmountMinor: 9000, includedToDateMinutes: 1200, usedToDateMinutes: 1260,
        remainingMinutes: 540, pending: false, isLast: false,
      },
      {
        monthKey: "2026-03", includedMinutes: 600, carriedInMinutes: 0, loggedMinutes: 640, usedMinutes: 640,
        startBalanceMinutes: -60, availableMinutes: 540, balanceMinutes: -100, endingBalanceMinutes: -100,
        overageMinutes: 100, overageAmountMinor: 15000, includedToDateMinutes: 1800, usedToDateMinutes: 1900,
        remainingMinutes: -100, pending: false, isLast: true,
      },
    ]);
    expect(r.balanceToDateMinutes).toBe(-100);
  });

  it("mid-cycle: future months are pending and the balance is to date", () => {
    const r = price(cycle, Q1, [m("2026-01-10", 500)], 1, "2026-01-20");
    expect(r.monthlyBalances.map((row) => row.pending)).toEqual([false, true, true]);
    expect(r.balanceToDateMinutes).toBe(100);
  });

  it("a future month with logged time keeps the months before it in play", () => {
    const r = price(cycle, Q1, [m("2026-01-10", 500), m("2026-03-02", 30)], 1, "2026-01-20");
    expect(r.monthlyBalances.map((row) => row.pending)).toEqual([false, false, false]);
    expect(r.balanceToDateMinutes).toBe(1270);
  });

  it("stored snapshot months win over the entry date (§8.3)", () => {
    const r = price(cycle, Q1, [{ ...m("2026-02-10", 120), monthKey: "2026-03" }]);
    expect(r.monthlyBalances.map((row) => row.usedMinutes)).toEqual([0, 0, 120]);
  });
});

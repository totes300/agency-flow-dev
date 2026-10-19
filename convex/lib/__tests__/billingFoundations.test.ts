import { describe, expect, it } from "vitest";
import {
  ceilToIncrement,
  currencyExponent,
  fromMinor,
  priceMinutesMinor,
  round2,
  roundHalfUp,
  toMinor,
} from "../billing/money";
import {
  isCycleGrid,
  monthBucket,
  monthEndOfAbs,
  absMonthOf,
  nextPeriod,
  periodOfDate,
  type PeriodGridProject,
} from "../billing/periods";

describe("money", () => {
  it("ceilToIncrement leaves raw minutes alone at increment ≤ 1", () => {
    expect(ceilToIncrement(20, 1)).toBe(20);
    expect(ceilToIncrement(20, 0)).toBe(20);
    expect(ceilToIncrement(20, 15)).toBe(30);
    expect(ceilToIncrement(30, 15)).toBe(30);
    expect(ceilToIncrement(0, 15)).toBe(0);
  });

  it("round2 keeps the legacy cent rounding", () => {
    expect(round2(11.666)).toBe(11.67);
    expect(round2(33.3333)).toBe(33.33);
  });

  it("roundHalfUp is symmetric around zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it("currency exponents follow ISO 4217", () => {
    expect(currencyExponent("EUR")).toBe(2);
    expect(currencyExponent("huf")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
  });

  it("toMinor / fromMinor round-trip", () => {
    expect(toMinor(11.67, "EUR")).toBe(1167);
    expect(toMinor(0.1 + 0.2, "EUR")).toBe(30);
    expect(fromMinor(1167, "EUR")).toBe(11.67);
    expect(toMinor(1500, "JPY")).toBe(1500);
  });

  it("priceMinutesMinor prices minutes in one rounding step (B1)", () => {
    // 7 min at 100.00/h = 11.666… → 1167 cents, never 12.00 via 0.12 h
    expect(priceMinutesMinor(7, 10000)).toBe(1167);
    // 20 min at 100.00/h = 33.33, never 33.00 via 0.33 h (B5)
    expect(priceMinutesMinor(20, 10000)).toBe(3333);
  });
});

describe("periods", () => {
  const monthly: PeriodGridProject = { billingType: "retainer", startDate: "2026-02-10" };
  const cycle: PeriodGridProject = {
    billingType: "retainer",
    startDate: "2026-02-10",
    rolloverEnabled: true,
    cycleLength: 3,
  };
  const tm: PeriodGridProject = { billingType: "t_and_m" };

  it("month ends handle leap years", () => {
    expect(monthEndOfAbs(absMonthOf("2028-02-01"))).toBe("2028-02-29");
    expect(monthEndOfAbs(absMonthOf("2026-02-01"))).toBe("2026-02-28");
    expect(monthEndOfAbs(absMonthOf("2026-12-01"))).toBe("2026-12-31");
  });

  it("only multi-month rollover retainers use the cycle grid", () => {
    expect(isCycleGrid(monthly)).toBe(false);
    expect(isCycleGrid(cycle)).toBe(true);
    expect(isCycleGrid({ ...cycle, cycleLength: 1 })).toBe(false);
    expect(isCycleGrid(tm)).toBe(false);
  });

  it("monthly grid", () => {
    expect(periodOfDate(monthly, "2026-03-17")).toEqual({ start: "2026-03-01", end: "2026-03-31" });
    expect(nextPeriod(tm, { start: "2026-12-01", end: "2026-12-31" })).toEqual({
      start: "2027-01-01",
      end: "2027-01-31",
    });
  });

  it("cycle grid is anchored at the start month", () => {
    expect(periodOfDate(cycle, "2026-03-17")).toEqual({ start: "2026-02-01", end: "2026-04-30" });
    expect(periodOfDate(cycle, "2026-05-01")).toEqual({ start: "2026-05-01", end: "2026-07-31" });
    expect(nextPeriod(cycle, { start: "2026-02-01", end: "2026-04-30" })).toEqual({
      start: "2026-05-01",
      end: "2026-07-31",
    });
    // Before the project start clamps to the first cycle.
    expect(periodOfDate(cycle, "2026-01-05")).toEqual({ start: "2026-02-01", end: "2026-04-30" });
  });

  it("monthBucket clamps into the settling period", () => {
    const q = { start: "2026-02-01", end: "2026-04-30" };
    expect(monthBucket("2026-03-17", q)).toBe("2026-03");
    expect(monthBucket("2026-01-20", q)).toBe("2026-02"); // carried-in → first month
    expect(monthBucket("2026-05-02", q)).toBe("2026-04");
  });
});

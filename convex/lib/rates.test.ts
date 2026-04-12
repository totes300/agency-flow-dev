import { describe, expect, it } from "vitest";
import { resolveRate, type RateContext } from "./rates";

describe("resolveRate", () => {
  const base: RateContext = {
    isBillable: true,
    isNonBillableProject: false,
    userCostRate: 50,
    resolvedBillableRate: 120,
    billableRateError: null,
    currency: "USD",
  };

  it("billable + all rates → full snapshot", () => {
    expect(resolveRate(base)).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 120, rateCurrency: "USD" },
    });
  });

  it("missing user cost rate → error", () => {
    const result = resolveRate({ ...base, userCostRate: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cost rate");
  });

  it("billable + missing billable rate → uses custom error", () => {
    const result = resolveRate({
      ...base,
      resolvedBillableRate: null,
      billableRateError: "Set a billable rate for Design in USD",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Set a billable rate for Design in USD");
  });

  it("billable + missing billable rate + no custom error → fallback error", () => {
    const result = resolveRate({
      ...base,
      resolvedBillableRate: null,
      billableRateError: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("billable rate");
  });

  it("retainer billable entry → billableRate = 0 (revenue is cycle-level)", () => {
    // Retainer entries always pass resolvedBillableRate = 0 from orgHelpers,
    // so resolveRate receives it as a valid rate and returns billableRate = 0.
    const result = resolveRate({
      ...base,
      resolvedBillableRate: 0,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 0, rateCurrency: "USD" },
    });
  });

  it("non-billable entry → billableRate = 0", () => {
    const result = resolveRate({ ...base, isBillable: false });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 0, rateCurrency: "USD" },
    });
  });

  it("non-billable project → billableRate = 0 even if isBillable", () => {
    const result = resolveRate({ ...base, isNonBillableProject: true });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 0, rateCurrency: "USD" },
    });
  });

  it("non-billable + missing billable rate → still OK (billableRate = 0)", () => {
    const result = resolveRate({
      ...base,
      isBillable: false,
      resolvedBillableRate: null,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 0, rateCurrency: "USD" },
    });
  });

  it("cost rate = 0 is valid (unpaid intern)", () => {
    const result = resolveRate({ ...base, userCostRate: 0 });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 0, billableRate: 120, rateCurrency: "USD" },
    });
  });
});

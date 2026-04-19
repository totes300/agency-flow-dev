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

  // ─── Currency invariant (D1) ─────────────────────────────────────────────
  // The project summary card sums money amounts across entries without currency
  // partitioning, so the snapshot MUST reflect the caller's project currency.

  it("currency propagates into snapshot (EUR)", () => {
    const result = resolveRate({ ...base, currency: "EUR" });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 50, billableRate: 120, rateCurrency: "EUR" },
    });
  });

  it("currency propagates into snapshot (HUF)", () => {
    const result = resolveRate({
      ...base,
      currency: "HUF",
      userCostRate: 8000,
      resolvedBillableRate: 20000,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 8000, billableRate: 20000, rateCurrency: "HUF" },
    });
  });

  it("missing cost rate error names the required currency", () => {
    const result = resolveRate({
      ...base,
      currency: "EUR",
      userCostRate: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Set a cost rate for this user in EUR");
  });

  it("fallback billable rate error names the required currency", () => {
    const result = resolveRate({
      ...base,
      currency: "GBP",
      resolvedBillableRate: null,
      billableRateError: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Set a billable rate in GBP");
  });

  it("retainer zero billableRate does NOT trigger missing-rate error", () => {
    // Regression guard: orgHelpers passes resolvedBillableRate = 0 for retainer
    // entries. Zero is a valid rate (not null), so resolveRate must NOT throw.
    const result = resolveRate({ ...base, resolvedBillableRate: 0 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.snapshot.billableRate).toBe(0);
  });

  it("non-billable + userCostRate = 0 is valid (internal unpaid work)", () => {
    const result = resolveRate({
      ...base,
      isBillable: false,
      userCostRate: 0,
      resolvedBillableRate: null,
    });
    expect(result).toEqual({
      ok: true,
      snapshot: { costRate: 0, billableRate: 0, rateCurrency: "USD" },
    });
  });
});

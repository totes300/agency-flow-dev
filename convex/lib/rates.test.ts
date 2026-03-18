import { describe, expect, it } from "vitest";
import { resolveRate, type RateContext } from "./rates";

describe("resolveRate", () => {
  // ─── T&M flat ──────────────────────────────────────────────────────────────
  it("T&M flat → appliedRate from project.hourlyRate", () => {
    const ctx: RateContext = {
      billingType: "t_and_m",
      tmRateMode: "flat",
      hourlyRate: 150,
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedRate: 150 },
    });
  });

  it("T&M flat without hourlyRate → error", () => {
    const ctx: RateContext = {
      billingType: "t_and_m",
      tmRateMode: "flat",
    };
    const result = resolveRate(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("hourly rate");
  });

  // ─── T&M per-category ─────────────────────────────────────────────────────
  it("T&M per-category + matching category → appliedRate", () => {
    const ctx: RateContext = {
      billingType: "t_and_m",
      tmRateMode: "per_category",
      tmCategoryRates: [
        { workCategoryId: "cat-design", rate: 120 },
        { workCategoryId: "cat-dev", rate: 180 },
      ],
      workCategoryId: "cat-dev",
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedRate: 180 },
    });
  });

  it("T&M per-category + no task category → error", () => {
    const ctx: RateContext = {
      billingType: "t_and_m",
      tmRateMode: "per_category",
      tmCategoryRates: [{ workCategoryId: "cat-design", rate: 120 }],
    };
    const result = resolveRate(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("category");
  });

  it("T&M per-category + category not in list → error", () => {
    const ctx: RateContext = {
      billingType: "t_and_m",
      tmRateMode: "per_category",
      tmCategoryRates: [{ workCategoryId: "cat-design", rate: 120 }],
      workCategoryId: "cat-dev",
    };
    const result = resolveRate(ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("rate");
  });

  // ─── Fixed ─────────────────────────────────────────────────────────────────
  it("Fixed + estimate → cost + bill rates", () => {
    const ctx: RateContext = {
      billingType: "fixed",
      categoryEstimate: {
        internalCostRate: 80,
        clientBillingRate: 150,
      },
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedCostRate: 80, appliedBillRate: 150 },
    });
  });

  it("Fixed + no estimate → undefined rates (OK)", () => {
    const ctx: RateContext = {
      billingType: "fixed",
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedCostRate: undefined, appliedBillRate: undefined },
    });
  });

  // ─── Retainer ──────────────────────────────────────────────────────────────
  it("Retainer + overageRate → cost + bill rates", () => {
    const ctx: RateContext = {
      billingType: "retainer",
      overageRate: 200,
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedCostRate: 200, appliedBillRate: 200 },
    });
  });

  it("Retainer + no overageRate → undefined rates (OK)", () => {
    const ctx: RateContext = {
      billingType: "retainer",
    };
    expect(resolveRate(ctx)).toEqual({
      ok: true,
      snapshot: { appliedCostRate: undefined, appliedBillRate: undefined },
    });
  });
});

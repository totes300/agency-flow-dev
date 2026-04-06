/**
 * Pure rate snapshot resolver.
 *
 * Determines which rate(s) to apply on a time entry based on the project's
 * billing type and the task's work category.
 */

export type RateSnapshot = {
  appliedRate?: number;
  appliedCostRate?: number;
  appliedBillRate?: number;
};

export type RateContext = {
  billingType: "fixed" | "retainer" | "t_and_m" | "non_billable";
  // T&M fields
  tmRateMode?: "flat" | "per_category";
  hourlyRate?: number;
  tmCategoryRates?: Array<{ workCategoryId: string; rate: number }>;
  // Fixed fields
  categoryEstimate?: {
    internalCostRate?: number;
    clientBillingRate?: number;
  };
  // Retainer fields
  overageRate?: number;
  // Task fields
  workCategoryId?: string;
};

export type RateResult =
  | { ok: true; snapshot: RateSnapshot }
  | { ok: false; error: string };

export function resolveRate(ctx: RateContext): RateResult {
  switch (ctx.billingType) {
    case "t_and_m":
      return resolveTmRate(ctx);
    case "fixed":
      return resolveFixedRate(ctx);
    case "retainer":
      return resolveRetainerRate(ctx);
    case "non_billable":
      return { ok: true, snapshot: {} };
  }
}

function resolveTmRate(ctx: RateContext): RateResult {
  if (ctx.tmRateMode === "per_category") {
    if (!ctx.workCategoryId) {
      return { ok: false, error: "Set a category on this task first" };
    }
    const match = ctx.tmCategoryRates?.find(
      (r) => r.workCategoryId === ctx.workCategoryId,
    );
    if (!match) {
      return {
        ok: false,
        error: "Set a rate for this category on the project first",
      };
    }
    return { ok: true, snapshot: { appliedRate: match.rate } };
  }

  // Flat rate
  if (ctx.hourlyRate == null) {
    return { ok: false, error: "Set an hourly rate on the project first" };
  }
  return { ok: true, snapshot: { appliedRate: ctx.hourlyRate } };
}

function resolveFixedRate(ctx: RateContext): RateResult {
  // Fixed projects use cost/bill rates from category estimates
  // If no estimate exists, rates are null (OK — Fixed never generates invoices from rates)
  return {
    ok: true,
    snapshot: {
      appliedCostRate: ctx.categoryEstimate?.internalCostRate,
      appliedBillRate: ctx.categoryEstimate?.clientBillingRate,
    },
  };
}

function resolveRetainerRate(ctx: RateContext): RateResult {
  // Retainer uses overage rate as both cost and bill rate
  return {
    ok: true,
    snapshot: {
      appliedCostRate: ctx.overageRate,
      appliedBillRate: ctx.overageRate,
    },
  };
}

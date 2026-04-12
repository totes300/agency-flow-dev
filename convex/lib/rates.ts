/**
 * Pure rate snapshot resolver.
 *
 * Determines the costRate and billableRate for a time entry based on
 * user cost rates, category billable rates, and billability.
 */

export type RateSnapshot = {
  costRate: number;
  billableRate: number;
  rateCurrency: string;
};

export type RateContext = {
  isBillable: boolean;
  isNonBillableProject: boolean;
  userCostRate: number | null;
  resolvedBillableRate: number | null;
  billableRateError: string | null; // project-type-specific error when rate is missing
  currency: string;
};

export type RateResult =
  | { ok: true; snapshot: RateSnapshot }
  | { ok: false; error: string };

/**
 * Pure rate resolver.
 *
 * Requires: userCostRate always.
 * For billable entries on billable projects: also requires categoryBillableRate.
 * Non-billable entries or non-billable projects: billableRate = 0.
 */
export function resolveRate(ctx: RateContext): RateResult {
  if (ctx.userCostRate === null) {
    return {
      ok: false,
      error: `Set a cost rate for this user in ${ctx.currency}`,
    };
  }

  if (!ctx.isBillable || ctx.isNonBillableProject) {
    return {
      ok: true,
      snapshot: {
        costRate: ctx.userCostRate,
        billableRate: 0,
        rateCurrency: ctx.currency,
      },
    };
  }

  if (ctx.resolvedBillableRate === null) {
    return {
      ok: false,
      error: ctx.billableRateError ?? `Set a billable rate in ${ctx.currency}`,
    };
  }

  return {
    ok: true,
    snapshot: {
      costRate: ctx.userCostRate,
      billableRate: ctx.resolvedBillableRate,
      rateCurrency: ctx.currency,
    },
  };
}

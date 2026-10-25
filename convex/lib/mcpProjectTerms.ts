import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "./auth";
import { getProjectForAuth } from "../projects";
import { listProjectCategoryEstimatesForAuth } from "../projectCategoryEstimates";
import { listProjectRateOverridesForAuth } from "../projectRateOverrides";
import { listCategoryRatesForAuth } from "../categoryRates";
import { listWorkCategoriesForAuth } from "../workCategories";

/**
 * A project's billing terms for MCP `fetch` (admins only, as the project's
 * Settings tab): what `save_projects` edits, read through the app's own
 * project read cores, so an agent sees the current values before it
 * changes them. Members get null — no money, as in the app (D1: amounts
 * are returned as stored, the route only formats them).
 *
 * - retainer: status, monthly fee, included time per month, overage rate,
 *   start date, cycle length, rollover (defaults as the Retainer settings:
 *   active, 1-month cycle, rollover off);
 * - fixed: the fee, and per work category the budget estimate and rate;
 * - t_and_m: per work category the rate;
 * - non_billable: no terms.
 *
 * A category's rate is the project's override, else the workspace default
 * for the project's currency, else unset (the Rates / Budget & Rates
 * settings). Active categories are listed in their order; an archived one
 * only while it still has an estimate or override.
 *
 * Read budget: the project and client, the org's work categories and
 * default rates, the project's overrides and estimates (plus one read per
 * estimate's category) — a handful of ranges, bounded by the org's
 * category count.
 */

export type CategoryTerm = {
  category: string;
  archived: boolean;
  /** Fixed fee projects: the budget estimate in minutes; null = none. */
  estimateMinutes: number | null;
  /** The effective hourly rate; null = no rate set. */
  rate: number | null;
  rateSource: "project" | "default" | "none";
  /** The workspace default for the project's currency; null = none. */
  defaultRate: number | null;
};

export async function projectTermsForAuth(ctx: QueryCtx, auth: AuthContext, projectId: Id<"projects">) {
  if (!auth.isAdmin) return null;
  const project = await getProjectForAuth(ctx, auth, projectId);
  if (!project) return null;
  const currency = project.currency;

  switch (project.billingType) {
    case "retainer":
      return {
        billingType: "retainer" as const,
        currency,
        status: project.retainerStatus ?? "active",
        monthlyFee: project.monthlyFee ?? null,
        includedMinutes: project.includedMinutesPerMonth ?? null,
        overageRate: project.overageRate ?? null,
        startDate: project.startDate ?? null,
        cycleLength: project.cycleLength ?? 1,
        rollover: project.rolloverEnabled ?? false,
      };
    case "fixed":
      return {
        billingType: "fixed" as const,
        currency,
        fixedFee: project.fixedPrice ?? null,
        categories: await categoryTerms(ctx, auth, projectId, currency, true),
      };
    case "t_and_m":
      return {
        billingType: "t_and_m" as const,
        currency,
        categories: await categoryTerms(ctx, auth, projectId, currency, false),
      };
    case "non_billable":
      return { billingType: "non_billable" as const, currency };
  }
}

async function categoryTerms(
  ctx: QueryCtx,
  auth: AuthContext,
  projectId: Id<"projects">,
  currency: string,
  withEstimates: boolean,
): Promise<CategoryTerm[]> {
  const categories = await listWorkCategoriesForAuth(ctx, auth, true);
  const defaults = new Map(
    (await listCategoryRatesForAuth(ctx, auth))
      .filter((r) => r.currency === currency)
      .map((r) => [r.workCategoryId, r.defaultBillRate]),
  );
  const overrides = new Map(
    (await listProjectRateOverridesForAuth(ctx, auth, projectId)).map((o) => [o.workCategoryId, o.billableRate]),
  );
  const estimates = withEstimates
    ? new Map((await listProjectCategoryEstimatesForAuth(ctx, auth, projectId)).map((e) => [e.workCategoryId, e.estimatedMinutes]))
    : new Map<Id<"workCategories">, number>();

  const rows: CategoryTerm[] = [];
  for (const category of categories) {
    const override = overrides.get(category._id);
    const estimate = estimates.get(category._id);
    const archived = category.archivedAt !== undefined;
    if (archived && override === undefined && estimate === undefined) continue;
    const defaultRate = defaults.get(category._id) ?? null;
    rows.push({
      category: category.name,
      archived,
      estimateMinutes: estimate ?? null,
      rate: override ?? defaultRate,
      rateSource: override !== undefined ? "project" : defaultRate !== null ? "default" : "none",
      defaultRate,
    });
  }
  return rows;
}

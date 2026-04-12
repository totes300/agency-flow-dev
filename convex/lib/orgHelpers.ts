import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { RateSnapshot } from "./rates";
import { resolveRate } from "./rates";

export async function getOrgSettings(ctx: QueryCtx | MutationCtx, orgId: string) {
  return await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .first();
}

/**
 * Get the currency for a project by looking up its client.
 */
export async function getProjectCurrency(
  ctx: QueryCtx | MutationCtx,
  project: Doc<"projects">,
): Promise<string> {
  const client = await ctx.db.get(project.clientId);
  if (!client) {
    throw new ConvexError("Client not found for project");
  }
  return client.currency;
}

/**
 * Resolve a rate snapshot for a time entry.
 *
 * Looks up: userRates for costRate, projectRateOverrides → categoryRates for billableRate.
 * Throws ConvexError with a user-friendly message if a required rate is missing.
 */
export async function resolveRateSnapshot(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    orgId: string;
    task: Doc<"tasks">;
    project: Doc<"projects">;
    isBillable: boolean;
  },
): Promise<RateSnapshot> {
  const { userId, orgId, task, project, isBillable } = args;

  // 1. Get currency from client
  const currency = await getProjectCurrency(ctx, project);

  // 2. Look up user cost rate
  const userRate = await ctx.db
    .query("userRates")
    .withIndex("by_orgId_userId_currency", (q) =>
      q.eq("orgId", orgId).eq("userId", userId).eq("currency", currency)
    )
    .unique();

  const userCostRate = userRate?.costRate ?? null;

  // 3. Look up billable rate
  let resolvedBillableRate: number | null = null;
  let billableRateError: string | null = null;

  if (isBillable && project.billingType !== "non_billable") {
    if (project.billingType === "retainer") {
      // Retainer: billableRate is always 0 on individual entries.
      // Retainer revenue is cycle-level (monthlyFee + overageDue), not entry-level.
      // Overage is computed from cycle balance in getRetainerData, not per-entry.
      resolvedBillableRate = 0;
    } else if (!task.workCategoryId) {
      // T&M / Fixed without category — can't resolve billable rate
      billableRateError = "Set a category on this task before logging billable time";
    } else {
      // T&M / Fixed: project override → category default
      const override = await ctx.db
        .query("projectRateOverrides")
        .withIndex("by_projectId_workCategoryId", (q) =>
          q.eq("projectId", project._id).eq("workCategoryId", task.workCategoryId!)
        )
        .unique();

      if (override) {
        resolvedBillableRate = override.billableRate;
      } else {
        const catRate = await ctx.db
          .query("categoryRates")
          .withIndex("by_orgId_workCategoryId_currency", (q) =>
            q.eq("orgId", orgId).eq("workCategoryId", task.workCategoryId!).eq("currency", currency)
          )
          .unique();
        resolvedBillableRate = catRate?.defaultBillRate ?? null;
      }

      if (resolvedBillableRate === null) {
        billableRateError = `Set a billable rate for this category in ${currency}`;
      }
    }
  }

  // 4. Resolve
  const result = resolveRate({
    isBillable,
    isNonBillableProject: project.billingType === "non_billable",
    userCostRate,
    resolvedBillableRate,
    billableRateError,
    currency,
  });

  if (!result.ok) {
    throw new ConvexError(result.error);
  }

  return result.snapshot;
}

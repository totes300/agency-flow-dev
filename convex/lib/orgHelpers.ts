import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { RateContext } from "./rates";

export async function getOrgSettings(ctx: QueryCtx | MutationCtx, orgId: string) {
  return await ctx.db
    .query("orgSettings")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .first();
}

export async function buildRateContext(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"tasks">,
  project: Doc<"projects">,
): Promise<RateContext> {
  const rateCtx: RateContext = {
    billingType: project.billingType,
    tmRateMode: project.tmRateMode,
    hourlyRate: project.hourlyRate,
    tmCategoryRates: project.tmCategoryRates,
    overageRate: project.overageRate,
    workCategoryId: task.workCategoryId?.toString(),
  };

  if (project.billingType === "fixed" && task.workCategoryId) {
    const estimates = await ctx.db
      .query("projectCategoryEstimates")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .collect();
    const match = estimates.find(
      (e) => e.workCategoryId.toString() === task.workCategoryId!.toString(),
    );
    if (match) {
      rateCtx.categoryEstimate = {
        internalCostRate: match.internalCostRate,
        clientBillingRate: match.clientBillingRate,
      };
    }
  }

  return rateCtx;
}

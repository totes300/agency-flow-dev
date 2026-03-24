import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { RateContext, RateSnapshot } from "./rates";
import { resolveRate } from "./rates";

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

/**
 * Resolve a rate snapshot for a time entry.
 * Billable: enforces category + rate resolution (throws on failure).
 * Non-billable: best-effort, returns empty snapshot on failure.
 */
export async function resolveSnapshot(
  ctx: MutationCtx,
  task: Doc<"tasks">,
  project: Doc<"projects">,
  isBillable: boolean,
): Promise<RateSnapshot> {
  if (isBillable) {
    if (!task.workCategoryId) {
      throw new Error("Set a category on this task before logging billable time");
    }
    const rateCtx = await buildRateContext(ctx, task, project);
    const rateResult = resolveRate(rateCtx);
    if (!rateResult.ok) {
      throw new Error(rateResult.error);
    }
    return rateResult.snapshot;
  }

  // Non-billable: attempt resolution but don't throw on failure
  try {
    const rateCtx = await buildRateContext(ctx, task, project);
    const rateResult = resolveRate(rateCtx);
    if (rateResult.ok) {
      return rateResult.snapshot;
    }
  } catch {}
  return {};
}

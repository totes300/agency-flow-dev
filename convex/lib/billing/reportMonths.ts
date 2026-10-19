import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../../_generated/dataModel";
import { toScopeProject, type CloseContext } from "./closeData";
import { monthBucket, monthKeyOf } from "./periods";
import { effectivePeriod } from "./scope";

/**
 * The month (YYYY-MM) every entry of a project is reported under
 * (docs/prd-billing-refactor.md N8): the frozen snapshot bucket for entries
 * in a live close, the effective-period bucket for open ones. Carried-in
 * work lands in its receiving period's first month, so each entry counts on
 * exactly one month — the same rule the monthly report and the Monthly
 * Breakdown use.
 */
export async function loadReportMonths(
  ctx: { db: GenericDatabaseReader<DataModel> },
  c: CloseContext,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const close of c.liveCloses) {
    const rows = await ctx.db
      .query("billingCloseEntries")
      .withIndex("by_closeId", (q) => q.eq("closeId", close._id))
      .collect();
    for (const r of rows) out.set(r.entryId, r.monthKey);
  }
  const project = toScopeProject(c.project);
  for (const e of c.entries) {
    if (out.has(e._id)) continue;
    out.set(
      e._id,
      e.locked
        ? monthKeyOf(e.date)
        : monthBucket(e.date, effectivePeriod(project, e, c.livePeriods)),
    );
  }
  return out;
}

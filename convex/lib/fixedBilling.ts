/**
 * Fixed-fee billing math shared by invoices and projects.
 *
 * The invariant: across a project's lifetime, the sum of finalized
 * `lineType:"fixed"` amounts must never exceed `project.fixedPrice`.
 * Everything here serves that rule — partial (milestone) billing works by
 * issuing several fixed lines whose finalized sum walks up to the fee.
 */

import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Sum of `lineType:"fixed"` amounts across the project's FINALIZED invoices
 * (`invoiced`/`paid`). Drafts are provisional — counting them would let a
 * delete-then-recreate cycle over-bill the project; voids freed their slice.
 */
export async function getFixedBilledFinalized(
  ctx: QueryCtx,
  orgId: string,
  projectId: Id<"projects">,
): Promise<number> {
  const projectInvoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .filter((q) => q.eq(q.field("orgId"), orgId))
    .collect();

  let billed = 0;
  for (const inv of projectInvoices) {
    if (inv.status === "draft" || inv.status === "void") continue;
    const items = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
      .collect();
    for (const item of items) {
      if (item.orgId === orgId && item.lineType === "fixed") {
        billed += item.amount;
      }
    }
  }
  return round2(billed);
}

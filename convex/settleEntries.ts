/**
 * Deployed Convex functions for entry settlement.
 *
 * Pure helpers live next door at `convex/lib/settleEntries.ts`. This file
 * holds the one-shot backfill mutation and is the right home for any
 * future top-level settlement mutations (e.g. a re-settle utility for
 * recovering from a botched void).
 */

import { internalMutation } from "./_generated/server";
import type { SettledReason } from "./lib/settleEntries";

/**
 * Walk every time entry and, for those linked to a finalized invoice
 * (`status ∈ {invoiced, paid}`) but missing `settledAt`, write the
 * settlement snapshot the new model expects:
 *
 *   - `settledAt`         = `invoice.issueDate` (parsed to ms) or `now`.
 *   - `settledReason`     = `"fixed_included"` for Fixed projects, else
 *                           `"invoiced"`.
 *   - `settledPeriodStart`/`End` = the invoice's period.
 *
 * Idempotent: re-running is a no-op for already-settled rows because the
 * `settledAt === undefined` guard skips them. Safe to run multiple times.
 *
 * Project `billingType` lookups are cached so a project with N invoices
 * only triggers one `ctx.db.get(project)` call.
 *
 * Run once after deploy:
 *   npx convex run settleEntries:backfillSettledFromInvoiceId
 *
 * Per [[project_mvp_dummy_data]], the dataset is dummy and no production
 * obligation exists. The backfill makes `projectOverview`'s new bucket
 * fields reflect history immediately, not just future invoices.
 *
 * Note: a single `.collect()` over the whole `timeEntries` table is fine
 * at MVP scale but would OOM on production datasets. When that becomes
 * a concern, paginate over the `by_orgId` index and process per-org.
 */
export const backfillSettledFromInvoiceId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("timeEntries").collect();

    const projectTypeCache = new Map<
      string,
      "fixed" | "retainer" | "t_and_m" | "non_billable"
    >();

    let touched = 0;
    let skippedNoInvoice = 0;
    let skippedNotFinalized = 0;

    for (const e of all) {
      if (e.invoiceId === undefined || e.settledAt !== undefined) {
        if (e.invoiceId === undefined) skippedNoInvoice++;
        continue;
      }
      const invoice = await ctx.db.get(e.invoiceId);
      if (!invoice) continue;
      if (invoice.status !== "invoiced" && invoice.status !== "paid") {
        skippedNotFinalized++;
        continue;
      }

      const projectKey = invoice.projectId.toString();
      let billingType = projectTypeCache.get(projectKey);
      if (billingType === undefined) {
        const project = await ctx.db.get(invoice.projectId);
        if (!project) continue;
        billingType = project.billingType;
        projectTypeCache.set(projectKey, billingType);
      }

      const reason: SettledReason =
        billingType === "fixed" ? "fixed_included" : "invoiced";
      const settledAt = invoice.issueDate
        ? new Date(invoice.issueDate).getTime()
        : now;

      await ctx.db.patch(e._id, {
        settledAt,
        settledReason: reason,
        settledPeriodStart: invoice.periodStart,
        settledPeriodEnd: invoice.periodEnd,
        updatedAt: now,
      });
      touched++;
    }

    console.log(
      `Backfilled ${touched} settled entries (skipped: ${skippedNoInvoice} no-invoice, ${skippedNotFinalized} not-finalized)`,
    );
    return { touched, skippedNoInvoice, skippedNotFinalized };
  },
});

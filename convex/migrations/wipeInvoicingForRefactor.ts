import { v, ConvexError } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { FunctionReference } from "convex/server";

/**
 * One-time migration for the invoicing refactor cutover
 * (`docs/invoicing-refactor.md` § Migration). Wipes the three tables that
 * carry retainer-fee / per-month-noise dummy data so the refactored Ready
 * feed and Monthly Report flows can be smoke-tested against a clean slate:
 *
 *   - invoices
 *   - invoiceLineItems
 *   - retainerPeriods
 *
 * Sanctioned by memory `project_mvp_dummy_data.md` (dummy data only — no
 * production migration concerns).
 *
 * Runs ONE table per invocation in 500-row batches; re-schedules itself
 * until that table is empty, then advances to the next. Keeps every
 * transaction under Convex's write limit and lets the dashboard log the
 * progress one batch at a time.
 *
 * Run from the repo root (mirrors `wipeAllTimeEntries.ts` invocation):
 *   npx convex run migrations/wipeInvoicingForRefactor \
 *     '{"confirm":"WIPE_INVOICING_FOR_REFACTOR"}'
 *
 * After wiping, reseed manually through the app UI to cover the eight
 * scenarios listed in
 * `docs/invoicing-refactor-issues/03-cutover-wipe-reseed-verification.md`
 * — or call the seed actions you already use for new dev orgs.
 */

const TABLES = ["invoices", "invoiceLineItems", "retainerPeriods"] as const;
type WipeTable = (typeof TABLES)[number];

export default internalMutation({
  args: {
    confirm: v.literal("WIPE_INVOICING_FOR_REFACTOR"),
    table: v.optional(
      v.union(
        v.literal("invoices"),
        v.literal("invoiceLineItems"),
        v.literal("retainerPeriods"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const table: WipeTable = args.table ?? TABLES[0];

    const batch = await ctx.db.query(table).take(500);
    for (const row of batch) {
      await ctx.db.delete(row._id);
    }
    const deleted = batch.length;
    const hasMore = deleted === 500;

    const selfRef =
      "migrations/wipeInvoicingForRefactor:default" as unknown as FunctionReference<
        "mutation",
        "internal",
        {
          confirm: "WIPE_INVOICING_FOR_REFACTOR";
          table?: WipeTable;
        },
        { table: WipeTable; deleted: number; hasMore: boolean; nextTable: WipeTable | null }
      >;

    if (hasMore) {
      // Same table — keep draining.
      await ctx.scheduler.runAfter(0, selfRef, {
        confirm: "WIPE_INVOICING_FOR_REFACTOR",
        table,
      });
      return { table, deleted, hasMore, nextTable: table };
    }

    // Table drained — advance to the next one (if any).
    const idx = TABLES.indexOf(table);
    const nextTable = idx >= 0 && idx < TABLES.length - 1 ? TABLES[idx + 1] : null;
    if (nextTable) {
      await ctx.scheduler.runAfter(0, selfRef, {
        confirm: "WIPE_INVOICING_FOR_REFACTOR",
        table: nextTable,
      });
      return { table, deleted, hasMore: false, nextTable };
    }

    if (deleted === 0 && idx === 0) {
      throw new ConvexError(
        "All three invoicing tables are already empty — safe to delete this file.",
      );
    }

    return { table, deleted, hasMore: false, nextTable: null };
  },
});

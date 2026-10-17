/**
 * Cutover reset for the close model (docs/prd-billing-refactor.md slice 3c).
 * MVP stage, dummy data only ([[project_mvp_dummy_data]]): rather than
 * translating legacy billing state, start every org's billing from a clean
 * slate. Time entries are KEPT — only their billing stamps are cleared — so
 * every logged hour becomes open and flows through the new Close queue.
 *
 * Phases, one per call, 500 docs per batch (re-run until `done`):
 *   1. entries      clear invoiceId / settled* / closeId on time entries
 *   2. lineItems    delete invoiceLineItems
 *   3. invoices     delete invoices
 *   4. periods      delete retainerPeriods
 *   5. closeRows    delete billingCloseEntries
 *   6. closes       delete billingCloses
 *   7. events       delete billingEvents
 *   8. numbering    reset orgSettings.nextInvoiceNumber to 1
 *
 *   npx convex run migrations/resetBillingForCloseModel \
 *     '{"confirm":"RESET_BILLING_FOR_CLOSE_MODEL","phase":"entries","cursor":null}'
 */

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const PHASES = [
  "entries",
  "lineItems",
  "invoices",
  "periods",
  "closeRows",
  "closes",
  "events",
  "numbering",
] as const;
type Phase = (typeof PHASES)[number];

const TABLE_OF: Record<Exclude<Phase, "entries" | "numbering">, "invoiceLineItems" | "invoices" | "retainerPeriods" | "billingCloseEntries" | "billingCloses" | "billingEvents"> = {
  lineItems: "invoiceLineItems",
  invoices: "invoices",
  periods: "retainerPeriods",
  closeRows: "billingCloseEntries",
  closes: "billingCloses",
  events: "billingEvents",
};

export default internalMutation({
  args: {
    confirm: v.literal("RESET_BILLING_FOR_CLOSE_MODEL"),
    phase: v.union(...PHASES.map((p) => v.literal(p))),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const next = (isDone: boolean, cursor: string | null) => {
      const i = PHASES.indexOf(args.phase);
      return isDone
        ? { phase: PHASES[i + 1] ?? null, cursor: null, done: i + 1 >= PHASES.length }
        : { phase: args.phase, cursor, done: false };
    };

    if (args.phase === "numbering") {
      for (const s of await ctx.db.query("orgSettings").collect()) {
        await ctx.db.patch(s._id, { nextInvoiceNumber: 1, updatedAt: Date.now() });
      }
      return { ...next(true, null), touched: 0 };
    }

    if (args.phase === "entries") {
      const page = await ctx.db.query("timeEntries").paginate({ cursor: args.cursor, numItems: 500 });
      let touched = 0;
      for (const e of page.page) {
        if (
          e.invoiceId === undefined &&
          e.settledAt === undefined &&
          e.settledReason === undefined &&
          e.settledPeriodStart === undefined &&
          e.settledPeriodEnd === undefined &&
          e.closeId === undefined
        ) {
          continue;
        }
        await ctx.db.patch(e._id, {
          invoiceId: undefined,
          settledAt: undefined,
          settledReason: undefined,
          settledPeriodStart: undefined,
          settledPeriodEnd: undefined,
          closeId: undefined,
        });
        touched++;
      }
      return { ...next(page.isDone, page.continueCursor), touched };
    }

    const table = TABLE_OF[args.phase];
    const page = await ctx.db.query(table).paginate({ cursor: args.cursor, numItems: 500 });
    for (const doc of page.page) await ctx.db.delete(doc._id);
    return { ...next(page.isDone, page.continueCursor), touched: page.page.length };
  },
});

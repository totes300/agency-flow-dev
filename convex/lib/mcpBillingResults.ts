import { v, type Infer } from "convex/values";
import { BILLING_ACTIONS } from "../../lib/mcp/limits";

export { BILLING_ACTIONS, INVOICE_ACTIONS, PERIOD_ACTIONS, PROJECT_ACTIONS, type BillingAction } from "../../lib/mcp/limits";

/**
 * MCP billing preview → commit (docs/prd-mcp.md D5, §9): the actions, the
 * resolved params a preview stores, and the commit result stored with it so
 * a second commit with the same token returns the first result. Pure
 * validators: imported by the schema.
 *
 * The actions are the app's own period and invoice actions, one each
 * (docs/prd-project-billing-redesign.md §5.2–§5.4), each running the app's
 * write path:
 *   close_period          Close workspace commit — "Create draft invoice" /
 *                         "Close period" (billingCloses.commitClose)
 *   reopen_period         ⋯ "Reopen period" (billingCloses.reopenClose)
 *   create_fixed_invoice  fixed fee "Create invoice" (billingInvoices.createFixedInvoice)
 *   mark_invoiced         invoice page "Mark as invoiced" (changeInvoiceStatus → invoiced)
 *   mark_paid             "Mark as paid" (→ paid)
 *   mark_unpaid           "Mark as unpaid" (paid → invoiced)
 *   revert_to_draft       "Revert to draft" (invoiced → draft)
 *   void_invoice          "Void invoice…" (→ void)
 *   delete_draft          "Delete draft" (invoices.deleteInvoice)
 */

export const billingActionValidator = v.union(...BILLING_ACTIONS.map((a) => v.literal(a)));

/** What a preview acts on, resolved in the caller's org (references never re-resolve at commit). */
export const billingParamsValidator = v.object({
  projectId: v.optional(v.id("projects")),
  /** YYYY-MM-DD: a period action's period start (close) or a day inside it (reopen). */
  periodStart: v.optional(v.string()),
  invoiceId: v.optional(v.id("invoices")),
});
export type BillingParams = Infer<typeof billingParamsValidator>;

const invoiceDisplayStatusValidator = v.union(
  v.literal("draft"),
  v.literal("invoiced"),
  v.literal("past_due"),
  v.literal("paid"),
  v.literal("void"),
);

/** What a commit did: references and links only, never full records (docs/prd-mcp.md §6). */
export const billingCommitResultValidator = v.object({
  action: billingActionValidator,
  /** The app's label for what happened, e.g. "Create draft invoice". */
  outcome: v.string(),
  project: v.object({ id: v.id("projects"), code: v.string(), name: v.string() }),
  period: v.union(v.object({ start: v.string(), end: v.string(), label: v.string() }), v.null()),
  invoice: v.union(
    v.object({
      id: v.id("invoices"),
      /** "INV-042"; null while never numbered. */
      number: v.union(v.string(), v.null()),
      status: v.union(invoiceDisplayStatusValidator, v.literal("deleted")),
    }),
    v.null(),
  ),
  /** Entries settled (close) or made editable again (reopen, void, delete draft); null when none move. */
  entryCount: v.union(v.number(), v.null()),
});
export type BillingCommitResult = Infer<typeof billingCommitResultValidator>;

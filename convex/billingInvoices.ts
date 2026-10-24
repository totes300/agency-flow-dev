/**
 * Invoice draft mutations (docs/prd-billing-refactor.md §8.4, D5, D6):
 * fixed-fee invoices and the only edits a draft allows — line descriptions
 * and manual lines. Time and overage amounts are frozen at commit.
 * Status changes go through `invoices.changeInvoiceStatus`
 * (`lib/billing/invoiceLifecycle`).
 */

import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./lib/auth";
import { getOrgSettings } from "./lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "./lib/timer";
import { fromMinor, toMinor } from "./lib/billing/money";
import {
  fixedBilledMinor,
  manualLineAmountMinor,
  recomputeInvoiceTotals,
} from "./lib/billing/invoiceLifecycle";

/**
 * A fixed-fee invoice: one `fixed` line for `amount` (deposit, installment or
 * remainder; omitted = everything left). The draft's sidebar adjusts it.
 * Fixed-project entries are a work report only and never lock.
 */
export const createFixedInvoice = mutation({
  args: {
    projectId: v.id("projects"),
    amount: v.optional(v.number()), // decimal currency units, as typed
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId } = await requireAdmin(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found.");
    if (project.billingType !== "fixed") throw new ConvexError("Not a fixed-fee project.");
    const client = await ctx.db.get(project.clientId);
    if (!client || client.orgId !== orgId) throw new ConvexError("Client not found for project.");

    // A5 / B9: one draft at a time — a second "Create invoice" would draft
    // the same remainder again. The UI offers "Open draft" instead.
    const draft = await ctx.db
      .query("invoices")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .filter((q) => q.and(q.eq(q.field("orgId"), orgId), q.eq(q.field("status"), "draft")))
      .first();
    if (draft) {
      throw new ConvexError({
        code: "DRAFT_EXISTS",
        invoiceId: draft._id,
        message: "This project already has a draft invoice. Open it instead.",
      });
    }

    const currency = client.currency;
    const remainingMinor =
      toMinor(project.fixedPrice ?? 0, currency) - (await fixedBilledMinor(ctx, orgId, project._id));
    const amountMinor = args.amount !== undefined ? toMinor(args.amount, currency) : remainingMinor;
    if (amountMinor <= 0) {
      throw new ConvexError(
        args.amount !== undefined
          ? "Enter an amount greater than zero."
          : "This project's fixed fee is fully invoiced — there is nothing left to bill.",
      );
    }
    if (amountMinor > remainingMinor) {
      throw new ConvexError(
        `Only ${fromMinor(Math.max(0, remainingMinor), currency)} ${currency} of the fixed fee is left to bill.`,
      );
    }

    const orgSettings = await getOrgSettings(ctx, orgId);
    const issueDate = getDateInTimezone(Date.now(), orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK);
    const due = new Date(`${issueDate}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + (orgSettings?.defaultPaymentTermsDays ?? 30));
    const now = Date.now();
    const invoiceId = await ctx.db.insert("invoices", {
      orgId,
      projectId: project._id,
      clientId: project.clientId,
      prefix: orgSettings?.invoicePrefix ?? "INV-",
      subject: "Fixed fee",
      status: "draft",
      currency,
      subtotalMinor: amountMinor,
      totalMinor: amountMinor,
      issueDate,
      dueDate: due.toISOString().slice(0, 10),
      ...(orgSettings?.invoiceMessageTemplate ? { messageToClient: orgSettings.invoiceMessageTemplate } : {}),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId,
      sortOrder: 0,
      lineType: "fixed",
      description: args.description?.trim() || project.name,
      quantity: 1,
      unitPriceMinor: amountMinor,
      amountMinor,
      createdAt: now,
      updatedAt: now,
    });
    return { invoiceId };
  },
});

/** Load a line of a DRAFT invoice the caller's org owns. */
async function loadDraftLine(
  ctx: MutationCtx,
  orgId: string,
  lineId: Id<"invoiceLineItems">,
): Promise<{ line: Doc<"invoiceLineItems">; invoice: Doc<"invoices"> }> {
  const line = await ctx.db.get(lineId);
  if (!line || line.orgId !== orgId) throw new ConvexError("Line item not found.");
  const invoice = await ctx.db.get(line.invoiceId);
  if (!invoice || invoice.orgId !== orgId) throw new ConvexError("Invoice not found.");
  if (invoice.status !== "draft") throw new ConvexError("Only draft invoices can be edited.");
  return { line, invoice };
}

/** Rename any line on a draft (the only edit time and overage lines allow). */
export const setLineDescription = mutation({
  args: { lineId: v.id("invoiceLineItems"), description: v.string() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const { line } = await loadDraftLine(ctx, orgId, args.lineId);
    const description = args.description.trim();
    if (!description) throw new ConvexError("A line needs a description.");
    await ctx.db.patch(line._id, { description, updatedAt: Date.now() });
  },
});

export const addManualLine = mutation({
  args: { invoiceId: v.id("invoices"), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.orgId !== orgId) throw new ConvexError("Invoice not found.");
    if (invoice.status !== "draft") throw new ConvexError("Only draft invoices can be edited.");
    const lines = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
      .collect();
    const now = Date.now();
    const lineId = await ctx.db.insert("invoiceLineItems", {
      orgId,
      invoiceId: invoice._id,
      sortOrder: lines.reduce((max, li) => Math.max(max, li.sortOrder), -1) + 1,
      lineType: "manual",
      description: args.description?.trim() || "New line item",
      quantity: 1,
      unitPriceMinor: 0,
      amountMinor: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { lineId };
  },
});

/** Edit a manual line. Amount = quantity × unit price (a negative price is a discount). */
export const updateManualLine = mutation({
  args: {
    lineId: v.id("invoiceLineItems"),
    description: v.optional(v.string()),
    quantity: v.optional(v.number()),
    unitPrice: v.optional(v.number()), // decimal currency units, as typed
  },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const { line, invoice } = await loadDraftLine(ctx, orgId, args.lineId);
    if (line.lineType !== "manual") {
      throw new ConvexError("Only manual lines can be edited. Fix the time entries in Billing → Close instead.");
    }
    const quantity = args.quantity ?? line.quantity;
    const unitPriceMinor =
      args.unitPrice !== undefined ? toMinor(args.unitPrice, invoice.currency) : line.unitPriceMinor;
    const amountMinor = manualLineAmountMinor(quantity, unitPriceMinor);
    await ctx.db.patch(line._id, {
      ...(args.description !== undefined ? { description: args.description.trim() } : {}),
      quantity,
      unitPriceMinor,
      amountMinor,
      updatedAt: Date.now(),
    });
    await recomputeInvoiceTotals(ctx, invoice);
  },
});

export const removeManualLine = mutation({
  args: { lineId: v.id("invoiceLineItems") },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const { line, invoice } = await loadDraftLine(ctx, orgId, args.lineId);
    if (line.lineType !== "manual") {
      throw new ConvexError("Only manual lines can be removed. Skip the time in Billing → Close instead.");
    }
    await ctx.db.delete(line._id);
    await recomputeInvoiceTotals(ctx, invoice);
  },
});

/**
 * Set the amount of a fixed-fee draft's `fixed` line (deposit, installment,
 * remainder). Never beyond what is left of the sold fee; finalize re-checks.
 */
export const setFixedAmount = mutation({
  args: { lineId: v.id("invoiceLineItems"), amount: v.number() },
  handler: async (ctx, args) => {
    const { orgId } = await requireAdmin(ctx);
    const { line, invoice } = await loadDraftLine(ctx, orgId, args.lineId);
    if (line.lineType !== "fixed") throw new ConvexError("Not a fixed-fee line.");
    const project = await ctx.db.get(invoice.projectId);
    if (!project || project.orgId !== orgId) throw new ConvexError("Project not found.");
    const amountMinor = toMinor(args.amount, invoice.currency);
    if (amountMinor <= 0) throw new ConvexError("Enter an amount greater than zero.");
    const remainingMinor =
      toMinor(project.fixedPrice ?? 0, invoice.currency) -
      (await fixedBilledMinor(ctx, orgId, project._id));
    if (amountMinor > remainingMinor) {
      throw new ConvexError(
        `Only ${fromMinor(Math.max(0, remainingMinor), invoice.currency)} ${invoice.currency} of the fixed fee is left to bill.`,
      );
    }
    await ctx.db.patch(line._id, {
      unitPriceMinor: amountMinor,
      amountMinor,
      updatedAt: Date.now(),
    });
    await recomputeInvoiceTotals(ctx, invoice);
  },
});

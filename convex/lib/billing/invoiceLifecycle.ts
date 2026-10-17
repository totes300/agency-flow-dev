/**
 * The invoice lifecycle (docs/prd-billing-refactor.md §8.2) — the only code
 * that changes an invoice's status or deletes one.
 *
 *   draft → invoiced   number allocated (first time only), close → final
 *   invoiced → draft   number kept, close → draft (owner decision D3)
 *   → void             number kept, close released (entries reopen)
 *   invoiced ↔ paid    paidAt only
 *   delete draft       only if never numbered (N9); close released
 *
 * Money never changes here: lines were priced and frozen at commit (N7).
 * Every transition appends one billing event (N10).
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { getOrgSettings } from "../orgHelpers";
import { releaseClose } from "./closeLifecycle";
import { appendBillingEvent } from "./events";
import { fromMinor, roundHalfUp, toMinor } from "./money";

type Actor = { orgId: string; userId: Id<"users"> };
type InvoiceStatus = Doc<"invoices">["status"];
export type TransitionResult = { ok: true } | { ok: false; reason: string };

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["invoiced", "void"],
  invoiced: ["paid", "draft", "void"],
  paid: ["invoiced"],
  void: [],
};

/**
 * Claim the next number of the org's gapless series. Idempotent: an invoice
 * that already has a number (reverted, then re-finalized) keeps it.
 */
export async function allocateInvoiceNumber(
  ctx: MutationCtx,
  orgSettings: Doc<"orgSettings">,
  invoice: Doc<"invoices">,
): Promise<{ number: number; prefix: string } | null> {
  if (invoice.number != null) return null;
  const number = orgSettings.nextInvoiceNumber ?? 1;
  await ctx.db.patch(orgSettings._id, { nextInvoiceNumber: number + 1, updatedAt: Date.now() });
  return { number, prefix: orgSettings.invoicePrefix ?? invoice.prefix };
}

/** Σ minor amounts of a project's fixed-fee lines on finalized invoices. */
export async function fixedBilledMinor(
  ctx: MutationCtx,
  orgId: string,
  projectId: Id<"projects">,
): Promise<number> {
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .collect();
  let billed = 0;
  for (const inv of invoices) {
    if (inv.orgId !== orgId || (inv.status !== "invoiced" && inv.status !== "paid")) continue;
    const lines = await ctx.db
      .query("invoiceLineItems")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", inv._id))
      .collect();
    for (const li of lines) {
      if (li.lineType === "fixed") billed += li.amountMinor;
    }
  }
  return billed;
}

/** Re-sum an invoice from its lines (only manual and fixed lines ever change). */
export async function recomputeInvoiceTotals(
  ctx: MutationCtx,
  invoice: Doc<"invoices">,
): Promise<void> {
  const lines = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  const totalMinor = lines.reduce((sum, li) => sum + li.amountMinor, 0);
  await ctx.db.patch(invoice._id, {
    subtotalMinor: totalMinor,
    totalMinor,
    updatedAt: Date.now(),
  });
}

/** A manual line's amount: quantity × unit price, rounded once (negative = discount). */
export function manualLineAmountMinor(quantity: number, unitPriceMinor: number): number {
  return roundHalfUp(quantity * unitPriceMinor);
}

async function getClose(
  ctx: MutationCtx,
  orgId: string,
  invoice: Doc<"invoices">,
): Promise<Doc<"billingCloses"> | null> {
  if (!invoice.closeId) return null;
  const close = await ctx.db.get(invoice.closeId);
  return close && close.orgId === orgId ? close : null;
}

export async function transitionInvoice(
  ctx: MutationCtx,
  actor: Actor,
  invoice: Doc<"invoices">,
  newStatus: InvoiceStatus,
): Promise<TransitionResult> {
  const { orgId, userId } = actor;
  if (!VALID_TRANSITIONS[invoice.status].includes(newStatus)) {
    return { ok: false, reason: `Cannot transition from "${invoice.status}" to "${newStatus}".` };
  }
  const now = Date.now();
  const close = await getClose(ctx, orgId, invoice);
  const patch: Partial<Doc<"invoices">> = { status: newStatus, updatedAt: now };
  const event = { orgId, projectId: invoice.projectId, actorId: userId, invoiceId: invoice._id };

  if (invoice.status === "draft" && newStatus === "invoiced") {
    const orgSettings = await getOrgSettings(ctx, orgId);
    if (!orgSettings?.brandName?.trim()) {
      return {
        ok: false,
        reason:
          "Add your company details (Settings → General → Company details) " +
          "before issuing — an invoice needs a seller name.",
      };
    }
    const fixedCheck = await checkFixedRemainder(ctx, orgId, invoice);
    if (!fixedCheck.ok) return fixedCheck;
    const allocated = await allocateInvoiceNumber(ctx, orgSettings, invoice);
    if (allocated) Object.assign(patch, allocated);
    await ctx.db.patch(invoice._id, patch);
    if (close) await ctx.db.patch(close._id, { status: "final", finalizedAt: now });
    await appendBillingEvent(ctx, { ...event, type: "invoice_finalized", ...(close ? { closeId: close._id } : {}) });
    return { ok: true };
  }

  if (invoice.status === "invoiced" && newStatus === "draft") {
    await ctx.db.patch(invoice._id, patch);
    if (close) await ctx.db.patch(close._id, { status: "draft", finalizedAt: undefined });
    await appendBillingEvent(ctx, { ...event, type: "invoice_reverted", ...(close ? { closeId: close._id } : {}) });
    return { ok: true };
  }

  if (newStatus === "void") {
    await ctx.db.patch(invoice._id, patch);
    await appendBillingEvent(ctx, { ...event, type: "invoice_voided", ...(close ? { closeId: close._id } : {}) });
    if (close) await releaseClose(ctx, actor, close, "invoice_voided");
    return { ok: true };
  }

  // invoiced ↔ paid
  if (newStatus === "paid") patch.paidAt = now;
  else patch.paidAt = undefined;
  await ctx.db.patch(invoice._id, patch);
  await appendBillingEvent(ctx, { ...event, type: newStatus === "paid" ? "invoice_paid" : "invoice_unpaid" });
  return { ok: true };
}

/** A fixed-fee draft may not take the finalized series past the sold fee. */
async function checkFixedRemainder(
  ctx: MutationCtx,
  orgId: string,
  invoice: Doc<"invoices">,
): Promise<TransitionResult> {
  const project = await ctx.db.get(invoice.projectId);
  if (!project || project.orgId !== orgId || project.billingType !== "fixed") return { ok: true };
  const lines = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  const thisMinor = lines
    .filter((li) => li.lineType === "fixed")
    .reduce((sum, li) => sum + li.amountMinor, 0);
  const remaining =
    toMinor(project.fixedPrice ?? 0, invoice.currency) -
    (await fixedBilledMinor(ctx, orgId, project._id));
  if (thisMinor > remaining) {
    return {
      ok: false,
      reason:
        `The fixed-fee line (${fromMinor(thisMinor, invoice.currency)} ${invoice.currency}) exceeds the ` +
        `project's unbilled remainder (${fromMinor(remaining, invoice.currency)} ${invoice.currency}).`,
    };
  }
  return { ok: true };
}

/** Delete a never-numbered draft (N9) and release its close. */
export async function deleteDraftInvoice(
  ctx: MutationCtx,
  actor: Actor,
  invoice: Doc<"invoices">,
): Promise<void> {
  if (invoice.status !== "draft") {
    throw new ConvexError(
      "Only draft invoices can be deleted. Void a finalized invoice instead — " +
        "that keeps the numbered record and frees the period for re-billing.",
    );
  }
  if (invoice.number != null) {
    throw new ConvexError(
      "This draft already has an invoice number, so deleting it would leave a gap in the series. Void it instead.",
    );
  }
  const close = await getClose(ctx, actor.orgId, invoice);
  await appendBillingEvent(ctx, {
    orgId: actor.orgId,
    projectId: invoice.projectId,
    actorId: actor.userId,
    invoiceId: invoice._id,
    type: "draft_deleted",
    ...(close ? { closeId: close._id } : {}),
  });
  if (close) await releaseClose(ctx, actor, close, "draft_deleted");
  const lines = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  for (const li of lines) await ctx.db.delete(li._id);
  await ctx.db.delete(invoice._id);
}

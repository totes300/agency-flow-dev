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
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { getOrgSettings } from "../orgHelpers";
import { ORG_TIMEZONE_FALLBACK, getDateInTimezone } from "../timer";
import { releaseClose, type Actor } from "./closeLifecycle";
import { appendBillingEvent } from "./events";
import { fromMinor, roundHalfUp, toMinor } from "./money";

type InvoiceStatus = Doc<"invoices">["status"];
export type TransitionResult = { ok: true } | { ok: false; reason: string };

export const VALID_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["invoiced", "void"],
  invoiced: ["paid", "draft", "void"],
  paid: ["invoiced"],
  void: [],
};

/**
 * N9 / §5.4: voiding keeps a numbered record; a draft that never took a
 * number has none to keep, so it is deleted instead. Every status writer
 * (app mutations, MCP) refuses with this reason.
 */
export const NEVER_NUMBERED_VOID = "This draft was never numbered; delete it instead of voiding it.";

/**
 * The number finalizing `invoice` claims from the org's gapless series, or
 * null when it already has one (reverted, then re-finalized: it keeps it).
 * Reads only; `applyTransition` claims it.
 */
function nextInvoiceNumber(
  orgSettings: Doc<"orgSettings">,
  invoice: Doc<"invoices">,
): { orgSettingsId: Id<"orgSettings">; number: number; prefix: string } | null {
  if (invoice.number != null) return null;
  return {
    orgSettingsId: orgSettings._id,
    number: orgSettings.nextInvoiceNumber ?? 1,
    prefix: orgSettings.invoicePrefix ?? invoice.prefix,
  };
}

/** Σ minor amounts of a project's fixed-fee lines on finalized invoices. */
export async function fixedBilledMinor(
  ctx: QueryCtx,
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
  ctx: QueryCtx,
  orgId: string,
  invoice: Doc<"invoices">,
): Promise<Doc<"billingCloses"> | null> {
  if (!invoice.closeId) return null;
  const close = await ctx.db.get(invoice.closeId);
  return close && close.orgId === orgId ? close : null;
}

/**
 * What a status change does, computed without writing: the transition, the
 * close it moves (final / draft / released) and, on first finalize, the
 * number it claims. The app's mutations and the MCP preview (docs/prd-mcp.md
 * §9) both come from here.
 */
export type TransitionPlan = {
  invoice: Doc<"invoices">;
  newStatus: InvoiceStatus;
  close: Doc<"billingCloses"> | null;
  /** First finalize only: the number claimed from the org series. */
  allocate: { orgSettingsId: Id<"orgSettings">; number: number; prefix: string } | null;
};

/** Plans a status change with every rule `transitionInvoice` applies; reads only. */
export async function planTransition(
  ctx: QueryCtx,
  orgId: string,
  invoice: Doc<"invoices">,
  newStatus: InvoiceStatus,
): Promise<{ ok: true; plan: TransitionPlan } | { ok: false; reason: string }> {
  if (!VALID_TRANSITIONS[invoice.status].includes(newStatus)) {
    return { ok: false, reason: `Cannot transition from "${invoice.status}" to "${newStatus}".` };
  }
  if (newStatus === "void" && invoice.status === "draft" && invoice.number == null) {
    return { ok: false, reason: NEVER_NUMBERED_VOID };
  }
  const close = await getClose(ctx, orgId, invoice);
  let allocate: TransitionPlan["allocate"] = null;
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
    allocate = nextInvoiceNumber(orgSettings, invoice);
  }
  return { ok: true, plan: { invoice, newStatus, close, allocate } };
}

/** Writes a planned status change and its one billing event (N10). */
export async function applyTransition(
  ctx: MutationCtx,
  actor: Actor,
  plan: TransitionPlan,
): Promise<void> {
  const { orgId, userId } = actor;
  const { invoice, newStatus, close } = plan;
  const now = Date.now();
  const patch: Partial<Doc<"invoices">> = { status: newStatus, updatedAt: now };
  const event = { orgId, projectId: invoice.projectId, actorId: userId, via: actor.via, invoiceId: invoice._id };

  if (invoice.status === "draft" && newStatus === "invoiced") {
    if (plan.allocate) {
      const { orgSettingsId, number, prefix } = plan.allocate;
      await ctx.db.patch(orgSettingsId, { nextInvoiceNumber: number + 1, updatedAt: Date.now() });
      Object.assign(patch, { number, prefix });
    }
    await ctx.db.patch(invoice._id, patch);
    if (close) await ctx.db.patch(close._id, { status: "final", finalizedAt: now });
    await appendBillingEvent(ctx, { ...event, type: "invoice_finalized", ...(close ? { closeId: close._id } : {}) });
    return;
  }

  if (invoice.status === "invoiced" && newStatus === "draft") {
    await ctx.db.patch(invoice._id, patch);
    if (close) await ctx.db.patch(close._id, { status: "draft", finalizedAt: undefined });
    await appendBillingEvent(ctx, { ...event, type: "invoice_reverted", ...(close ? { closeId: close._id } : {}) });
    return;
  }

  if (newStatus === "void") {
    await ctx.db.patch(invoice._id, patch);
    await appendBillingEvent(ctx, { ...event, type: "invoice_voided", ...(close ? { closeId: close._id } : {}) });
    if (close) await releaseClose(ctx, actor, close, "invoice_voided");
    return;
  }

  // invoiced ↔ paid
  if (newStatus === "paid") patch.paidAt = now;
  else patch.paidAt = undefined;
  await ctx.db.patch(invoice._id, patch);
  await appendBillingEvent(ctx, { ...event, type: newStatus === "paid" ? "invoice_paid" : "invoice_unpaid" });
}

export async function transitionInvoice(
  ctx: MutationCtx,
  actor: Actor,
  invoice: Doc<"invoices">,
  newStatus: InvoiceStatus,
): Promise<TransitionResult> {
  const planned = await planTransition(ctx, actor.orgId, invoice, newStatus);
  if (!planned.ok) return planned;
  await applyTransition(ctx, actor, planned.plan);
  return { ok: true };
}

/** A fixed-fee draft may not take the finalized series past the sold fee. */
async function checkFixedRemainder(
  ctx: QueryCtx,
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

/** What deleting a never-numbered draft does, computed without writing. */
export type DeleteDraftPlan = {
  invoice: Doc<"invoices">;
  /** The close released with it (its entries reopen). */
  close: Doc<"billingCloses"> | null;
  lineIds: Id<"invoiceLineItems">[];
};

/** Plans deleting a draft with the rules of `deleteDraftInvoice` (N9); throws its errors, reads only. */
export async function planDeleteDraft(
  ctx: QueryCtx,
  orgId: string,
  invoice: Doc<"invoices">,
): Promise<DeleteDraftPlan> {
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
  const close = await getClose(ctx, orgId, invoice);
  const lines = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
    .collect();
  return { invoice, close, lineIds: lines.map((li) => li._id) };
}

/** Deletes a planned draft: one event, the close released, lines and invoice removed. */
export async function applyDeleteDraft(
  ctx: MutationCtx,
  actor: Actor,
  plan: DeleteDraftPlan,
): Promise<void> {
  const { invoice, close } = plan;
  await appendBillingEvent(ctx, {
    orgId: actor.orgId,
    projectId: invoice.projectId,
    actorId: actor.userId,
    via: actor.via,
    invoiceId: invoice._id,
    type: "draft_deleted",
    ...(close ? { closeId: close._id } : {}),
  });
  if (close) await releaseClose(ctx, actor, close, "draft_deleted");
  for (const id of plan.lineIds) await ctx.db.delete(id);
  await ctx.db.delete(invoice._id);
}

/** Delete a never-numbered draft (N9) and release its close. */
export async function deleteDraftInvoice(
  ctx: MutationCtx,
  actor: Actor,
  invoice: Doc<"invoices">,
): Promise<void> {
  await applyDeleteDraft(ctx, actor, await planDeleteDraft(ctx, actor.orgId, invoice));
}

/** A fixed-fee invoice, computed without writing: exactly what `applyFixedInvoice` inserts. */
export type FixedInvoicePlan = {
  project: Doc<"projects">;
  currency: string;
  /** The sold fee and what finalized invoices already billed of it (minor units). */
  feeMinor: number;
  billedMinor: number;
  /** This invoice's amount (minor units). */
  amountMinor: number;
  description: string;
  prefix: string;
  issueDate: string;
  dueDate: string;
  messageToClient?: string;
};

/**
 * Plans a fixed-fee invoice: one `fixed` line for `amount` (decimal currency
 * units as typed; omitted = everything left). Throws the app's errors
 * (A5 / B9: one draft at a time); reads only.
 */
export async function planFixedInvoice(
  ctx: QueryCtx,
  orgId: string,
  args: { projectId: Id<"projects">; amount?: number; description?: string },
): Promise<FixedInvoicePlan> {
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
  const feeMinor = toMinor(project.fixedPrice ?? 0, currency);
  const billedMinor = await fixedBilledMinor(ctx, orgId, project._id);
  const remainingMinor = feeMinor - billedMinor;
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
  return {
    project,
    currency,
    feeMinor,
    billedMinor,
    amountMinor,
    description: args.description?.trim() || project.name,
    prefix: orgSettings?.invoicePrefix ?? "INV-",
    issueDate,
    dueDate: due.toISOString().slice(0, 10),
    ...(orgSettings?.invoiceMessageTemplate ? { messageToClient: orgSettings.invoiceMessageTemplate } : {}),
  };
}

/** Inserts a planned fixed-fee draft and its one `fixed` line. Fixed-project entries never lock. */
export async function applyFixedInvoice(
  ctx: MutationCtx,
  actor: Actor,
  plan: FixedInvoicePlan,
): Promise<{ invoiceId: Id<"invoices"> }> {
  const { orgId, userId } = actor;
  const now = Date.now();
  const invoiceId = await ctx.db.insert("invoices", {
    orgId,
    projectId: plan.project._id,
    clientId: plan.project.clientId,
    prefix: plan.prefix,
    subject: "Fixed fee",
    status: "draft",
    currency: plan.currency,
    subtotalMinor: plan.amountMinor,
    totalMinor: plan.amountMinor,
    issueDate: plan.issueDate,
    dueDate: plan.dueDate,
    ...(plan.messageToClient ? { messageToClient: plan.messageToClient } : {}),
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  });
  await ctx.db.insert("invoiceLineItems", {
    orgId,
    invoiceId,
    sortOrder: 0,
    lineType: "fixed",
    description: plan.description,
    quantity: 1,
    unitPriceMinor: plan.amountMinor,
    amountMinor: plan.amountMinor,
    createdAt: now,
    updatedAt: now,
  });
  return { invoiceId };
}

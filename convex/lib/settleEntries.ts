/**
 * Settle / unsettle helpers for invoice-anchored time entries.
 *
 * Phase 8 Slice 1 — wraps the per-entry stamp/unstamp of `settledAt`,
 * `settledReason`, `settledPeriodStart/End` (and optionally clearing
 * `invoiceId`) so every invoice lifecycle transition has one canonical
 * implementation.
 *
 * Canonical-set invariant (parent PRD § Decisions):
 *
 *   The set of "entries settled by invoice X" is the union of the
 *   `timeEntryIds` arrays on `invoiceLineItems(invoiceId=X)`. An entry
 *   whose `invoiceId === X` but is not referenced by any line item is
 *   data drift — these helpers never write to such entries, so a stray
 *   record can't be "fixed" into the settled set by accident.
 *
 * Why walk line items instead of `timeEntries.by_invoiceId`?
 *   - No index on `timeEntries.invoiceId` exists, and adding one purely
 *     for this lookup would carry write cost on every entry mutation.
 *   - The line-item walk uses the existing `invoiceLineItems.by_invoiceId`
 *     index — same cost, no schema churn.
 *   - It enforces the canonical-set rule mechanically: a stray
 *     `invoiceId`-carrying entry simply doesn't appear in any line item
 *     and is therefore untouched.
 */

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";

export type SettledReason =
  | "invoiced"           // billed hourly — T&M direct or retainer overage line
  | "retainer_included"  // covered by retainer monthly fee (period-close, Slice 3)
  | "fixed_included";    // covered by fixed price (Fixed invoice settlement)

async function getEntriesForInvoice(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
): Promise<Doc<"timeEntries">[]> {
  const lineItems = await ctx.db
    .query("invoiceLineItems")
    .withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
    .collect();

  const out: Doc<"timeEntries">[] = [];
  for (const li of lineItems) {
    for (const entryId of li.timeEntryIds ?? []) {
      const e = await ctx.db.get(entryId);
      // Tenancy + canonical-set check. An entry that doesn't carry the
      // matching `invoiceId` is data drift — refuse to mutate it so the
      // bug stays visible instead of being silently "healed."
      if (e && e.orgId === orgId && e.invoiceId === invoiceId) {
        out.push(e);
      }
    }
  }
  return out;
}

/**
 * Stamp `settledAt` + reason + period snapshot on every entry currently
 * settled by this invoice.
 *
 * `reason` defaults to `"invoiced"` (T&M / retainer overage). Callers
 * settling Fixed-invoice entries pass `"fixed_included"`. Period-close
 * settlement (Slice 3) uses `closePeriod`'s own writer, not this helper.
 *
 * Idempotent — re-stamping an already-settled entry just refreshes its
 * timestamp and metadata. Returns the count of entries touched (zero
 * means the invoice had no line-item entry refs, expected for void or
 * already-cleared invoices).
 */
export async function settleInvoiceEntries(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
  periodStart?: string,
  periodEnd?: string,
  reason: SettledReason = "invoiced",
): Promise<number> {
  const entries = await getEntriesForInvoice(ctx, invoiceId, orgId);
  const now = Date.now();
  for (const e of entries) {
    await ctx.db.patch(e._id, {
      settledAt: now,
      settledReason: reason,
      settledPeriodStart: periodStart,
      settledPeriodEnd: periodEnd,
      updatedAt: now,
    });
  }
  return entries.length;
}

/**
 * Reverse `settleInvoiceEntries` — clear the four settlement fields on
 * every entry currently settled by this invoice. Optionally also clears
 * `invoiceId`.
 *
 * When to clear `invoiceId`:
 *   - `void` and `deleteInvoice` — entries should fall back to "open" and
 *     be eligible for a fresh invoice run.
 *
 * When to keep `invoiceId`:
 *   - `invoiced → draft` and `paid → draft` — the invoice still exists as
 *     a draft and still owns these entries; the entry display flips from
 *     "closed" back to "draft" (per `entryStatus()`).
 *
 * Returns the count of entries touched.
 */
export async function unsettleInvoiceEntries(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
  options: { clearInvoiceId?: boolean } = {},
): Promise<number> {
  const entries = await getEntriesForInvoice(ctx, invoiceId, orgId);
  const now = Date.now();
  for (const e of entries) {
    await ctx.db.patch(e._id, {
      settledAt: undefined,
      settledReason: undefined,
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      ...(options.clearInvoiceId ? { invoiceId: undefined } : {}),
      updatedAt: now,
    });
  }
  return entries.length;
}

// ─── Derived per-entry display status ───────────────────────────────────────

/**
 * Row-level display vocabulary. Collapses the three financial reasons
 * (`invoiced` / `retainer_included` / `fixed_included`) into a single
 * `closed` so the row badge stays one axis — the financial split lives in
 * the period drill-down (Slice 4) and reports, both of which read
 * `settledReason` directly.
 *
 * Note: a SETTLED non-billable entry still displays as `non_billable`,
 * not `closed` — billability is the more informative axis for that row.
 * The edit/delete guard keys on `settledAt`/`invoiceId` independently of
 * the badge, so the row is still locked.
 */
export type EntryDisplayStatus = "open" | "draft" | "closed" | "non_billable";

type EntryShape = {
  isBillable: boolean;
  invoiceId?: Id<"invoices">;
  settledAt?: number;
};

export function entryStatus(e: EntryShape): EntryDisplayStatus {
  if (!e.isBillable) return "non_billable";
  if (e.invoiceId && e.settledAt === undefined) return "draft";
  if (e.settledAt !== undefined) return "closed";
  return "open";
}

// ─── Backfill (one-shot) ────────────────────────────────────────────────────

/**
 * Walk every time entry and, for those linked to a finalized invoice
 * (`status ∈ {invoiced, paid}`) but missing `settledAt`, write the
 * settlement snapshot the new model expects:
 *
 *   - `settledAt`        = `invoice.issueDate` (parsed to ms) or `now`.
 *   - `settledReason`    = `"fixed_included"` for Fixed projects, else `"invoiced"`.
 *   - `settledPeriodStart/End` = the invoice's period.
 *
 * Idempotent: re-running is a no-op for already-settled rows because the
 * `settledAt === undefined` guard skips them. Safe to run multiple times.
 *
 * Project `billingType` lookups are cached so a project with N invoices
 * only triggers one `ctx.db.get(project)` call.
 *
 * Run once after deploy:
 *   npx convex run lib/settleEntries:backfillSettledFromInvoiceId
 *
 * Per [[project_mvp_dummy_data]], the dataset is dummy and no production
 * obligation exists. Backfill is for consistency so the new bucket fields
 * on `projectOverview` reflect history immediately, not just future
 * invoices.
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
      if (!billingType) {
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

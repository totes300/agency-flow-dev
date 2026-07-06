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

import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Settlement reason — single source of truth, consumed by BOTH:
 *   - the schema validator in `convex/schema.ts` (via `settledReasonValidator`)
 *   - the TypeScript code in this module + callers (via `SettledReason`)
 *
 * Adding a new reason (e.g. the deferred `"manual_close"` for the
 * project-completion flow) means editing this one place — TypeScript
 * inference propagates everywhere downstream.
 */
export const settledReasonValidator = v.union(
  v.literal("invoiced"),          // billed hourly — T&M direct or retainer overage line
  v.literal("retainer_included"), // covered by retainer monthly fee (period-close, Slice 3)
  v.literal("fixed_included"),    // covered by fixed price (Fixed invoice settlement)
);
export type SettledReason = Infer<typeof settledReasonValidator>;

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
    // Period-close settlement is MORE precise than invoice settlement and
    // must survive finalization: a `retainer_included` entry riding a cycle
    // overage invoice was covered by the monthly fee, not billed hourly —
    // re-stamping it "invoiced" would misclassify fee-covered hours as
    // rate-driven revenue in every report (2026-07-05 review F1/F7).
    if (e.settledReason === "retainer_included") continue;
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
  if (entries.length === 0) return 0;

  // Period-truth invariant (2026-07-05, deadlock fix follow-up): since
  // retainer invoices now carry `retainer_included` entries from
  // admin-closed months, releasing an invoice (delete draft / void /
  // revert) must NOT strip those months' period settlement — the period
  // row still has `closedAt`, and "closed period ⇒ its entries are
  // settled by the period" must survive the invoice's lifecycle. Entries
  // covered by a still-closed period are RE-STAMPED `retainer_included`
  // instead of cleared; everything else clears as before.
  const invoice = await ctx.db.get(invoiceId);
  let closedPeriods: Array<{ periodStart: string; periodEnd: string }> = [];
  if (invoice) {
    const project = await ctx.db.get(invoice.projectId);
    if (
      project &&
      project.orgId === orgId &&
      project.billingType === "retainer"
    ) {
      const periodRows = await ctx.db
        .query("retainerPeriods")
        .withIndex("by_projectId", (q) => q.eq("projectId", invoice.projectId))
        .collect();
      closedPeriods = periodRows.filter(
        (p) => p.orgId === orgId && p.closedAt !== undefined,
      );
    }
  }

  for (const e of entries) {
    const covering = closedPeriods.find(
      (p) => p.periodStart <= e.date && e.date <= p.periodEnd,
    );
    if (covering) {
      await ctx.db.patch(e._id, {
        settledAt: now,
        settledReason: "retainer_included" as const,
        settledPeriodStart: covering.periodStart,
        settledPeriodEnd: covering.periodEnd,
        ...(options.clearInvoiceId ? { invoiceId: undefined } : {}),
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(e._id, {
        settledAt: undefined,
        settledReason: undefined,
        settledPeriodStart: undefined,
        settledPeriodEnd: undefined,
        ...(options.clearInvoiceId ? { invoiceId: undefined } : {}),
        updatedAt: now,
      });
    }
  }
  return entries.length;
}

// ─── Derived per-entry display status ───────────────────────────────────────
//
// Moved to `convex/lib/entryStatus.ts` in Slice 4 so client components can
// import the derivation without pulling this file's `internalMutation`
// runtime symbol into the browser bundle. Re-exported here for any existing
// server-side callers that already import from this module.
export {
  entryStatus,
  type EntryDisplayStatus,
  type EntryShape,
} from "./entryStatus";

// ─── projectOverview bucket classifier ─────────────────────────────────────

/**
 * Bucket vocabulary used by `projectOverview` to aggregate per-entry
 * minutes/amounts. Mirrors `entryStatus()` but splits the `closed` bucket
 * by `settledReason` so reports can distinguish revenue ("invoiced") from
 * coverage ("settled"). Non-billable entries are excluded from the
 * billable rollup entirely (the caller tracks them via
 * `totalNonBillableMinutes`).
 *
 *   open      → !invoiceId && !settledAt           (needs billing/closure)
 *   draft     → invoiceId set, settledAt unset     (reserved by a draft)
 *   invoiced  → settledReason === "invoiced"        (revenue, billed hourly)
 *   settled   → settledReason ∈ {retainer_included, (covered, no revenue)
 *                                fixed_included}
 */
export type OverviewBucket = "open" | "draft" | "invoiced" | "settled";

type BillableBucketInput = {
  invoiceId?: Id<"invoices">;
  settledAt?: number;
  settledReason?: SettledReason;
};

export function billableOverviewBucket(e: BillableBucketInput): OverviewBucket {
  if (e.settledReason === "invoiced") return "invoiced";
  if (e.settledReason !== undefined) return "settled";
  if (e.invoiceId !== undefined) return "draft";
  return "open";
}

// The one-shot `backfillSettledFromInvoiceId` deployed mutation lives at
// `convex/settleEntries.ts` (top-level). `lib/` is helpers-only — keeping
// the deployment-target separate keeps the file boundary honest.

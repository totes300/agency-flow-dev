/**
 * Settle / unsettle helpers for invoice-anchored time entries.
 *
 * Phase 8 Slice 1 — wraps the per-entry stamp/unstamp of `settledAt`,
 * `settledReason`, `settledPeriodStart/End` (and optionally clearing
 * `invoiceId`) so every invoice lifecycle transition has one canonical
 * implementation.
 *
 * ── Stamp invariant (2026-07-19) ────────────────────────────────────────────
 *
 *   `settledPeriodStart/End` is the entry's MONTHLY settlement bucket —
 *   always exactly one calendar month — never the settling document's period.
 *   The document's period lives on the invoice itself (reachable via the
 *   entry's `invoiceId`); the entry-level stamp carries the one fact that is
 *   NOT recoverable elsewhere after commit: which month's ledger this hour
 *   belongs to. Bucket rule (`monthlySettlementPeriod`): the entry's natural
 *   month, clamped into the settling period — a carried-in entry (dated
 *   before the period) buckets into the period's FIRST month, the
 *   receiving-period rule of `billingScope` (PRD § Scope and money).
 *
 *   Writers that must conform: `closePeriodInternal` (monthly by
 *   construction), `closeRetainerCycle` (via this bucket rule),
 *   `settleInvoiceEntries` below (via this bucket rule), and the one-shot
 *   backfill in `convex/settleEntries.ts`. Readers may therefore stay dumb:
 *   `computeReportMonths` maps a stamp to its month with `slice(0, 7)`, the
 *   settled-period worksheet matches on `settledPeriodStart` equality, and
 *   `billingScope.collectSettledScope` range-checks stamps against the
 *   target period — all valid ONLY while every stamp spans one month.
 *
 *   History: before 2026-07-19, cycle-invoice finalization stamped the whole
 *   CYCLE range, collapsing all N months into month 1 on reports/worksheets
 *   (verification finding F3). Entries finalized before the fix keep their
 *   cycle-wide stamps — per [[project_mvp_dummy_data]] the dataset is dummy
 *   and a reseed supersedes a backfill; a real deployment would need one.
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
/**
 * The monthly settlement bucket for an entry settled into a (possibly
 * multi-month) period — THE stamp-invariant rule, shared by every writer.
 *
 * Natural month of the entry date, clamped into `[periodStart, periodEnd]`:
 *   - date inside the period → its own calendar month;
 *   - date before the period (carried-in: skipped or logged-late) → the
 *     period's FIRST month, mirroring `billingScope`'s receiving-period
 *     bucketing (`usageByMonth`) and `closeRetainerCycle`'s grouping;
 *   - date after the period → the period's LAST month (defensive — scope
 *     never yields such an entry).
 *
 * Bucket bounds are always full calendar months, even when the settling
 * period itself has ragged edges (an ad-hoc T&M invoice's min/max-date
 * period): readers match stamps by month, so the stamp must be the month.
 */
export function monthlySettlementPeriod(
  entryDate: string,
  period: { periodStart: string; periodEnd: string },
): { periodStart: string; periodEnd: string } {
  const clamped =
    entryDate < period.periodStart
      ? period.periodStart
      : entryDate > period.periodEnd
        ? period.periodEnd
        : entryDate;
  const year = Number(clamped.slice(0, 4));
  const month = Number(clamped.slice(5, 7)); // 1-12
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const key = clamped.slice(0, 7);
  return {
    periodStart: `${key}-01`,
    periodEnd: `${key}-${String(lastDay).padStart(2, "0")}`,
  };
}

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
 * `periodStart/End` is the INVOICE's period; per the stamp invariant above,
 * each entry is stamped with its `monthlySettlementPeriod` bucket within it —
 * for single-month invoices that is the invoice period itself, for cycle /
 * multi-month invoices it is the entry's own month (carried-in → first
 * month). Before 2026-07-19 the raw invoice period was stamped verbatim,
 * which collapsed invoiced cycles into their first month on every
 * stamp-reader (finding F3).
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
    const bucket =
      periodStart !== undefined && periodEnd !== undefined
        ? monthlySettlementPeriod(e.date, { periodStart, periodEnd })
        : { periodStart: undefined, periodEnd: undefined };
    await ctx.db.patch(e._id, {
      settledAt: now,
      settledReason: reason,
      settledPeriodStart: bucket.periodStart,
      settledPeriodEnd: bucket.periodEnd,
      updatedAt: now,
    });
  }

  const companions = await settleRetainerNonBillableCompanions(
    ctx,
    invoiceId,
    orgId,
    periodStart,
    periodEnd,
    now,
  );
  return entries.length + companions;
}

/**
 * F4 (2026-07-19) — finalizing a RETAINER invoice also settles the period's
 * in-scope NON-BILLABLE entries as `retainer_included` (monthly bucket).
 *
 * Why: invariant I2 promises non-billable entries are settled by retainer
 * closes. That held for within-budget periods (`closePeriod` settles them) but
 * an over-budget period exits only via the overage invoice, whose line items
 * carry billable entries only — its non-billable hours stayed open forever,
 * carried into every later close as `logged-late`, and rendered on the WRONG
 * month's client report. This companion pass closes that gap at the same
 * moment billable entries settle.
 *
 * Membership mirrors what `billingScope` had in scope at DRAFT CREATION (the
 * commit moment): open + non-billable + dated on/before the period end +
 * not skipped OUT of this period (`skippedThrough < periodEnd` keeps
 * earlier-period skips, i.e. carried-in work) + existed when the draft was
 * created (an entry logged later is, per I1, already next period's
 * logged-late work — the live report preview showed it there, and settling it
 * here would contradict that). Reversal lives in `unsettleInvoiceEntries`.
 */
async function settleRetainerNonBillableCompanions(
  ctx: MutationCtx,
  invoiceId: Id<"invoices">,
  orgId: string,
  periodStart: string | undefined,
  periodEnd: string | undefined,
  now: number,
): Promise<number> {
  if (periodStart === undefined || periodEnd === undefined) return 0;
  const invoice = await ctx.db.get(invoiceId);
  if (!invoice || invoice.orgId !== orgId) return 0;
  const project = await ctx.db.get(invoice.projectId);
  if (!project || project.orgId !== orgId) return 0;
  if (project.billingType !== "retainer") return 0;

  const tasks = await ctx.db
    .query("tasks")
    .withIndex("by_orgId_projectId", (q) =>
      q.eq("orgId", orgId).eq("projectId", invoice.projectId),
    )
    .collect();

  let settled = 0;
  for (const task of tasks) {
    const taskEntries = await ctx.db
      .query("timeEntries")
      .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
      .collect();
    for (const e of taskEntries) {
      if (e.orgId !== orgId) continue;
      if (e.isBillable) continue;
      if (e.invoiceId !== undefined || e.settledAt !== undefined) continue;
      if (e.date > periodEnd) continue;
      if (e.skippedThrough !== undefined && e.skippedThrough >= periodEnd) {
        continue; // skipped out of this (or a later) period
      }
      if (e.createdAt >= invoice.createdAt) continue; // post-commit entry → next close
      const bucket = monthlySettlementPeriod(e.date, { periodStart, periodEnd });
      await ctx.db.patch(e._id, {
        settledAt: now,
        settledReason: "retainer_included",
        settledPeriodStart: bucket.periodStart,
        settledPeriodEnd: bucket.periodEnd,
        updatedAt: now,
      });
      settled++;
    }
  }
  return settled;
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
  // No early return on an empty line-item set: a retainer invoice may still
  // own settled non-billable companions (F4) that must be released below.

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

  // F4 reversal — release the non-billable companions this invoice's
  // finalization settled (see `settleRetainerNonBillableCompanions`). They
  // carry no `invoiceId` and appear on no line item, so the walk above never
  // sees them. Identification: non-billable + `retainer_included` + no
  // invoice link + stamped inside the invoice's period. The same
  // covering-closed-period branch applies: an entry whose month is still
  // admin-closed keeps its settlement (period truth outlives the invoice);
  // everything else reopens.
  if (
    invoice &&
    invoice.periodStart !== undefined &&
    invoice.periodEnd !== undefined
  ) {
    const project = await ctx.db.get(invoice.projectId);
    if (project && project.orgId === orgId && project.billingType === "retainer") {
      const tasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_projectId", (q) =>
          q.eq("orgId", orgId).eq("projectId", invoice.projectId),
        )
        .collect();
      for (const task of tasks) {
        const taskEntries = await ctx.db
          .query("timeEntries")
          .withIndex("by_taskId", (q) => q.eq("taskId", task._id))
          .collect();
        for (const e of taskEntries) {
          if (e.orgId !== orgId) continue;
          if (e.isBillable) continue;
          if (e.invoiceId !== undefined) continue;
          if (e.settledAt === undefined) continue;
          if (e.settledReason !== "retainer_included") continue;
          if (
            e.settledPeriodStart === undefined ||
            e.settledPeriodEnd === undefined ||
            e.settledPeriodStart < invoice.periodStart ||
            e.settledPeriodEnd > invoice.periodEnd
          ) {
            continue;
          }
          const covering = closedPeriods.find(
            (p) => p.periodStart <= e.date && e.date <= p.periodEnd,
          );
          if (covering) continue; // still owned by an admin-closed period
          await ctx.db.patch(e._id, {
            settledAt: undefined,
            settledReason: undefined,
            settledPeriodStart: undefined,
            settledPeriodEnd: undefined,
            updatedAt: now,
          });
        }
      }
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

// The one-shot `backfillSettledFromInvoiceId` deployed mutation lives at
// `convex/settleEntries.ts` (top-level). `lib/` is helpers-only — keeping
// the deployment-target separate keeps the file boundary honest.

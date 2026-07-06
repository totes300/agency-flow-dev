/**
 * Phase 8 Slice 3 — closed-retainer-period write guard.
 *
 * The settlement guards on `timeEntries.update` / `timeEntries.remove`
 * (Slice 1) block editing an already-settled entry. This module is the
 * COMPLEMENTARY guard for the *creation* / *date-move* paths: it rejects
 * inserting (or moving) an entry whose `date` falls inside a closed
 * retainer period.
 *
 * Why scoped to retainer-only (Revision Pass #3b):
 *   The T&M / Fixed "covered by finalized invoice" arm was considered and
 *   intentionally NOT built. In this codebase, an invoice total is a frozen
 *   line-item snapshot — a later backdated T&M/Fixed entry does NOT retro-
 *   add to it. The entry simply rolls onto the next invoice. The only
 *   forbidden write is into a closed retainer period (where the report has
 *   already been delivered with `retainer_included` settlements stamped).
 *
 * Why three call sites (Revision Pass #3a):
 *   Time entries land via THREE write paths — not the one the original PRD
 *   draft assumed. A guard on `timeEntries.create` alone is bypassed by
 *   `timer.commitEntry` and by `timeEntries.update` when `date` or `task`
 *   changes (a task swap can move the entry to a different project, and an
 *   admin edit can change the date itself). Extract once, call from all
 *   three.
 */

import { ConvexError } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "../_generated/dataModel";

type AnyMutationCtx = GenericMutationCtx<DataModel>;

/**
 * Reject the caller if `date` falls inside a settled retainer scope on
 * `project` — either a CLOSED period (admin close) or a period covered by
 * a FINALIZED (invoiced/paid) retainer invoice. No-op for non-retainer
 * projects. Throws `ConvexError` with the unblock-path hint baked in so
 * the user knows how to recover.
 *
 * Closed arm matches the parent PRD § Mutations code sample verbatim:
 * single index walk on `retainerPeriods.by_projectId_periodStart`, in-DB
 * filter on the date range AND `closedAt !== undefined`.
 */
export async function assertEntryDateOpen(
  ctx: AnyMutationCtx,
  project: Doc<"projects">,
  date: string,
): Promise<void> {
  const blocker = await findEntryDateBlocker(ctx, project, date);
  if (blocker) throw new ConvexError(blocker);
}

/**
 * Non-throwing form of the guard: returns the human-readable rejection
 * message when `date` falls in a settled scope, `null` when the write is
 * allowed. The timer stop path needs this to FALL BACK (file the entry
 * under today) instead of stranding a stop that crossed midnight into a
 * just-settled day.
 */
export async function findEntryDateBlocker(
  ctx: AnyMutationCtx,
  project: Doc<"projects">,
  date: string,
): Promise<string | null> {
  if (project.billingType !== "retainer") return null;

  const closedPeriod = await ctx.db
    .query("retainerPeriods")
    .withIndex("by_projectId_periodStart", (q) =>
      q.eq("projectId", project._id),
    )
    .filter((q) =>
      q.and(
        q.lte(q.field("periodStart"), date),
        q.gte(q.field("periodEnd"), date),
        q.neq(q.field("closedAt"), undefined),
      ),
    )
    .first();

  if (closedPeriod) {
    return "Cannot log time in a closed retainer period. Reopen the period first.";
  }

  // Finalized-invoice arm (2026-07-05, review finding "stranded entries"):
  // a finalized overage invoice covers its period but leaves no `closedAt`
  // row — and the period can never be closed afterwards (the invoice blocks
  // close). A backdated entry into such a period used to be ACCEPTED and
  // then became unreachable forever: skipped by the overage recompute,
  // deduped out of the ready feed, blocked from re-generation. Silent
  // revenue leak. Invoiced = settled — same rule as closed. Drafts don't
  // block (the stale-draft refresh flow owns that case); voids don't block
  // (the period is re-billable).
  const projectInvoices = await ctx.db
    .query("invoices")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .filter((q) => q.eq(q.field("orgId"), project.orgId))
    .collect();
  const coveringInvoice = pickCoveringFinalizedInvoice(projectInvoices, date);
  if (coveringInvoice) {
    const label =
      coveringInvoice.number != null
        ? `${coveringInvoice.prefix}${String(coveringInvoice.number).padStart(3, "0")}`
        : "an invoice";
    return `This period is already invoiced (${label}). Pick a date outside the period, or void that invoice to log time here.`;
  }

  return null;
}

// ─── Pure predicate (unit-testable) ─────────────────────────────────────────
//
// The DB-backed `assertEntryDateOpen` above is a thin wrapper over this
// predicate. The repo's test setup doesn't ship `convex-test`, so we
// validate the date-coverage rule via the extracted predicate the same way
// `markPaid.ts`'s `classifyMarkPaid` is tested. Keeping the predicate
// separate also documents the rule precisely: "a closed retainer period
// covers date D iff periodStart ≤ D ≤ periodEnd AND closedAt is set."

export type PeriodLike = {
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  closedAt: number | undefined;
};

/**
 * Return the first period that BOTH covers `date` (inclusive boundary)
 * AND is admin-closed. Returns `null` when no such row exists — i.e. the
 * write is allowed.
 *
 * Pure — caller is responsible for pre-narrowing `periods` to the project
 * and for the non-retainer short-circuit (which `assertEntryDateOpen`
 * does). This keeps the predicate trivial to test exhaustively.
 */
export function pickClosedCoveringPeriod<T extends PeriodLike>(
  periods: readonly T[],
  date: string,
): T | null {
  for (const p of periods) {
    if (p.closedAt === undefined) continue;
    if (p.periodStart <= date && date <= p.periodEnd) return p;
  }
  return null;
}

// ─── Finalized-invoice coverage predicate (unit-testable) ────────────────────

export type InvoicePeriodLike = {
  status: "draft" | "invoiced" | "paid" | "void";
  periodStart?: string; // YYYY-MM-DD
  periodEnd?: string;   // YYYY-MM-DD
  prefix: string;
  number?: number | null;
};

/**
 * Return the first FINALIZED (invoiced/paid) invoice whose period covers
 * `date` (inclusive boundaries). Drafts and voids never match; invoices
 * without a stored period never match. `null` = the write is allowed.
 *
 * Pure — caller pre-narrows `invoices` to the project (and the retainer
 * short-circuit lives in `assertEntryDateOpen`).
 */
export function pickCoveringFinalizedInvoice<T extends InvoicePeriodLike>(
  invoices: readonly T[],
  date: string,
): T | null {
  for (const inv of invoices) {
    if (inv.status !== "invoiced" && inv.status !== "paid") continue;
    if (!inv.periodStart || !inv.periodEnd) continue;
    if (inv.periodStart <= date && date <= inv.periodEnd) return inv;
  }
  return null;
}

/**
 * Pure helpers for `createInvoice` — resume-existing-draft semantics,
 * auto-Paid €0 retainer detection, and template message seeding.
 *
 * Extracted to keep the mutation slim and unit-testable without convex-test.
 */

import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";

/**
 * The exact user-facing message thrown when a retainer period has no overage
 * to bill. Re-exported as a const so the UI tests + Generate-invoice button
 * gate can match against the same string.
 */
export const NO_OVERAGE_MESSAGE =
  "This period has no overage. Download the monthly report instead.";

/**
 * The exact user-facing message thrown when `createInvoice` is called for a
 * non-cycle-end month on a rollover-ON retainer project. Cycle invoices
 * cover the entire cycle in one row; mid-cycle months never bill.
 */
export const NOT_CYCLE_END_MESSAGE =
  "Retainer cycle invoices can only be created for the cycle's closing month.";

/**
 * Bouncer for the retainer branch of `createInvoice`. Throws when the
 * computed balance shows no overage — within-budget periods produce a
 * Monthly Report, never an invoice (D3 in `docs/invoicing-refactor.md`).
 *
 * Pure: takes the result of `computeRetainerBalance` and throws or returns
 * void. Lives next to `findResumableInvoice` so all the createInvoice
 * pure-helper branching has one home.
 */
export function assertRetainerInvoiceable(opts: {
  isOverageDue: boolean;
}): void {
  if (!opts.isOverageDue) {
    throw new ConvexError(NO_OVERAGE_MESSAGE);
  }
}

/**
 * Bouncer for rollover-ON retainer cycles: `createInvoice` only accepts the
 * cycle's closing month. Mid-cycle months throw with a fixed message that
 * the UI can match.
 *
 * `cyclePosition` is 0-indexed; the closing month is `cycleLength - 1`.
 */
export function assertRolloverCycleEnd(opts: {
  rolloverEnabled: boolean;
  cyclePosition: number;
  cycleLength: number;
}): void {
  if (!opts.rolloverEnabled) return;
  if (opts.cyclePosition !== opts.cycleLength - 1) {
    throw new ConvexError(NOT_CYCLE_END_MESSAGE);
  }
}

/**
 * Structural subset of an invoice document that the resume-check needs.
 * Real callers pass `Doc<"invoices">[]`; the generic preserves the doc shape
 * on the way out so the mutation can read prefix/number from the resumed
 * invoice without re-fetching.
 */
export type InvoiceLike = {
  _id: Id<"invoices">;
  _creationTime: number;
  orgId: string;
  status: "draft" | "invoiced" | "paid" | "void";
  periodStart?: string;
  periodEnd?: string;
};

export type ResumeMatch<T extends InvoiceLike> =
  | { kind: "resume-draft"; invoice: T }
  | { kind: "blocked-duplicate"; invoice: T }
  | { kind: "none" };

/**
 * Pick the deterministic match from a candidate list — earliest by
 * `_creationTime`. The UI never produces 2+ drafts on the same key, but a
 * race / migration / manual import could; falling back to "first by memory
 * order" is non-deterministic, so we sort.
 */
function pickEarliest<T extends InvoiceLike>(candidates: T[]): T | undefined {
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => a._creationTime - b._creationTime)[0];
}

/**
 * Find an existing invoice on this project that should either be resumed
 * (returned from `createInvoice` as-is) or block creation as a duplicate.
 *
 *  - billingType "fixed":     match any draft on the project (no period concept).
 *  - billingType "t_and_m":   match a draft whose period equals the requested
 *                              period. When the requested period is missing
 *                              ("All uninvoiced" preset, Path A), match any
 *                              draft on the project — same semantics as Fixed.
 *                              Path B (timeEntryIds) cannot collide with a
 *                              draft because already-invoiced entries are
 *                              rejected upstream.
 *  - billingType "retainer":  match any non-void invoice whose period equals
 *                              the requested month. Draft → resume; invoiced/paid
 *                              → block (legacy "already exists" rule).
 *
 * Tenancy: caller has already filtered to invoices on this project; we still
 * narrow by orgId defensively (CLAUDE.md). Multi-match resolution is
 * deterministic (earliest `_creationTime` wins).
 */
export function findResumableInvoice<T extends InvoiceLike>(
  candidates: T[],
  opts: {
    orgId: string;
    billingType: "t_and_m" | "fixed" | "retainer";
    requestedPeriodStart?: string;
    requestedPeriodEnd?: string;
  },
): ResumeMatch<T> {
  const sameOrg = candidates.filter((inv) => inv.orgId === opts.orgId);

  // Fixed and T&M-without-period both key on "any draft on the project".
  // T&M's "All uninvoiced" preset (no startDate/endDate) must resume an
  // existing draft, otherwise the next call hits the "no uninvoiced entries"
  // guard (entries are stamped to that draft) and throws.
  const wantAnyDraft =
    opts.billingType === "fixed" ||
    (opts.billingType === "t_and_m" &&
      (!opts.requestedPeriodStart || !opts.requestedPeriodEnd));
  if (wantAnyDraft) {
    const draft = pickEarliest(sameOrg.filter((inv) => inv.status === "draft"));
    return draft ? { kind: "resume-draft", invoice: draft } : { kind: "none" };
  }

  // Period-keyed match (T&M with explicit period, Retainer with month).
  const periodMatches = sameOrg.filter(
    (inv) =>
      inv.periodStart === opts.requestedPeriodStart &&
      inv.periodEnd === opts.requestedPeriodEnd,
  );

  if (opts.billingType === "t_and_m") {
    // Period-keyed match for T&M is intentional per PRD § US-43: "when a
    // draft already exists for the period I clicked, ... open that draft
    // directly". Two consecutive Custom-range generations with DIFFERENT
    // ranges (e.g. Mar 1–15 then Mar 16–31) will therefore produce two
    // separate drafts on the same project — each holding its own slice of
    // entries, no double-billing. This is a deliberate trade against the
    // alternative (resume any T&M draft regardless of period), which would
    // make custom-range generation a no-op once a draft exists.
    const draft = pickEarliest(periodMatches.filter((inv) => inv.status === "draft"));
    return draft ? { kind: "resume-draft", invoice: draft } : { kind: "none" };
  }

  // retainer
  const live = pickEarliest(periodMatches.filter((inv) => inv.status !== "void"));
  if (!live) return { kind: "none" };
  if (live.status === "draft") return { kind: "resume-draft", invoice: live };
  return { kind: "blocked-duplicate", invoice: live };
}

/**
 * Gate for editing `messageToClient` post-creation. Draft only — once an
 * invoice is finalized, voided, or marked paid the message is locked.
 *
 * The previous "€0 auto-Paid retainer stays editable" carve-out died with
 * the invoicing refactor (`docs/invoicing-refactor.md` D3): retainer
 * invoices can no longer be created with `total === 0` because
 * `assertRetainerInvoiceable` rejects within-budget periods at creation.
 * The carve-out's only path was unreachable.
 */
export function canEditInvoiceMessage(invoice: {
  status: "draft" | "invoiced" | "paid" | "void";
}): boolean {
  return invoice.status === "draft";
}

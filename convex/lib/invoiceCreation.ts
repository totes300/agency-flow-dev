/**
 * Pure helpers for `createInvoice` — resume-existing-draft semantics,
 * auto-Paid €0 retainer detection, and template message seeding.
 *
 * Extracted to keep the mutation slim and unit-testable without convex-test.
 */

import type { Id } from "../_generated/dataModel";

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
 * Gate for editing `messageToClient` post-creation.
 *  - Draft: editable.
 *  - €0 auto-Paid retainer (status=paid, total=0, type=retainer): editable
 *    indefinitely (PRD § 39 — invoice was never sent to the client).
 *  - Money-due Invoiced/Paid: locked.
 *  - Void: locked.
 */
export function canEditInvoiceMessage(invoice: {
  status: "draft" | "invoiced" | "paid" | "void";
  total: number;
}, project: { billingType: "t_and_m" | "fixed" | "retainer" | "non_billable" }): boolean {
  if (invoice.status === "draft") return true;
  if (
    invoice.status === "paid" &&
    invoice.total === 0 &&
    project.billingType === "retainer"
  ) {
    return true;
  }
  return false;
}

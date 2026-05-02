/**
 * Pure decision helpers for `markInvoicesPaid` / `undoMarkInvoicesPaid`.
 *
 * Extracted so the per-row outcomes can be unit-tested without spinning up
 * convex-test. The mutation handlers are thin wrappers that:
 *   1. Fetch + tenancy-check each invoice doc.
 *   2. Hand the doc shape to one of these classifiers.
 *   3. Apply the patch the classifier returned (if any), accumulate skips.
 */

import type { Id } from "../_generated/dataModel";

export type InvoiceStatus = "draft" | "invoiced" | "paid" | "void";

/**
 * Subset of the invoice doc the helpers care about. Lets tests construct
 * fixtures without paying for the full schema.
 */
export type InvoiceState = {
  status: InvoiceStatus;
  paidAt?: number;
};

/** Snapshot returned by `markInvoicesPaid` and consumed by undo. */
export type PriorState = {
  id: Id<"invoices">;
  status: InvoiceStatus;
  paidAt: number | null;
};

// ─── Mark paid ──────────────────────────────────────────────────────────────────

export type MarkOutcome =
  | { kind: "patch"; setPaidAt: number; prior: { status: InvoiceStatus; paidAt: number | null } }
  | { kind: "noop"; prior: { status: InvoiceStatus; paidAt: number | null } }
  | { kind: "skip"; reason: string };

/**
 * Classify a single invoice's mark-paid outcome.
 *
 *  - already `paid`           → `noop` (idempotent — counted in `updated`,
 *                                 priorState still snapshotted so the same
 *                                 undo call would gracefully no-op).
 *  - `invoiced`               → `patch` (set status=paid, paidAt=now).
 *  - `draft` or `void`        → `skip` ("Cannot mark draft/void as paid").
 *
 * The Inbox surfaces only overdue (status="invoiced", dueDate<today) rows,
 * so the skip path is defensive — protects against stale UI state where a
 * row was deleted or voided in another tab between render and click.
 */
export function classifyMarkPaid(
  current: InvoiceState,
  now: number,
): MarkOutcome {
  const prior = {
    status: current.status,
    paidAt: current.paidAt ?? null,
  } as const;
  if (current.status === "paid") {
    return { kind: "noop", prior };
  }
  if (current.status === "invoiced") {
    return { kind: "patch", setPaidAt: now, prior };
  }
  return {
    kind: "skip",
    reason:
      current.status === "draft"
        ? "Cannot mark a draft as paid."
        : "Cannot mark a voided invoice as paid.",
  };
}

// ─── Undo ───────────────────────────────────────────────────────────────────────

export type UndoOutcome =
  | { kind: "revert"; setStatus: InvoiceStatus; setPaidAt: number | null }
  | { kind: "skip"; reason: string };

/**
 * Classify a single invoice's undo outcome.
 *
 *   current.status === "paid"  → revert to snapshot (status, paidAt).
 *   anything else              → skip ("modified by another user").
 *
 * The "still paid" check is the conflict guard required by the issue: if
 * another admin transitioned the invoice during our undo window (e.g. voided
 * it), we never silently overwrite their edit. They become a `skipped` row
 * in the toast.
 *
 * Already-paid prior states (idempotent mark) revert from paid→paid with the
 * snapshot's paidAt — net effect is a no-op when the snapshot's paidAt
 * matches the doc's current paidAt, or a paidAt restoration when it doesn't
 * (last-write wins, consistent with the mark mutation).
 */
export function classifyUndo(
  current: InvoiceState,
  snapshot: { status: InvoiceStatus; paidAt: number | null },
): UndoOutcome {
  if (current.status !== "paid") {
    return {
      kind: "skip",
      reason: "Invoice was modified by another user.",
    };
  }
  return {
    kind: "revert",
    setStatus: snapshot.status,
    setPaidAt: snapshot.paidAt,
  };
}

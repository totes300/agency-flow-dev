/**
 * Single source of truth for "what action does a Monthly Breakdown row
 * carry?" — drives both the per-row Generate gating and the parent's
 * highlight pick. Pure so the rule (PRD § User Story 4: single primary
 * action per row) is unit-testable without React.
 *
 *   invoice-link → row already has a non-void invoice; render the link.
 *   generate     → row owns a billable period AND the period has ended
 *                  (calendar) with overage. For monthly retainers (rollover
 *                  OFF) the row IS the period. For rollover, the cycle-end
 *                  row is the canonical row for the cycle's invoice.
 *   report       → everything else (within-budget ended, in-progress,
 *                  mid-cycle for rollover).
 *
 * Phase 8 nomenclature note: this helper uses `periodEnded` (calendar
 * truth) — overage billing must NOT require an admin "Close period" click
 * first. The admin-action axis (`isClosed` / `closedAt`) lives on
 * `getRetainerData`'s month rows and drives lock + display, not action
 * gating.
 */

export type RetainerRowMonthInput = {
  /**
   * Calendar truth: the row's last day has passed in the org's timezone.
   * Renamed from `isMonthClosed` in Phase 8 — the old name was overloaded
   * with admin-settlement state. Overage-bill gating is calendar-driven and
   * must NOT require an admin "Close period" click first.
   */
  periodEnded: boolean;
  cyclePosition: number; // 1-indexed within the cycle (1…cycleLength)
  endBalance: number; // minutes; positive = within budget
  invoice: { status: "draft" | "invoiced" | "paid" | "void" } | null;
};

export type RetainerRowContext = {
  isRollover: boolean;
  cycleLength: number;
  /** Cycle-level overage minutes — positive means cycle exceeded budget. */
  cycleHasOverage: boolean;
  overageRate: number;
};

export type RetainerRowAction = "invoice-link" | "generate" | "report";

export function decideRetainerRowAction(
  month: RetainerRowMonthInput,
  ctx: RetainerRowContext,
): RetainerRowAction {
  // Voided invoices are filtered upstream in `getRetainerData` so `invoice`
  // is null for freed periods. Defensive guard here keeps the helper
  // self-contained — same answer either way.
  if (month.invoice && month.invoice.status !== "void") return "invoice-link";

  if (!month.periodEnded) return "report";
  if (ctx.overageRate <= 0) return "report";

  if (ctx.isRollover) {
    const isCycleEndRow = isCycleEnd(month, ctx.cycleLength);
    return isCycleEndRow && ctx.cycleHasOverage ? "generate" : "report";
  }

  const monthOverageMinutes = month.endBalance < 0 ? -month.endBalance : 0;
  return monthOverageMinutes > 0 ? "generate" : "report";
}

/**
 * Same predicate the parent uses to pick the highlight row, exported so the
 * highlight + the action share one definition.
 */
export function isCycleEnd(
  month: { cyclePosition: number },
  cycleLength: number,
): boolean {
  return month.cyclePosition === cycleLength;
}

// ─── Slice 4 — close-action dispatch ────────────────────────────────────────
//
// `decideRetainerRowAction` covers the BILLING action (Generate / link /
// Report). Slice 4 introduces a parallel admin CLOSE action that lives on
// the same row but answers a different question: "Can the admin close this
// month — or this cycle — right now?"
//
// The two axes coexist:
//   - non-rollover within-budget Open row    → `close-month`  (admin)
//   - rollover monthly mid-cycle Open row    → `close-month`  (admin) †
//   - rollover cycle-end Open row, no cycle  → `close-cycle`  (admin)
//     overage, every month already periodEnded
//   - anything else (current month, has      → `null`
//     invoice, overage, member view, etc.)
//
// † Rollover monthly close is intentionally allowed mid-cycle (Slice 3) —
// it's how an admin can lock a previous month inside an in-flight cycle.
// The cycle close happens later when the entire cycle ends. Both surface
// on the same row chrome; the cycle button only takes over on the LAST
// row of a ROLLOVER cycle that has ENDED, is within budget, and has no
// open billing affordance.

export type RetainerRowCloseAction = "close-month" | "close-cycle" | null;

export type RetainerRowCloseContext = RetainerRowContext & {
  /** Has the cycle as a whole ended in the org's timezone? */
  isCycleClosed: boolean;
  /** True iff EVERY month in the cycle has `periodEnded === true`. */
  allCycleMonthsEnded: boolean;
  /** Set on the row when the admin has already closed it (cycle close
   *  bulk-marks every month). When true, both close actions are off — the
   *  cycle is already locked. */
  isMonthAlreadyClosed: boolean;
  isAdmin: boolean;
};

/**
 * Decide which CLOSE action (if any) a row should expose. Independent of
 * `decideRetainerRowAction` because the close axis and the billing axis
 * answer different questions:
 *
 *   - Billing axis: "is there money to collect on this row?"
 *   - Close axis:   "can the admin lock this work-in-place?"
 *
 * Returns `null` whenever the row should fall back to its existing
 * billing-axis primary (Generate / invoice link / Report). The cycle
 * variant ONLY fires on the cycle-end row when the whole cycle is settled-
 * shaped and within budget — anywhere else (mid-cycle, in-progress,
 * overage, has invoice) returns `null` so the existing affordances stay.
 */
export function decideRetainerRowCloseAction(
  month: RetainerRowMonthInput,
  ctx: RetainerRowCloseContext,
): RetainerRowCloseAction {
  if (!ctx.isAdmin) return null;
  if (ctx.isMonthAlreadyClosed) return null;
  // Billing-axis wins: if the row should show an invoice link or a
  // Generate button, the admin's next correct action is to bill, not to
  // lock. The close button reappears once the bill is paid (or after the
  // billing-axis row is the cycle-end row that's within budget).
  if (month.invoice && month.invoice.status !== "void") return null;
  if (!month.periodEnded) return null;

  if (ctx.isRollover) {
    // Rollover projects close at the cycle level, NEVER at the month level.
    // Mid-cycle monthly close hides hours from the cycle's overage
    // computation (the `closePeriod` mutation rejects this — keep the UI
    // in sync so the affordance never appears). `closeRetainerCycle` is
    // the only valid close path; it appears on the cycle-end row only
    // when the cycle has actually ended within budget.
    const isCycleEndRow = isCycleEnd(month, ctx.cycleLength);
    if (!isCycleEndRow) return null;

    // Cycle-end row eligible for cycle close only if:
    //   - the cycle as a whole has ended (calendar)
    //   - every month inside is calendar-ended (no straggler in-progress
    //     row inside the cycle that should still accumulate hours)
    //   - the cycle has no overage owed (overage must be billed first —
    //     `decideRetainerRowAction` would already be returning "generate"
    //     in that case, but the early return above covers it).
    if (!ctx.isCycleClosed) return null;
    if (!ctx.allCycleMonthsEnded) return null;
    if (ctx.cycleHasOverage) return null; // Fall back to Generate / invoice link.
    return "close-cycle";
  }

  // Non-rollover within-budget ended month → monthly close. (Overage
  // months already returned "generate" via the billing axis above.)
  if (month.endBalance < 0 && ctx.overageRate > 0) return null;
  return "close-month";
}

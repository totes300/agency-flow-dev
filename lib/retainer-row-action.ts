/**
 * Single source of truth for "what action does a Monthly Breakdown row
 * carry?" — drives both the per-row Generate gating and the parent's
 * highlight pick. Pure so the rule (PRD § User Story 4: single primary
 * action per row) is unit-testable without React.
 *
 *   invoice-link → row already has a non-void invoice; render the link.
 *   generate     → row owns a billable period AND the period is closed
 *                  with overage. For monthly retainers (rollover OFF) the
 *                  row IS the period. For rollover, the cycle-end row is
 *                  the canonical row for the cycle's invoice.
 *   report       → everything else (within-budget closed, in-progress,
 *                  mid-cycle for rollover).
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

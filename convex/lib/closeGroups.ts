/**
 * Pure grouping/meta helpers for the Close workspace ledger.
 *
 * Framework-free and side-effect-free — safe to import from BOTH Convex
 * functions and React client components (same pattern as `entryStatus` and
 * `closeFlags`). The server emits a flat, pre-sorted `CloseWorkspaceRow[]`
 * (see `convex/close.ts`); the client groups rows by whatever axis the user
 * picked and decorates each group with close-specific meta:
 *
 *   - `inScopeMinutes` — subtotal over NON-skipped rows only. Skipped rows
 *     still render inside their group (muted, with Undo) but are leaving the
 *     period; counting them would inflate the subtotal the owner
 *     sanity-checks against the budget line.
 *   - `majorityCarried` / `carriedShared` — the "carried · May 2026" label
 *     is promoted to the group header when a majority of the group's
 *     in-scope rows are carried in AND they agree on reason + origin month.
 *   - `allSkipped` — a fully-skipped group collapses to a single undo line.
 *
 * The meta reads only row-level flags, so it is axis-agnostic: it works the
 * same for task, day, week, month, and member groupings.
 */

import type { CarriedReason } from "./billingScope";

/** Structural subset of `CloseWorkspaceRow` the group helpers read. */
export type CloseGroupableRow = {
  _id: string;
  date: string;
  durationMinutes: number;
  skipped: boolean;
  carried: boolean;
  carriedReason?: CarriedReason;
  originMonthLabel: string;
};

export type CloseGroupMeta = {
  /** Count of rows still in this period's scope (not skipped out). */
  inScopeCount: number;
  /** Subtotal minutes over in-scope rows only. */
  inScopeMinutes: number;
  /** Every row in the group was skipped out (group renders as one undo line). */
  allSkipped: boolean;
  /** A majority of in-scope rows are carried in from an earlier month. */
  majorityCarried: boolean;
  /** Shared reason/month when `majorityCarried` and all carried rows agree — else null. */
  carriedShared: { reason: CarriedReason; originMonthLabel: string } | null;
};

export function deriveCloseGroupMeta(rows: CloseGroupableRow[]): CloseGroupMeta {
  const inScope = rows.filter((r) => !r.skipped);
  const carried = inScope.filter((r) => r.carried);
  const majorityCarried = carried.length > 0 && carried.length * 2 > inScope.length;

  let carriedShared: CloseGroupMeta["carriedShared"] = null;
  if (majorityCarried) {
    const reason = carried[0].carriedReason;
    const label = carried[0].originMonthLabel;
    const uniform = carried.every(
      (r) => r.carriedReason === reason && r.originMonthLabel === label,
    );
    carriedShared = uniform && reason ? { reason, originMonthLabel: label } : null;
  }

  return {
    inScopeCount: inScope.length,
    inScopeMinutes: inScope.reduce((sum, r) => sum + r.durationMinutes, 0),
    allSkipped: inScope.length === 0 && rows.length > 0,
    majorityCarried,
    carriedShared,
  };
}

/**
 * Canonical ledger display order: in-scope rows first (chronological
 * ascending — a month-close reads like the story of the month), skipped rows
 * last, `_id` as the deterministic tiebreaker. The server sorts its flat
 * payload with this; group helpers re-sort defensively so grouped views
 * never depend on transport order.
 */
export function compareCloseRows(
  a: Pick<CloseGroupableRow, "_id" | "date" | "skipped">,
  b: Pick<CloseGroupableRow, "_id" | "date" | "skipped">,
): number {
  if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}


/**
 * `closeQueue` — pure enrichment + grouping helpers for the Billing → Close tab.
 *
 * The queue shows one row per project: its committable period
 * (docs/prd-billing-refactor.md §6, §10), grouped by calendar month with
 * per-month progress ("N of M closed") and per-row review signals ("3 to
 * review"). The money comes from `lib/billing/pricing` and the flags from
 * `closeFlags`; this module only summarizes and arranges what those produce.
 * `convex/billingViews.ts:getCloseQueue` fetches docs and feeds it.
 */

import { reviewFlagCount, type CloseFlag } from "./closeFlags";
import { fromMinor } from "./billing/money";

// ─── Per-row scope summary ──────────────────────────────────────────────────

export type QueueScopeSummary = {
  /** In-scope entries for this close (billable + non-billable for retainer). */
  entryCount: number;
  /** Review items surfaced as "N to review" (warnings + blockers, excludes info). */
  flagCount: number;
  /** Billable minutes counted for money — feeds the row's colored hours. */
  loggedMinutes: number;
};

/**
 * Collapse a scope report + its flags into the three numbers a queue row shows.
 * `scope.entries` already excludes skipped-out entries (their effective period
 * is the next close), so counting them here is the row's true in-scope size.
 */
export function summarizeQueueScope(
  scope: { entries: readonly unknown[]; usageMinutes: number },
  flags: CloseFlag[],
): QueueScopeSummary {
  return {
    entryCount: scope.entries.length,
    flagCount: reviewFlagCount(flags),
    loggedMinutes: scope.usageMinutes,
  };
}

// ─── Month grouping + progress ──────────────────────────────────────────────

export type MonthGroupInput = {
  /** Calendar month this row groups under (YYYY-MM) — a cycle uses its closing month. */
  monthKey: string;
  amountMinor: number;
  currency: string;
};

export type MonthGroup<T extends MonthGroupInput> = {
  monthKey: string;
  rows: T[];
  /** Actionable (open) rows shown in this month. */
  openCount: number;
  /** Periods already committed this month (drafted / invoiced / closed). */
  closedCount: number;
  /** Progress denominator — open + closed. "N of M closed" = closedCount of totalCount. */
  totalCount: number;
  /** Month total per currency, summed in minor units (never across currencies). */
  totalsByCurrency: Record<string, number>;
};

/**
 * Group actionable rows by calendar month, oldest month first, attaching the
 * "N of M closed" progress. `committedByMonth` carries the count of periods
 * that already left the queue this month (they show as progress, not rows).
 */
export function groupQueueByMonth<T extends MonthGroupInput>(
  rows: T[],
  committedByMonth: Map<string, number>,
): MonthGroup<T>[] {
  const buckets = new Map<string, T[]>();
  for (const r of rows) {
    const g = buckets.get(r.monthKey);
    if (g) g.push(r);
    else buckets.set(r.monthKey, [r]);
  }

  const monthKeys = new Set<string>([...buckets.keys(), ...committedByMonth.keys()]);
  const groups: MonthGroup<T>[] = [];
  for (const monthKey of monthKeys) {
    const groupRows = buckets.get(monthKey) ?? [];
    // A committed month with no open rows is fully done (M of M) — still shown
    // so month-over-month progress reads honestly, but only when it has rows.
    if (groupRows.length === 0) continue;
    const closedCount = committedByMonth.get(monthKey) ?? 0;
    const minorByCurrency: Record<string, number> = {};
    for (const r of groupRows) {
      minorByCurrency[r.currency] = (minorByCurrency[r.currency] ?? 0) + r.amountMinor;
    }
    const totalsByCurrency = Object.fromEntries(
      Object.entries(minorByCurrency).map(([cur, minor]) => [cur, fromMinor(minor, cur)]),
    );
    groups.push({
      monthKey,
      rows: groupRows,
      openCount: groupRows.length,
      closedCount,
      totalCount: groupRows.length + closedCount,
      totalsByCurrency,
    });
  }

  groups.sort((a, b) => (a.monthKey < b.monthKey ? -1 : a.monthKey > b.monthKey ? 1 : 0));
  return groups;
}

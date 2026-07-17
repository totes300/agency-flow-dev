/**
 * `closeQueue` — pure enrichment + grouping helpers for the Billing → Close tab
 * (`docs/closing-refactor/08-close-queue-and-billing-nav.md`).
 *
 * The close queue is the front door of the month-end ritual: every open,
 * elapsed, closable period across the org, grouped by calendar month with
 * per-month progress ("N of M closed") and per-row review signals ("3 to
 * review") and oldest-first blocking ("Close May first").
 *
 * These helpers are pure so the enumeration extensions the PRD calls for
 * (entryCount, flagCount, disabledReason, month grouping/progress) are covered
 * by co-located unit tests — the money still comes from `billingScope` /
 * `closeFlags`; this module only summarizes and arranges what those produce.
 * The Convex shim in `convex/close.ts:getCloseQueue` fetches docs, composes
 * `billingScope`, and feeds these functions.
 */

import type { BillingScopeReport } from "./billingScope";
import { reviewFlagCount, type CloseFlag } from "./closeFlags";

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
  scope: BillingScopeReport,
  flags: CloseFlag[],
): QueueScopeSummary {
  return {
    entryCount: scope.entries.length,
    flagCount: reviewFlagCount(flags),
    loggedMinutes: scope.usageMinutes,
  };
}

// ─── Oldest-first blocking (I3) ─────────────────────────────────────────────

export type DisableInput = {
  /** Stable row key (project + period) — the map is keyed by this. */
  key: string;
  projectId: string;
  /** Chronological sort key (same one the ready feed sorts by). */
  sortKey: string;
  /** Authoritative I3 flag from `billingScope` — is this the first open period? */
  committable: boolean;
  /** Human label of this row's period ("June 2026" / "Apr–Jun 2026"). */
  periodLabel: string;
};

/** Fallback hint when the blocking period isn't a strictly-earlier visible row. */
export const GENERIC_BLOCKED_HINT = "Close earlier period first";

/**
 * PRD I3 — per project only the first open, elapsed period can be committed;
 * every later period is blocked with "Close <earlier period> first". We drive
 * the enabled/disabled decision off each row's authoritative `committable` flag
 * (from `billingScope`), so queue and workspace can never disagree about which
 * period is next.
 *
 * The hint names the earliest visible row's period only when that row is
 * strictly earlier than the blocked one. A row can be non-committable while
 * being the earliest *visible* row (e.g. a `billingScope` firstOpenPeriod that
 * produced no queue row — a $0-amount T&M month filtered from the inbox); in
 * that case we fall back to the workspace's own generic copy rather than emit a
 * self-referential "Close June first" on the June row.
 *
 * Returns a map row-key → disabled hint (absent when the row is committable).
 * Fixed projects have a single, always-committable row and never appear disabled.
 */
export function assignDisabledReasons(
  rows: DisableInput[],
): Map<string, string> {
  const byProject = new Map<string, DisableInput[]>();
  for (const r of rows) {
    const g = byProject.get(r.projectId);
    if (g) g.push(r);
    else byProject.set(r.projectId, [r]);
  }

  const out = new Map<string, string>();
  for (const group of byProject.values()) {
    // Earliest visible period for this project (the one that, if committable,
    // is the front of the oldest-first queue).
    const earliest = group.reduce((a, b) => (a.sortKey <= b.sortKey ? a : b));
    for (const r of group) {
      if (r.committable) continue;
      out.set(
        r.key,
        earliest.sortKey < r.sortKey
          ? `Close ${earliest.periodLabel} first`
          : GENERIC_BLOCKED_HINT,
      );
    }
  }
  return out;
}

// ─── Month grouping + progress ──────────────────────────────────────────────

export type MonthGroupInput = {
  /** Calendar month this row groups under (YYYY-MM) — a cycle uses its closing month. */
  monthKey: string;
  amount: number;
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
  /** Month total per currency (rows are not aggregated across currencies). */
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
    const totalsByCurrency: Record<string, number> = {};
    for (const r of groupRows) {
      totalsByCurrency[r.currency] = round2(
        (totalsByCurrency[r.currency] ?? 0) + r.amount,
      );
    }
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

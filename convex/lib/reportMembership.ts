/**
 * Report membership — which report MONTH each entry belongs to on a client
 * document (Month-Close slice 07). Pure; consumed by `getRetainerStatement`.
 *
 * The rule makes closed-period reports a stable function of settlement stamps
 * (I4) while open-period previews follow `billingScope` (consistent with the
 * workspace), and it places skipped / logged-late entries on the RECEIVING
 * month, not their calendar month:
 *
 *   report month of an entry =
 *     - settled  → the stamped month (`settledPeriodStart`). Immutable: a
 *       backdated insert after close is a NEW open entry, so it can never land
 *       in a closed month's report.
 *     - open     → its effective period (I1 via `resolveEntryPeriods`), bucketed
 *       to a month (cycle projects: natural month, or the cycle's first month
 *       for a carried-in entry).
 *     - draft-linked (invoiceId set, not yet settled) → its natural month
 *       (pre-finalization behaviour, unchanged).
 *
 * A member whose calendar date precedes the report month's start is "carried in"
 * (rendered in a "Carried over from <month>" group with its true date).
 */

import {
  resolveEntryPeriods,
  type ScopeProjectInput,
  type ScopeEntryInput,
} from "./billingScope";

function isCycleGrid(project: ScopeProjectInput): boolean {
  return (
    project.billingType === "retainer" &&
    project.rolloverEnabled === true &&
    (project.cycleLength ?? 1) > 1
  );
}

export type ReportMembershipInput = {
  project: ScopeProjectInput;
  entries: ScopeEntryInput[];
  closedPeriods: Parameters<typeof resolveEntryPeriods>[0]["closedPeriods"];
  invoices: Parameters<typeof resolveEntryPeriods>[0]["invoices"];
  todayStr: string;
};

/** entryId → report-month key (YYYY-MM) for every supplied entry. */
export function computeReportMonths(
  input: ReportMembershipInput,
): Map<string, string> {
  const rollover = isCycleGrid(input.project);
  const resolutions = resolveEntryPeriods({
    project: input.project,
    entries: input.entries,
    closedPeriods: input.closedPeriods,
    invoices: input.invoices,
    todayStr: input.todayStr,
  });
  const effById = new Map(
    resolutions.map((r) => [r.entryId.toString(), r.withSkip]),
  );

  const out = new Map<string, string>();
  for (const e of input.entries) {
    const key = e._id.toString();
    if (e.settledPeriodStart) {
      out.set(key, e.settledPeriodStart.slice(0, 7));
      continue;
    }
    const eff = effById.get(key);
    if (eff) {
      // Open entry — effective period (skip/carried aware).
      if (rollover) {
        const inCycle = e.date >= eff.start && e.date <= eff.end;
        out.set(key, inCycle ? e.date.slice(0, 7) : eff.start.slice(0, 7));
      } else {
        out.set(key, eff.start.slice(0, 7)); // eff is the month
      }
      continue;
    }
    // Draft-linked (or otherwise non-open, non-settled) → natural month.
    out.set(key, e.date.slice(0, 7));
  }
  return out;
}

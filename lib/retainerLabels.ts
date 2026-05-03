/**
 * Frontend deriver for retainer usage display strings. The backend
 * (`convex/statements.ts`, `convex/invoices.ts`) returns state primitives
 * (`kind`, `closed`, `monthlyIncludedMinutes`); this file turns them into
 * the labels that ship to the user. Decision 2026-05-03 Q3.
 *
 * Single source of truth for the strings — both the Monthly Report and the
 * Invoice document call `getRetainerUsageLabels`.
 */

export type RetainerUsageState = {
  kind: "month" | "cycle";
  /** True for past/closed periods or finalized invoices; false mid-period. */
  closed: boolean;
  monthlyIncludedMinutes: number;
}

export type RetainerUsageLabels = {
  /** Total row label, e.g. "Cycle total" / "Cycle to date" / "Month total". */
  totalLabel: string;
  /** Balance column header, e.g. "Cycle balance" / "Balance". */
  balanceLabel: string;
  /** Subtitle next to the table title, e.g. "05:00 monthly budget · rollover applied". */
  subtitle: string;
}

/** "00:00" / "-01:30" minute formatter, matches `convex/lib/retainerUsage.ts`. */
function formatMinutesLabel(minutes: number): string {
  const abs = Math.abs(minutes)
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  const formatted = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
  return minutes < 0 ? `-${formatted}` : formatted
}

export function getRetainerUsageLabels(state: RetainerUsageState): RetainerUsageLabels {
  const monthlyBudget = formatMinutesLabel(state.monthlyIncludedMinutes)
  if (state.kind === "cycle") {
    return {
      totalLabel: state.closed ? "Cycle total" : "Cycle to date",
      balanceLabel: "Cycle balance",
      subtitle: `${monthlyBudget} monthly budget · rollover applied`,
    }
  }
  return {
    totalLabel: "Month total",
    balanceLabel: "Balance",
    subtitle: `${monthlyBudget} monthly budget · no rollover`,
  }
}

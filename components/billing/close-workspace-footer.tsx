import { formatHoursCompact, formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/close"

/**
 * Calculation-row style table footer (PRD story 9 — a table-footer total so the
 * owner can sanity-check the ledger) with the over/within-budget verdict.
 */
export function CloseWorkspaceFooter({ data }: { data: CloseWorkspaceData }) {
  return (
    <div className="mt-1 flex items-center gap-3 border-t-2 py-2.5 text-sm">
      <span className="font-medium">Total logged</span>
      {data.billingType === "retainer" && (
        <span
          className={cn(
            "text-xs",
            data.withinBudget
              ? "text-emerald-600 dark:text-emerald-500"
              : "text-destructive",
          )}
        >
          {data.withinBudget
            ? "Within budget"
            : `Over by ${formatHoursCompact(data.overageMinutes)}`}
        </span>
      )}
      <span className="ml-auto tabular-nums font-semibold">
        {formatHoursCompact(data.totalLoggedMinutes)}
      </span>
      {data.billingType !== "retainer" && data.amount > 0 && (
        <span className="w-24 shrink-0 text-right tabular-nums font-semibold">
          {formatCurrency(data.amount, data.currency)}
        </span>
      )}
    </div>
  )
}

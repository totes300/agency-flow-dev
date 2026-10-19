"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatHoursShort } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/billingViews"

/**
 * A rollover cycle at a glance: one tile per month with the time logged
 * against that month's allowance. Clicking a tile narrows the ledger to the
 * month's entries (click again to clear). Months not reached yet stay muted.
 * Renders nothing for single-month periods.
 */
export function ClosePeriodMonths({
  data,
  activeMonth,
  onMonthChange,
}: {
  data: CloseWorkspaceData
  activeMonth: string | null
  onMonthChange: (month: string | null) => void
}) {
  const rows = data.monthlyBalances
  if (rows.length <= 1) return null

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={2}
      value={activeMonth ?? ""}
      onValueChange={(value) => onMonthChange(value || null)}
      className="grid w-full"
      style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}
      aria-label="Filter entries by month"
    >
      {rows.map((row) => {
        const used = row.loggedMinutes + row.carriedInMinutes
        return (
          <ToggleGroupItem
            key={row.monthKey}
            value={row.monthKey}
            disabled={row.pending}
            className="h-auto flex-col items-start gap-0.5 px-3 py-2"
          >
            <span className="text-xs text-muted-foreground">{monthName(row.monthKey)}</span>
            <span className="text-sm tabular-nums">
              <span className={cn(used > row.includedMinutes && "text-amber-700 dark:text-amber-500")}>
                {formatHoursShort(used)}
              </span>
              <span className="text-muted-foreground"> / {formatHoursShort(row.includedMinutes)}</span>
            </span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

function monthName(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" })
}

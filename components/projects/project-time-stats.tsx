"use client"

import { useMemo } from "react"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrencyPrecise, formatHoursCompact } from "@/lib/format"
import type { TimeEntryRow } from "@/components/projects/project-time-table"

type Stat = { label: string; value: string }

function computeStats(
  entries: TimeEntryRow[],
  billingType: string,
  currency: string,
): Stat[] {
  let total = 0
  let billable = 0
  let unbilledMinutes = 0
  let unbilledAmount = 0
  for (const e of entries) {
    total += e.durationMinutes
    if (e.isBillable) billable += e.durationMinutes
    // Phase 8 — "unbilled" is open billable: not on an invoice AND not
    // settled by a period close. A retainer-included entry is covered by
    // the monthly fee and should not appear in the unbilled stat.
    if (e.isBillable && !e.invoiceId && !e.settledAt) {
      unbilledMinutes += e.durationMinutes
      unbilledAmount += (e.durationMinutes / 60) * e.billableRate
    }
  }

  if (billingType === "t_and_m") {
    return [
      { label: "Total Hours", value: formatHoursCompact(total) },
      { label: "Billable Hours", value: formatHoursCompact(billable) },
      { label: "Unbilled Hours", value: formatHoursCompact(unbilledMinutes) },
      { label: "Unbilled Amount", value: formatCurrencyPrecise(unbilledAmount, currency) },
    ]
  }

  return [
    { label: "Total Hours", value: formatHoursCompact(total) },
    { label: "Billable Hours", value: formatHoursCompact(billable) },
    { label: "Non-billable", value: formatHoursCompact(total - billable) },
  ]
}

export function ProjectTimeStats({
  entries,
  billingType,
  currency,
}: {
  entries: TimeEntryRow[]
  billingType: string
  currency: string
}) {
  // Memoized: parent rerenders on every selection toggle and on every Convex
  // backend tick (entries gets a fresh ref); recomputing the loop each time
  // is wasted work for hundreds of entries.
  const stats = useMemo(
    () => computeStats(entries, billingType, currency),
    [entries, billingType, currency],
  )
  return (
    <div
      role="group"
      aria-label="Time totals"
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      {stats.map((s, i) => (
        <div key={s.label} className="flex items-center gap-x-4">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-sm font-medium tabular-nums">{s.value}</span>
          </div>
          {i < stats.length - 1 && (
            <Separator orientation="vertical" className="h-4" />
          )}
        </div>
      ))}
    </div>
  )
}

/** Skeleton for the stats row — mirrors N label/value pairs. */
export function ProjectTimeStatsSkeleton({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

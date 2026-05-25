"use client"

import { useMemo } from "react"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrencyPrecise, formatHoursCompact } from "@/lib/format"
import type { TimeEntryRow } from "@/components/projects/project-time-table"
import { entryStatus } from "@/convex/lib/entryStatus"

type Stat = { label: string; value: string }

/**
 * Phase 8 Slice 4 — top summary on the project Time tab.
 *
 * Per parent PRD § UI Changes → Top summary: the existing
 * `Total / Billable / Non-billable` trio gains exactly ONE additional
 * figure — `Open` — counting hours where `entryStatus() === "open"`.
 * No further micro-breakdown belongs here; the open/invoiced/settled
 * split lives in the period drill-down (Slice 4 PeriodDetailSheet) and
 * in reports.
 *
 * T&M projects keep their billing-specific `Unbilled Hours / Unbilled
 * Amount` stats (those reflect "ready to invoice" revenue, which is
 * the same `Open` bucket but money-shaped for T&M billers).
 */
function computeStats(
  entries: TimeEntryRow[],
  billingType: string,
  currency: string,
): Stat[] {
  let total = 0
  let billable = 0
  let openMinutes = 0
  let unbilledAmount = 0
  for (const e of entries) {
    total += e.durationMinutes
    if (e.isBillable) billable += e.durationMinutes
    // `Open` is the single source of truth used everywhere — same
    // derivation `entryStatus()` and `listProjectEntries.billingStatus`
    // use, so the stat number always matches what the filter would
    // return.
    if (entryStatus(e) === "open") {
      openMinutes += e.durationMinutes
      unbilledAmount += (e.durationMinutes / 60) * e.billableRate
    }
  }

  if (billingType === "t_and_m") {
    return [
      { label: "Total Hours", value: formatHoursCompact(total) },
      { label: "Billable Hours", value: formatHoursCompact(billable) },
      { label: "Open Hours", value: formatHoursCompact(openMinutes) },
      { label: "Open Amount", value: formatCurrencyPrecise(unbilledAmount, currency) },
    ]
  }

  return [
    { label: "Total Hours", value: formatHoursCompact(total) },
    { label: "Billable Hours", value: formatHoursCompact(billable) },
    { label: "Non-billable", value: formatHoursCompact(total - billable) },
    { label: "Open", value: formatHoursCompact(openMinutes) },
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

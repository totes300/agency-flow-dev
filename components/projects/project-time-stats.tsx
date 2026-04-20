"use client"

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
    if (e.isBillable && !e.invoiceId) {
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
  const stats = computeStats(entries, billingType, currency)
  return (
    <div
      role="group"
      aria-label="Time totals"
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className="flex items-center gap-6"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground">{s.label}</span>
            <span className="text-sm font-medium tabular-nums">{s.value}</span>
          </div>
          {i < stats.length - 1 && (
            <span aria-hidden className="text-muted-foreground/40">·</span>
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

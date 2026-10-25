"use client"

import type { ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { daysLeft, type SelectedPeriod } from "@/lib/billing/period-selection"
import { formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The period header (docs/prd-project-billing-redesign.md §7.2 steps 1–2):
 * ‹ › + the period named large + its ⋯ menu, a subline saying where it sits
 * in time, and the trend on the right.
 */
export function PeriodHeader({
  selected,
  todayStr,
  cycleMonths,
  menu,
  trend,
  onSelect,
}: {
  selected: SelectedPeriod
  todayStr: string
  /** Rollover cycle length (adds "3-month cycle"); 1 otherwise. */
  cycleMonths: number
  menu?: ReactNode
  trend?: ReactNode
  onSelect: (key: string) => void
}) {
  const unit = cycleMonths > 1 ? "cycle" : "month"
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="mr-1.5 flex gap-0.5">
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`Previous ${unit}`}
              disabled={!selected.prevKey}
              onClick={() => selected.prevKey && onSelect(selected.prevKey)}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={`Next ${unit}`}
              disabled={!selected.nextKey}
              onClick={() => selected.nextKey && onSelect(selected.nextKey)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <h2 className="text-2xl leading-tight font-semibold tracking-tight">{selected.label}</h2>
          {menu}
        </div>
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {rangeLabel(selected.start, selected.end)}
          {cycleMonths > 1 ? ` · ${cycleMonths}-month cycle` : ""}
          {" · "}
          {selected.isCurrent ? (
            `current ${unit} · ${daysLeft(todayStr, selected.end)} days left`
          ) : (
            <>
              ended ·{" "}
              <button
                type="button"
                className="font-medium text-blue-700 hover:underline dark:text-blue-300"
                onClick={() => onSelect(selected.currentKey)}
              >
                Back to current {unit}
              </button>
            </>
          )}
        </p>
      </div>
      {trend}
    </div>
  )
}

/** "Oct 1–31", "Aug 1 – Oct 31". */
function rangeLabel(start: string, end: string): string {
  const fmt = (ymd: string, opts: Intl.DateTimeFormatOptions) => {
    const [y, m, d] = ymd.split("-").map(Number)
    return new Date(y, m - 1, d).toLocaleDateString("en-US", opts)
  }
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(start, { month: "short", day: "numeric" })}–${Number(end.slice(8, 10))}`
  }
  return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric" })}`
}

/**
 * The trend (§7.2 step 2): thin bars for the selected period and the two
 * before it (a rollover cycle: its months), a dashed line at the included
 * hours, month + hours under each bar. The selected bar is dark; over budget
 * is red. Clicking selects.
 */
export function PeriodTrend({
  bars,
  selectedKey,
  includedMinutes,
  onSelect,
}: {
  bars: { key: string; label: string; minutes: number; selectKey: string }[]
  selectedKey: string
  /** Per-bar budget (monthly included hours); null = T&M, no line. */
  includedMinutes: number | null
  onSelect: (key: string) => void
}) {
  if (bars.length === 0) return null
  const HEIGHT = 30
  const max = Math.max(1, includedMinutes ?? 0, ...bars.map((b) => b.minutes)) * 1.15
  // A rollover cycle's bars all belong to the selected period.
  const isSelected = (b: (typeof bars)[number]) => b.selectKey === selectedKey
  return (
    <div className="w-[200px]">
      <div className="relative flex items-end gap-2.5 border-b border-border" style={{ height: HEIGHT }}>
        {includedMinutes !== null ? (
          <span
            className="absolute inset-x-0 border-t border-dashed border-muted-foreground/40"
            style={{ bottom: (includedMinutes / max) * HEIGHT }}
            title={`${formatMinutes(includedMinutes)} included`}
          />
        ) : null}
        {bars.map((b) => {
          const over = includedMinutes !== null && b.minutes > includedMinutes
          const on = isSelected(b)
          return (
            <button
              key={b.key}
              type="button"
              className="group flex h-full flex-1 items-end justify-center"
              title={`${b.label}: ${formatMinutes(b.minutes)}`}
              onClick={() => onSelect(b.selectKey)}
            >
              <span
                className={cn(
                  "block w-3.5 rounded-t-[3px] group-hover:opacity-75",
                  on ? (over ? "bg-destructive" : "bg-foreground") : over ? "bg-destructive/40" : "bg-muted-foreground/25",
                )}
                style={{ height: Math.max(2, (b.minutes / max) * HEIGHT) }}
              />
            </button>
          )
        })}
      </div>
      <div className="mt-1.5 flex gap-2.5">
        {bars.map((b) => {
          const over = includedMinutes !== null && b.minutes > includedMinutes
          const on = isSelected(b)
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onSelect(b.selectKey)}
              className="flex flex-1 flex-col items-center gap-px text-[11px] text-muted-foreground"
            >
              <span className={cn(on && "font-medium text-foreground")}>{b.label}</span>
              <span className={cn("font-mono", over ? "text-destructive" : on && "text-foreground")}>{formatMinutes(b.minutes)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

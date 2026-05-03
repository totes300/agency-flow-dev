"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback } from "react"
import type { RetainerSummary } from "@/convex/lib/projectSummary"
import { SummaryCardShell } from "./primitives/summary-card-shell"
import { SummaryColumn } from "./primitives/summary-column"
import { MetricRow } from "./primitives/metric-row"
import { MetricGroup } from "./primitives/metric-group"
import { BudgetArc } from "./primitives/budget-arc"
import { RoleGatedColumn } from "./primitives/role-gated-column"
import { Button } from "@/components/ui/button"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { formatCurrencyPrecise, formatMinutes } from "@/lib/format"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

export function RetainerSummaryCard({ summary }: { summary: RetainerSummary }) {
  const { currency, subtitle, cycle, timeBreakdown, overage, profitability } = summary

  return (
    <SummaryCardShell
      title="Project Finances"
      subtitle={subtitle}
      badge={cycle.hasUninvoicedClosedMonth ? (
        <ColoredPillBadge tone="amber" label="Uninvoiced" />
      ) : undefined}
      trailing={<CycleNavigator cycle={cycle} />}
    >
      <SummaryColumn title="Time breakdown">
        <div className="flex items-center gap-8">
          <BudgetArc
            usedMinutes={timeBreakdown.totalMinutes}
            budgetMinutes={timeBreakdown.cycleBudgetMinutes}
          />
          <div className="flex flex-1 flex-col gap-3">
            <MetricRow label="Billable hours" value={formatMinutes(timeBreakdown.billableMinutes)} />
            <MetricRow label="Non-billable hours" value={formatMinutes(timeBreakdown.nonBillableMinutes)} />
          </div>
        </div>
      </SummaryColumn>

      {overage ? (
        <SummaryColumn title="Overage">
          <MetricRow
            label="Over budget"
            value={overage.overBudgetMinutes > 0 ? `+${formatMinutes(overage.overBudgetMinutes)}` : "—"}
            variant={overage.overBudgetMinutes > 0 ? "destructive" : "default"}
          />
          <MetricRow
            label="Overage due"
            value={overage.overageDueAmount > 0
              ? formatCurrencyPrecise(overage.overageDueAmount, currency)
              : "—"
            }
            variant={overage.overageDueAmount > 0 ? "destructive" : "default"}
          />
        </SummaryColumn>
      ) : (
        <RoleGatedColumn title="Overage" />
      )}

      {profitability ? (
        <SummaryColumn title="Cycle Profitability">
          <MetricGroup>
            <MetricRow
              label="Earned Cycle Revenue"
              value={formatCurrencyPrecise(profitability.revenue, currency)}
            />
            <MetricRow
              label="Profit"
              value={formatCurrencyPrecise(profitability.profit, currency)}
              variant={profitability.profit < 0 ? "destructive" : "default"}
            />
            <MetricRow
              label="Total cost"
              value={formatCurrencyPrecise(profitability.totalCost, currency)}
            />
            <MetricRow
              label="Margin"
              value={profitability.marginPercent !== null ? `${profitability.marginPercent}%` : "—"}
              variant={profitability.marginPercent !== null && profitability.marginPercent < 0 ? "destructive" : "default"}
            />
          </MetricGroup>
        </SummaryColumn>
      ) : (
        <RoleGatedColumn title="Cycle Profitability" />
      )}
    </SummaryCardShell>
  )
}

function CycleNavigator({ cycle }: { cycle: RetainerSummary["cycle"] }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const setOffset = useCallback(
    (newOffset: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (newOffset === 0) params.delete("cycleOffset")
      else params.set("cycleOffset", String(newOffset))
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOffset(cycle.offset - 1)}
        disabled={!cycle.hasPreviousCycle}
        aria-label="Previous cycle"
      >
        <ChevronLeftIcon />
      </Button>
      <span className="min-w-24 text-center text-xs text-muted-foreground tabular-nums">
        {cycleRangeLabel(cycle)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOffset(cycle.offset + 1)}
        disabled={!cycle.hasNextCycle}
        aria-label="Next cycle"
      >
        <ChevronRightIcon />
      </Button>
    </div>
  )
}

function cycleRangeLabel(cycle: RetainerSummary["cycle"]): string {
  if (cycle.start.slice(0, 7) === cycle.end.slice(0, 7)) {
    return monthYearLabel(cycle.start)
  }
  const start = monthYearLabel(cycle.start)
  const end = monthYearLabel(cycle.end)
  if (cycle.start.slice(0, 4) === cycle.end.slice(0, 4)) {
    return `${start.split(" ")[0]}-${end}`
  }
  return `${start}-${end}`
}

function monthYearLabel(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })
}

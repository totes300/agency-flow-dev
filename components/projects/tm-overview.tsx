"use client"

import { useCallback } from "react"
import { useQuery } from "convex/react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { MetricCard } from "@/components/metric-card"
import { Button } from "@/components/ui/button"
import { MonthlyTimeBreakdown } from "./monthly-time-breakdown"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertTriangleIcon } from "lucide-react"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"

type TmProject = {
  currency: string
  tmRateMode?: "flat" | "per_category"
  hourlyRate?: number
}

export function TmOverview({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: TmProject
}) {
  const router = useRouter()
  const pathname = usePathname()
  const overview = useQuery(api.timeEntries.projectOverview, { projectId })
  const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, { projectId })

  const currency = project.currency

  const handleTaskClick = useCallback(
    (taskId: string) => router.push(`${pathname}?detail=${taskId}`, { scroll: false }),
    [router, pathname],
  )

  if (overview === undefined) {
    return <TmOverviewSkeleton />
  }

  if (overview === null) return null

  // Rate info string for uninvoiced detail
  const rateInfo = project.tmRateMode === "flat" && project.hourlyRate
    ? `${formatCurrencyPrecise(project.hourlyRate, currency)}/h flat`
    : "per-category rates"

  return (
    <div className="flex flex-col gap-6">
      {/* Top metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Billable Time"
          value={formatMinutes(overview.totalBillableMinutes)}
          detail={`${formatMinutes(overview.thisMonthMinutes)} this month`}
        />
        <MetricCard
          label="Non-billable"
          value={formatMinutes(overview.totalNonBillableMinutes)}
          detail="Internal / non-chargeable"
        />
        <MetricCard
          label="Uninvoiced"
          value={formatCurrencyPrecise(overview.uninvoicedAmount, currency)}
          detail={rateInfo}
        />
        {/* Last 3 Months bar chart */}
        <Card size="sm">
          <CardContent>
            <p className="text-xs text-muted-foreground">Last 3 Months</p>
            <div className="mt-2 flex items-end gap-2 h-14">
              {(() => {
                const maxMin = Math.max(...overview.last3BillableMonths.map((x) => x.minutes), 1)
                return overview.last3BillableMonths.map((m) => {
                const heightPct = (m.minutes / maxMin) * 100
                const monthLabel = new Date(m.month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" })
                return (
                  <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                    <div className="relative w-full max-w-[40px] flex items-end" style={{ height: "48px" }}>
                      <div
                        className="w-full rounded-sm bg-primary/80"
                        style={{ height: `${Math.max(heightPct, 4)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{monthLabel}</span>
                  </div>
                )
              })
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Unbilled banner */}
      {overview.uninvoicedAmount > 0 && (
        <Alert variant="default" className="border-warning/30 bg-warning/10 text-warning">
          <AlertTriangleIcon />
          <AlertDescription className="flex items-center gap-3">
            <span>
              Uninvoiced balance: {formatCurrencyPrecise(overview.uninvoicedAmount, currency)} across{" "}
              {formatMinutes(overview.uninvoicedMinutes)} billable hours.
            </span>
            <Button size="sm" variant="outline" disabled className="ml-auto shrink-0">
              Create Invoice
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Time Log */}
      <div>
        {monthlyData === undefined ? (
          <TmTimeLogSkeleton />
        ) : (
          <MonthlyTimeBreakdown
            months={monthlyData}
            showAmounts
            currency={currency}
            onTaskClick={handleTaskClick}
          />
        )}
      </div>
    </div>
  )
}

function TmOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4 flex flex-col gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
    </div>
  )
}

function TmTimeLogSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  )
}

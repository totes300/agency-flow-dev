"use client"

import { useMemo } from "react"
import { useQuery } from "convex/react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { MetricCard } from "@/components/metric-card"
import { CategoryBadge } from "@/components/category-badge"
import { BudgetProgress } from "@/components/budget-progress"
import { MonthlyTimeBreakdown } from "./monthly-time-breakdown"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoIcon, AlertTriangleIcon } from "lucide-react"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"

export function FixedOverview({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: { currency: string; fixedPrice?: number }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const overview = useQuery(api.timeEntries.projectOverview, { projectId })
  const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, { projectId })

  const currency = project.currency
  const fixedPrice = project.fixedPrice

  const totalEstimatedMinutes = useMemo(() => {
    if (!estimates) return 0
    return estimates.reduce((sum, e) => sum + e.estimatedMinutes, 0)
  }, [estimates])

  // Fixed economics from real data
  const totalActualMinutes = overview?.totalMinutes ?? 0
  const totalActualCost = overview?.totalActualCost ?? 0
  const profit = (fixedPrice ?? 0) - totalActualCost
  const effectiveRate = totalActualMinutes > 0
    ? (fixedPrice ?? 0) / (totalActualMinutes / 60)
    : 0
  const budgetPercent = totalEstimatedMinutes > 0
    ? (totalActualMinutes / totalEstimatedMinutes) * 100
    : null

  // Per-category actuals
  const minutesByCategory = overview?.minutesByCategory ?? {}

  // Unestimated categories with logged time
  const unestimatedCategories = useMemo(() => {
    if (!estimates || !overview) return []
    const estimatedIds = new Set(estimates.map((e) => e.workCategoryId?.toString()))
    return Object.entries(minutesByCategory)
      .filter(([catId]) => catId !== "uncategorized" && !estimatedIds.has(catId))
      .map(([catId, minutes]) => ({ catId, minutes }))
  }, [estimates, overview, minutesByCategory])

  function handleTaskClick(taskId: string) {
    router.push(`${pathname}?detail=${taskId}`, { scroll: false })
  }

  // Loading skeleton
  if (overview === undefined || estimates === undefined) {
    return <FixedOverviewSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* Top metric cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Fixed Fee"
          value={fixedPrice ? formatCurrencyPrecise(fixedPrice, currency) : "Not set"}
        />
        <MetricCard
          label="Actual"
          value={formatMinutes(totalActualMinutes)}
          detail={`Labor cost ${formatCurrencyPrecise(totalActualCost, currency)}`}
        />
        <MetricCard
          label="Profit"
          value={fixedPrice ? formatCurrencyPrecise(profit, currency) : "—"}
          detail={
            fixedPrice && totalActualMinutes > 0
              ? `Effective rate ${formatCurrencyPrecise(effectiveRate, currency)}/h`
              : "—"
          }
          variant={fixedPrice && profit < 0 ? "destructive" : "default"}
        />
      </div>

      {/* Info banner */}
      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>
          Fixed-fee projects track delivery against estimated effort and labor cost.
        </AlertDescription>
      </Alert>

      {/* Budget & Category Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Budget & Category Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Overall budget bar */}
          {budgetPercent !== null ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <BudgetProgress
                  used={totalActualMinutes}
                  budget={totalEstimatedMinutes}
                  className="flex-1"
                />
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {Math.round(budgetPercent)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatMinutes(totalActualMinutes)} / {formatMinutes(totalEstimatedMinutes)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No estimate set</p>
          )}

          {/* Per-category table */}
          {estimates.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Estimated</th>
                  <th className="px-4 py-2 font-medium">Actual</th>
                  <th className="px-4 py-2 font-medium">Remaining</th>
                  <th className="px-4 py-2 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {estimates.map((est) => {
                  const actual = minutesByCategory[est.workCategoryId?.toString() ?? ""] ?? 0
                  const remaining = est.estimatedMinutes - actual
                  const pct = est.estimatedMinutes > 0
                    ? Math.round((actual / est.estimatedMinutes) * 100)
                    : null
                  return (
                    <tr key={est._id} className="border-t">
                      <td className="px-4 py-2.5">
                        <CategoryBadge name={est.categoryName} color={est.categoryColor} />
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{formatMinutes(est.estimatedMinutes)}</td>
                      <td className="px-4 py-2.5 font-medium tabular-nums">{formatMinutes(actual)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatMinutes(remaining)}</td>
                      <td className="px-4 py-2.5">
                        {pct !== null ? (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-blue-500 transition-[width] duration-300"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
                <tr className="border-t bg-muted/30 font-medium">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMinutes(totalEstimatedMinutes)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMinutes(totalActualMinutes)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{formatMinutes(totalEstimatedMinutes - totalActualMinutes)}</td>
                  <td className="px-4 py-2.5">
                    {budgetPercent !== null && (
                      <span className="text-xs text-muted-foreground tabular-nums">{Math.round(budgetPercent)}%</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {/* Unestimated category warning */}
          {unestimatedCategories.length > 0 && (
            <Alert variant="default" className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertTriangleIcon className="size-4" />
              <AlertDescription>
                {formatMinutes(unestimatedCategories.reduce((s, c) => s + c.minutes, 0))} logged under
                categories with no budget estimate — budget tracking is incomplete.{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => router.push(`${pathname}?tab=settings`)}
                >
                  Add estimate →
                </button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Monthly Time Log */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Time Log</h3>
        {monthlyData === undefined ? (
          <TimeLogSkeleton />
        ) : (
          <MonthlyTimeBreakdown
            months={monthlyData}
            showAmounts={false}
            onTaskClick={handleTaskClick}
          />
        )}
      </div>
    </div>
  )
}

function FixedOverviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full rounded-lg" />
      <div className="rounded-xl border p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-2.5 w-full rounded-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  )
}

function TimeLogSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  )
}

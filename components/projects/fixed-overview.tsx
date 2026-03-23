"use client"

import { useMemo, useCallback } from "react"
import { useQuery } from "convex/react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { MetricCard } from "@/components/metric-card"
import { BudgetProgress } from "@/components/budget-progress"
import { MonthlyTimeBreakdown } from "./monthly-time-breakdown"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoIcon, AlertTriangleIcon } from "lucide-react"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"

export function FixedOverview({
  projectId,
  project,
  onNavigateToEstimates,
}: {
  projectId: Id<"projects">
  project: { currency: string; fixedPrice?: number }
  onNavigateToEstimates?: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
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

  // Per-category actuals — stable empty fallback to avoid useMemo invalidation
  const minutesByCategory = overview?.minutesByCategory ?? EMPTY_RECORD

  // Unestimated categories with logged time — enriched with name/color
  const unestimatedCategories = useMemo(() => {
    if (!estimates || !overview || !categories) return []
    const estimatedIds = new Set(estimates.map((e) => e.workCategoryId?.toString()))
    const catMap = new Map(categories.map((c) => [c._id.toString(), c]))
    return Object.entries(minutesByCategory)
      .filter(([catId]) => catId !== "uncategorized" && !estimatedIds.has(catId))
      .map(([catId, minutes]) => {
        const cat = catMap.get(catId)
        return { catId, minutes, name: cat?.name ?? "Unknown", color: cat?.color ?? "gray" }
      })
  }, [estimates, overview, categories, minutesByCategory])

  const handleTaskClick = useCallback(
    (taskId: string) => router.push(`${pathname}?detail=${taskId}`, { scroll: false }),
    [router, pathname],
  )

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

      {/* Budget */}
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Header row — title with accent underline + summary */}
        <div className="flex items-end justify-between px-5 pt-5 pb-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Budget</h3>
            <div className="mt-1 h-0.5 w-10 rounded-full bg-primary" />
          </div>
          {budgetPercent !== null ? (
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatMinutes(totalActualMinutes)} of {formatMinutes(totalEstimatedMinutes)}{" "}
              <span className="font-semibold text-foreground">{Math.round(budgetPercent)}%</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">No estimate set</p>
          )}
        </div>

        {/* Progress bar */}
        {budgetPercent !== null && (
          <div className="px-5 pb-4">
            <BudgetProgress used={totalActualMinutes} budget={totalEstimatedMinutes} />
          </div>
        )}

        {/* Category table */}
        {estimates.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t text-left">
                <th className="px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground">CATEGORY</th>
                <th className="px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground">ESTIMATED</th>
                <th className="px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground">ACTUAL</th>
                <th className="px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground">REMAINING</th>
                <th className="px-5 py-2.5 text-xs font-medium tracking-wide text-muted-foreground">PROGRESS</th>
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
                  <tr key={est._id} className="border-t transition-colors hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{est.categoryName}</td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">{formatMinutes(est.estimatedMinutes)}</td>
                    <td className="px-5 py-3 font-semibold tabular-nums">{formatMinutes(actual)}</td>
                    <td className="px-5 py-3 tabular-nums text-muted-foreground">{formatMinutes(remaining)}</td>
                    <td className="px-5 py-3">
                      {pct !== null ? (
                        <div className="flex items-center gap-2.5">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-[width] duration-300"
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                          <span className="text-sm tabular-nums text-muted-foreground">{pct}%</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="border-t font-semibold">
                <td className="px-5 py-3">Total</td>
                <td className="px-5 py-3 tabular-nums">{formatMinutes(totalEstimatedMinutes)}</td>
                <td className="px-5 py-3 tabular-nums">{formatMinutes(totalActualMinutes)}</td>
                <td className="px-5 py-3 tabular-nums">{formatMinutes(totalEstimatedMinutes - totalActualMinutes)}</td>
                <td className="px-5 py-3">
                  {budgetPercent !== null && (
                    <div className="flex items-center gap-2.5">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                          style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm tabular-nums">{Math.round(budgetPercent)}%</span>
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {/* Unestimated category warning */}
        {unestimatedCategories.length > 0 && (
          <div className="flex items-center gap-3 border-t px-5 py-3">
            <AlertTriangleIcon className="size-4 shrink-0 text-red-400 dark:text-red-500" />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">No estimate</span>
              {" — "}
              {unestimatedCategories.map((cat, i) => (
                <span key={cat.catId}>
                  {i > 0 && ", "}
                  <span className="font-medium">{cat.name}</span>
                  {" "}
                  <span className="font-mono tabular-nums">{formatMinutes(cat.minutes)}</span>
                </span>
              ))}
            </p>
            {onNavigateToEstimates && (
              <Button
                variant="outline"
                size="sm"
                onClick={onNavigateToEstimates}
                className="h-7 shrink-0 text-xs"
              >
                Add estimates
              </Button>
            )}
          </div>
        )}
      </div>

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

const EMPTY_RECORD: Record<string, number> = {}

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

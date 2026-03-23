"use client"

import { useMemo, useCallback } from "react"
import { useQuery } from "convex/react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { MetricCard } from "@/components/metric-card"
import { MonthlyTimeBreakdown } from "./monthly-time-breakdown"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoIcon, AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
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
      <BudgetSection
        estimates={estimates}
        minutesByCategory={minutesByCategory}
        totalEstimatedMinutes={totalEstimatedMinutes}
        totalActualMinutes={totalActualMinutes}
        budgetPercent={budgetPercent}
        unestimatedCategories={unestimatedCategories}
        onNavigateToEstimates={onNavigateToEstimates}
      />

      {/* Time Log */}
      <div>
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

// ─── Budget Section ─────────────────────────────────────────────────────────────

type EstimateRow = {
  _id: string
  categoryName: string
  categoryColor: string
  workCategoryId?: string
  estimatedMinutes: number
}

function BudgetSection({
  estimates,
  minutesByCategory,
  totalEstimatedMinutes,
  totalActualMinutes,
  budgetPercent,
  unestimatedCategories,
  onNavigateToEstimates,
}: {
  estimates: EstimateRow[]
  minutesByCategory: Record<string, number>
  totalEstimatedMinutes: number
  totalActualMinutes: number
  budgetPercent: number | null
  unestimatedCategories: Array<{ catId: string; minutes: number; name: string; color: string }>
  onNavigateToEstimates?: () => void
}) {
  // Split categories: active (actual > 0) vs not started (actual === 0)
  const activeEstimates: (EstimateRow & { actual: number; remaining: number; pct: number | null })[] = []
  const notStartedEstimates: (EstimateRow & { actual: number; remaining: number; pct: number | null })[] = []

  for (const est of estimates) {
    const actual = minutesByCategory[est.workCategoryId?.toString() ?? ""] ?? 0
    const remaining = est.estimatedMinutes - actual
    const pct = est.estimatedMinutes > 0 ? Math.round((actual / est.estimatedMinutes) * 100) : null
    const row = { ...est, actual, remaining, pct }
    if (actual > 0) {
      activeEstimates.push(row)
    } else {
      notStartedEstimates.push(row)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4">
        <h3 className="text-base font-semibold tracking-tight">Budget</h3>
        {budgetPercent !== null ? (
          <p className="text-right font-mono tabular-nums text-muted-foreground">
            <span className="text-sm">{formatMinutes(totalActualMinutes)}</span>
            <span className="mx-1.5 text-muted-foreground/40">/</span>
            <span className="text-sm">{formatMinutes(totalEstimatedMinutes)}</span>
            <span className="ml-2.5 text-base font-semibold text-foreground">{Math.round(budgetPercent)}%</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No estimate set</p>
        )}
      </div>

      {/* Column headers */}
      {estimates.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t text-left">
              <th className="px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Category</th>
              <th className="px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Estimated</th>
              <th className="px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Actual</th>
              <th className="px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Remaining</th>
              <th className="px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Progress</th>
            </tr>
          </thead>
          <tbody>
            {/* Active categories */}
            {activeEstimates.map((row) => (
              <BudgetRow key={row._id} row={row} />
            ))}

            {/* Not started separator + rows */}
            {notStartedEstimates.length > 0 && (
              <>
                <tr>
                  <td colSpan={5} className="px-6 pt-4 pb-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                      Not started
                    </span>
                  </td>
                </tr>
                {notStartedEstimates.map((row) => (
                  <BudgetRow key={row._id} row={row} muted />
                ))}
              </>
            )}

            {/* Total row */}
            <tr className="border-t">
              <td className="px-6 py-3.5 font-semibold">Total</td>
              <td className="px-6 py-3.5 font-semibold tabular-nums">{formatMinutes(totalEstimatedMinutes)}</td>
              <td className="px-6 py-3.5 font-semibold tabular-nums">{formatMinutes(totalActualMinutes)}</td>
              <td className="px-6 py-3.5 font-semibold tabular-nums">{formatMinutes(totalEstimatedMinutes - totalActualMinutes)}</td>
              <td className="px-6 py-3.5">
                {budgetPercent !== null && (
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 max-w-28 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm font-semibold tabular-nums">{Math.round(budgetPercent)}%</span>
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Unestimated category warning */}
      {unestimatedCategories.length > 0 && (
        <div className="flex items-center gap-3 border-t px-6 py-3">
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
  )
}

function BudgetRow({
  row,
  muted,
}: {
  row: { _id: string; categoryName: string; estimatedMinutes: number; actual: number; remaining: number; pct: number | null }
  muted?: boolean
}) {
  return (
    <tr className={cn("border-t transition-colors hover:bg-muted/30", muted && "text-muted-foreground/60")}>
      <td className={cn("px-6 py-3.5", muted ? "font-normal" : "font-medium")}>{row.categoryName}</td>
      <td className="px-6 py-3.5 tabular-nums">{formatMinutes(row.estimatedMinutes)}</td>
      <td className={cn("px-6 py-3.5 tabular-nums", !muted && "font-semibold")}>{formatMinutes(row.actual)}</td>
      <td className="px-6 py-3.5 tabular-nums">{formatMinutes(row.remaining)}</td>
      <td className="px-6 py-3.5">
        {row.pct !== null ? (
          <div className="flex items-center gap-2.5">
            <div className={cn("h-1.5 flex-1 max-w-28 overflow-hidden rounded-full", muted ? "bg-muted/50" : "bg-muted")}>
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", muted ? "bg-muted-foreground/20" : "bg-primary")}
                style={{ width: `${Math.min(row.pct, 100)}%` }}
              />
            </div>
            <span className="text-sm tabular-nums">{row.pct}%</span>
          </div>
        ) : (
          <span className="text-sm">—</span>
        )}
      </td>
    </tr>
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

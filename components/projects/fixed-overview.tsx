"use client"

import { useMemo, useCallback } from "react"
import { useQuery } from "convex/react"
import { useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { SectionCard } from "@/components/ui/section-card"
import { SectionHeader } from "@/components/ui/section-header"
import { ProgressCell } from "@/components/ui/progress-cell"
import { MetricCard } from "@/components/metric-card"
import { MonthlyTimeBreakdown } from "./monthly-time-breakdown"
import { Skeleton } from "@/components/ui/skeleton"
import { InfoIcon, AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"
import {
  CELL_KEY, CELL_PRIMARY, CELL_SECONDARY, ROW_MUTED,
  TABLE_HEAD, TABLE_HEAD_ROW, TABLE_CELL, TABLE_ROW, TABLE_FOOTER,
} from "@/lib/table-tokens"

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
    <SectionCard>
      {/* Header */}
      <SectionHeader
        title="Budget"
        trailing={
          budgetPercent !== null ? (
            <span className={CELL_SECONDARY}>
              {formatMinutes(totalActualMinutes)}
              <span className="mx-1.5 text-muted-foreground/40">/</span>
              {formatMinutes(totalEstimatedMinutes)}
              <span className="ml-2 font-semibold text-foreground">{Math.round(budgetPercent)}%</span>
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">No estimate set</span>
          )
        }
      />

      {/* Table */}
      {estimates.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className={TABLE_HEAD_ROW}>
              <TableHead className={TABLE_HEAD}>Category</TableHead>
              <TableHead className={TABLE_HEAD}>Estimated</TableHead>
              <TableHead className={TABLE_HEAD}>Actual</TableHead>
              <TableHead className={TABLE_HEAD}>Remaining</TableHead>
              <TableHead className={TABLE_HEAD}>Progress</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activeEstimates.map((row) => (
              <BudgetRow key={row._id} row={row} />
            ))}

            {notStartedEstimates.length > 0 && (
              <>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="px-5 pt-4 pb-1">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50">
                      Not started
                    </span>
                  </TableCell>
                </TableRow>
                {notStartedEstimates.map((row) => (
                  <BudgetRow key={row._id} row={row} muted />
                ))}
              </>
            )}

          </TableBody>
          <TableFooter className={TABLE_FOOTER}>
            <TableRow className="hover:bg-transparent">
              <TableCell className={cn(TABLE_CELL, "font-semibold")}>Total</TableCell>
              <TableCell className={cn(TABLE_CELL, CELL_KEY)}>{formatMinutes(totalEstimatedMinutes)}</TableCell>
              <TableCell className={cn(TABLE_CELL, CELL_KEY)}>{formatMinutes(totalActualMinutes)}</TableCell>
              <TableCell className={cn(TABLE_CELL, CELL_KEY)}>{formatMinutes(totalEstimatedMinutes - totalActualMinutes)}</TableCell>
              <TableCell className={TABLE_CELL}>
                <ProgressCell percent={budgetPercent !== null ? Math.round(budgetPercent) : null} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}

      {/* Unestimated category warning */}
      {unestimatedCategories.length > 0 && (
        <div className={cn("flex items-center gap-3", TABLE_FOOTER, "px-5 py-3")}>
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
    </SectionCard>
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
    <TableRow className={cn(TABLE_ROW, muted && ROW_MUTED)}>
      <TableCell className={cn(TABLE_CELL, muted ? "font-normal" : CELL_PRIMARY)}>{row.categoryName}</TableCell>
      <TableCell className={cn(TABLE_CELL, CELL_SECONDARY)}>{formatMinutes(row.estimatedMinutes)}</TableCell>
      <TableCell className={cn(TABLE_CELL, muted ? CELL_SECONDARY : CELL_KEY)}>{formatMinutes(row.actual)}</TableCell>
      <TableCell className={cn(TABLE_CELL, CELL_SECONDARY)}>{formatMinutes(row.remaining)}</TableCell>
      <TableCell className={TABLE_CELL}>
        <ProgressCell percent={row.pct} muted={muted} />
      </TableCell>
    </TableRow>
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

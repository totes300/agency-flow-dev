"use client"

import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { SectionCard } from "@/components/ui/section-card"
import { SectionHeader } from "@/components/ui/section-header"
import { ProgressCell } from "@/components/ui/progress-cell"
import { Skeleton } from "@/components/ui/skeleton"
import { MonthlyTimeBreakdown, TimeLogSkeleton } from "./monthly-time-breakdown"
import { ProjectSummaryCard } from "./summary/project-summary-card"
import { InfoIcon, AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMinutes } from "@/lib/format"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import {
  CELL_KEY, CELL_PRIMARY, CELL_SECONDARY,
  TABLE_HEAD, TABLE_HEAD_ROW, TABLE_CELL, TABLE_ROW, TABLE_FOOTER,
} from "@/lib/table-tokens"

export function FixedOverview({
  projectId,
  onNavigateToEstimates,
}: {
  projectId: Id<"projects">
  onNavigateToEstimates?: () => void
}) {
  const handleTaskClick = useTaskDetailNav()
  const estimates = useQuery(api.projectCategoryEstimates.list, { projectId })
  const categories = useQuery(api.workCategories.list, { includeArchived: false })
  const overview = useQuery(api.timeEntries.projectOverview, { projectId })
  const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, { projectId })

  const totalEstimatedMinutes = useMemo(() => {
    if (!estimates) return 0
    return estimates.reduce((sum, e) => sum + e.estimatedMinutes, 0)
  }, [estimates])

  const totalActualMinutes = overview?.totalMinutes ?? 0
  const budgetPercent = totalEstimatedMinutes > 0
    ? (totalActualMinutes / totalEstimatedMinutes) * 100
    : null

  const minutesByCategory = overview?.minutesByCategory ?? EMPTY_RECORD

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

  return (
    <div className="flex flex-col gap-6">
      <ProjectSummaryCard projectId={projectId} />

      <Alert>
        <InfoIcon />
        <AlertDescription>
          Fixed-fee projects track delivery against estimated effort and labor cost.
        </AlertDescription>
      </Alert>

      {estimates === undefined ? (
        <BudgetSectionSkeleton />
      ) : (
        <BudgetSection
          estimates={estimates}
          minutesByCategory={minutesByCategory}
          totalEstimatedMinutes={totalEstimatedMinutes}
          totalActualMinutes={totalActualMinutes}
          budgetPercent={budgetPercent}
          unestimatedCategories={unestimatedCategories}
          onNavigateToEstimates={onNavigateToEstimates}
        />
      )}

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
  )
}

function BudgetSectionSkeleton() {
  return (
    <div className="rounded-xl border p-4 flex flex-col gap-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-2.5 w-full rounded-full" />
      <Skeleton className="h-32 w-full" />
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
  const enrichedEstimates = estimates.map((est) => {
    const actual = minutesByCategory[est.workCategoryId?.toString() ?? ""] ?? 0
    const remaining = est.estimatedMinutes - actual
    const pct = est.estimatedMinutes > 0 ? Math.round((actual / est.estimatedMinutes) * 100) : null
    return { ...est, actual, remaining, pct }
  })

  return (
    <SectionCard>
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
            {enrichedEstimates.map((row) => (
              <BudgetRow key={row._id} row={row} />
            ))}
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

      {unestimatedCategories.length > 0 && (
        <div className={cn("flex items-center gap-3", TABLE_FOOTER, "px-5 py-3")}>
          <AlertTriangleIcon className="size-4 shrink-0 text-destructive" />
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
}: {
  row: { _id: string; categoryName: string; estimatedMinutes: number; actual: number; remaining: number; pct: number | null }
}) {
  return (
    <TableRow className={TABLE_ROW}>
      <TableCell className={cn(TABLE_CELL, CELL_PRIMARY)}>{row.categoryName}</TableCell>
      <TableCell className={cn(TABLE_CELL, CELL_SECONDARY)}>{formatMinutes(row.estimatedMinutes)}</TableCell>
      <TableCell className={cn(TABLE_CELL, CELL_KEY)}>{formatMinutes(row.actual)}</TableCell>
      <TableCell className={cn(TABLE_CELL, CELL_SECONDARY)}>{formatMinutes(row.remaining)}</TableCell>
      <TableCell className={TABLE_CELL}>
        <ProgressCell percent={row.pct} />
      </TableCell>
    </TableRow>
  )
}

const EMPTY_RECORD: Record<string, number> = {}


"use client"

import { useState, useMemo } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { getCategoryColor } from "@/convex/lib/constants"
import { TimeLogPlaceholder } from "./time-log-placeholder"
import { formatMinutes, formatCurrencyPrecise, formatShortDate } from "@/lib/format"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────────

type TaskData = {
  taskId: string
  taskTitle: string
  totalMinutes: number
  firstDate: string
  lastDate: string
  entryCount: number
}

type CategoryGroup = {
  workCategoryId: string | null
  categoryName: string
  categoryColor: string
  totalMinutes: number
  totalAmount?: number
  tasks: TaskData[]
}

export type MonthData = {
  month: string
  monthLabel: string
  totalMinutes: number
  totalAmount?: number
  entryCount: number
  taskCount: number
  categoryCount: number
  billableCategoryGroups: CategoryGroup[]
  nonBillableCategoryGroups: CategoryGroup[]
}

type Props = {
  months: MonthData[]
  showAmounts?: boolean
  currency?: string
  onTaskClick: (taskId: string) => void
}

// Column widths — shared between header and data rows for perfect alignment
const COL = {
  status: "w-24",       // Billable / Non-billable tag
  date: "w-20",         // "Mar 23"
  entries: "w-16",      // "2"
  duration: "w-20",     // "01:00"
} as const

// ─── Main Component ─────────────────────────────────────────────────────────────

export function MonthlyTimeBreakdown({
  months,
  showAmounts,
  currency,
  onTaskClick,
}: Props) {
  if (months.length === 0) {
    return <TimeLogPlaceholder />
  }

  return (
    <div className="flex flex-col gap-3">
      {months.map((m, i) => (
        <MonthCard
          key={m.month}
          month={m}
          defaultOpen={i === 0}
          showAmounts={showAmounts}
          currency={currency}
          onTaskClick={onTaskClick}
        />
      ))}
    </div>
  )
}

// ─── Month Card ─────────────────────────────────────────────────────────────────

function MonthCard({
  month: m,
  defaultOpen,
  showAmounts,
  currency,
  onTaskClick,
}: {
  month: MonthData
  defaultOpen: boolean
  showAmounts?: boolean
  currency?: string
  onTaskClick: (taskId: string) => void
}) {
  const [open, setOpen] = useState(defaultOpen)

  const unifiedCategories = useMemo(
    () => mergeCategories(m.billableCategoryGroups, m.nonBillableCategoryGroups),
    [m.billableCategoryGroups, m.nonBillableCategoryGroups],
  )

  const billableMinutes = useMemo(
    () => m.billableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0),
    [m.billableCategoryGroups],
  )
  const nonBillableMinutes = useMemo(
    () => m.nonBillableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0),
    [m.nonBillableCategoryGroups],
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Month trigger */}
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between bg-muted/50 px-5 py-3 text-left transition-colors hover:bg-muted/70">
          <div className="flex items-center gap-2.5">
            {open ? (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold tracking-tight">{m.monthLabel}</span>
            <span className="text-xs text-muted-foreground">
              {m.entryCount} {m.entryCount === 1 ? "entry" : "entries"} · {m.taskCount} {m.taskCount === 1 ? "task" : "tasks"}
            </span>
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatMinutes(m.totalMinutes)}
            {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
              <span className="ml-1.5 text-muted-foreground">
                · {formatCurrencyPrecise(m.totalAmount, currency)}
              </span>
            )}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {/* Column headers */}
          <div
            role="row"
            aria-hidden="true"
            className="flex items-center border-t bg-muted/50 px-5 py-2 text-xs font-medium text-muted-foreground"
          >
            <span className="flex-1">Task</span>
            <span className={cn(COL.status, "text-center")}>Status</span>
            <span className={cn(COL.date, "text-right")}>Date</span>
            <span className={cn(COL.entries, "text-center")}>Entries</span>
            <span className={cn(COL.duration, "text-right")}>Duration</span>
          </div>

          {/* Category groups with task rows */}
          <div role="table" aria-label={`Time entries for ${m.monthLabel}`}>
            {unifiedCategories.map((cat) => (
              <CategorySection
                key={cat.categoryId ?? "uncategorized"}
                category={cat}
                onTaskClick={onTaskClick}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-start border-t bg-muted/50 px-5 py-3">
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Billable</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {formatMinutes(billableMinutes)}
                  {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
                    <span className="ml-1.5 font-semibold text-muted-foreground">
                      · {formatCurrencyPrecise(m.totalAmount, currency)}
                    </span>
                  )}
                </span>
              </div>
              {nonBillableMinutes > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Non-billable</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMinutes(nonBillableMinutes)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

// ─── Category Section ───────────────────────────────────────────────────────────

function CategorySection({
  category: cat,
  onTaskClick,
}: {
  category: UnifiedCategory
  onTaskClick: (taskId: string) => void
}) {
  const c = getCategoryColor(cat.categoryColor)

  return (
    <div role="rowgroup">
      {/* Category header row */}
      <div role="row" className="flex items-center border-t bg-muted/30 px-5 py-2.5">
        <div role="cell" className="flex flex-1 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: c.text }}
          />
          <span className="text-sm font-medium text-muted-foreground">
            {cat.categoryName}
          </span>
          <span className="text-xs text-muted-foreground/50">
            {cat.tasks.length}
          </span>
        </div>
        <span role="cell" className={cn(COL.duration, "text-right font-mono text-sm font-medium tabular-nums text-muted-foreground")}>
          {formatMinutes(cat.totalMinutes)}
        </span>
      </div>

      {/* Task rows */}
      {cat.tasks.map((task) => (
        <div
          key={task.taskId}
          role="row"
          className="flex items-center border-t border-border/40 px-5 py-3 pl-9 transition-colors hover:bg-muted/30"
        >
          <div role="cell" className="flex flex-1 items-center gap-2 overflow-hidden">
            <button
              type="button"
              onClick={() => onTaskClick(task.taskId)}
              className="min-w-0 cursor-pointer truncate rounded-sm text-sm font-medium text-foreground transition-colors hover:text-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1"
            >
              {task.taskTitle}
            </button>
          </div>
          <div role="cell" className={cn(COL.status, "flex items-center justify-center")}>
            {task.isBillable ? (
              <span className="text-xs text-muted-foreground/60">Billable</span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                Non-billable
              </span>
            )}
          </div>
          <span role="cell" className={cn(COL.date, "text-right text-sm tabular-nums text-muted-foreground")}>
            {formatShortDate(task.lastDate)}
          </span>
          <span role="cell" className={cn(COL.entries, "text-center text-sm tabular-nums text-muted-foreground")}>
            {task.entryCount}
          </span>
          <span role="cell" className={cn(COL.duration, "text-right font-mono text-sm font-semibold tabular-nums")}>
            {formatMinutes(task.totalMinutes)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

type UnifiedTask = TaskData & { isBillable: boolean }

type UnifiedCategory = {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  totalMinutes: number
  tasks: UnifiedTask[]
}

/** Merge billable and non-billable category groups into a single unified list. */
function mergeCategories(
  billable: CategoryGroup[],
  nonBillable: CategoryGroup[],
): UnifiedCategory[] {
  const map = new Map<string, UnifiedCategory>()

  for (const cat of billable) {
    const key = cat.workCategoryId ?? "uncategorized"
    map.set(key, {
      categoryId: cat.workCategoryId,
      categoryName: cat.categoryName,
      categoryColor: cat.categoryColor,
      totalMinutes: cat.totalMinutes,
      tasks: cat.tasks.map((t) => ({ ...t, isBillable: true })),
    })
  }

  for (const cat of nonBillable) {
    const key = cat.workCategoryId ?? "uncategorized"
    const existing = map.get(key)
    if (existing) {
      existing.totalMinutes += cat.totalMinutes
      existing.tasks.push(...cat.tasks.map((t) => ({ ...t, isBillable: false })))
    } else {
      map.set(key, {
        categoryId: cat.workCategoryId,
        categoryName: cat.categoryName,
        categoryColor: cat.categoryColor,
        totalMinutes: cat.totalMinutes,
        tasks: cat.tasks.map((t) => ({ ...t, isBillable: false })),
      })
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName))
    .map((cat) => ({
      ...cat,
      tasks: cat.tasks.sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    }))
}

"use client"

import { useMemo, useState } from "react"
import { StatusTag } from "@/components/ui/status-tag"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatMinutes, formatCurrencyPrecise, formatShortDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  CELL_KEY, CELL_PRIMARY, CELL_SECONDARY,
  TABLE_HEAD, TABLE_HEAD_ROW, TABLE_CELL, TABLE_FOOTER,
} from "@/lib/table-tokens"
import { ChevronRightIcon } from "lucide-react"

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
  tasks: TaskData[]
}

type UnifiedTask = TaskData & {
  isBillable: boolean
  billableMinutes: number
  nonBillableMinutes: number
}

type UnifiedCategory = {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  totalMinutes: number
  tasks: UnifiedTask[]
}

// Column widths — shared between header and data rows
const COL = {
  status: "w-24",
  date: "w-20",
  entries: "w-16",
  duration: "w-20",
} as const

// ─── Props ──────────────────────────────────────────────────────────────────────

type MonthTaskTableProps = {
  billableCategoryGroups: CategoryGroup[]
  nonBillableCategoryGroups: CategoryGroup[]
  onTaskClick: (taskId: string) => void
  showAmounts?: boolean
  totalAmount?: number
  currency?: string
  ariaLabel?: string
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export function MonthTaskTable({
  billableCategoryGroups,
  nonBillableCategoryGroups,
  onTaskClick,
  showAmounts,
  totalAmount,
  currency,
  ariaLabel,
}: MonthTaskTableProps) {
  const unifiedCategories = useMemo(
    () => mergeCategories(billableCategoryGroups, nonBillableCategoryGroups),
    [billableCategoryGroups, nonBillableCategoryGroups],
  )

  const billableMinutes = useMemo(
    () => billableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0),
    [billableCategoryGroups],
  )
  const nonBillableMinutes = useMemo(
    () => nonBillableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0),
    [nonBillableCategoryGroups],
  )

  return (
    <div>
      {/* Column headers */}
      <div
        role="row"
        aria-hidden="true"
        className={cn("flex items-center", TABLE_HEAD_ROW, TABLE_HEAD)}
      >
        <span className="flex-1">Task</span>
        <span className={cn(COL.status, "hidden sm:block")}>Status</span>
        <span className={cn(COL.date)}>Date</span>
        <span className={cn(COL.entries, "hidden sm:block")}>Entries</span>
        <span className={cn(COL.duration, "text-right")}>Duration</span>
      </div>

      {/* Category groups with task rows */}
      <div role="table" aria-label={ariaLabel}>
        {unifiedCategories.map((cat) => (
          <CategorySection
            key={cat.categoryId ?? "uncategorized"}
            category={cat}
            onTaskClick={onTaskClick}
          />
        ))}
      </div>

      {/* Footer */}
      <div className={cn("flex items-start", TABLE_FOOTER, TABLE_CELL)}>
        <div className="ml-auto flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-2">
            <span className={CELL_PRIMARY}>Billable</span>
            <span className={cn(CELL_KEY, "text-sm")}>
              {formatMinutes(billableMinutes)}
              {showAmounts && totalAmount != null && totalAmount > 0 && currency && (
                <span className="ml-1.5 font-semibold text-muted-foreground">
                  · {formatCurrencyPrecise(totalAmount, currency)}
                </span>
              )}
            </span>
          </div>
          {nonBillableMinutes > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Non-billable</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatMinutes(nonBillableMinutes)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
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
  const [open, setOpen] = useState(true)

  return (
    <div role="rowgroup" className={cn(open ? "mt-6" : "mt-1", "first:mt-0")}>
      {/* Category header — outside the table grid, acts as a section label */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-1.5 rounded-sm bg-muted/40 px-5 py-1.5 text-left"
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-150",
            open && "rotate-90",
          )}
        />
        <span className="text-[13px] font-semibold text-muted-foreground">
          {cat.categoryName}
        </span>
        <span className={cn("ml-auto", CELL_KEY, "text-sm")}>
          {formatMinutes(cat.totalMinutes)}
        </span>
      </button>

      {/* Task rows */}
      {open && cat.tasks.map((task) => {
        const isMixed = task.billableMinutes > 0 && task.nonBillableMinutes > 0

        return (
          <div
            key={task.taskId}
            role="row"
            className={cn(
              "mx-5 flex items-center border-b border-border/70 pl-[0.625rem] transition-colors hover:bg-muted/50",
              "py-2.5",
            )}
          >
            <div role="cell" className="flex flex-1 items-center gap-2 overflow-hidden">
              <button
                type="button"
                onClick={() => onTaskClick(task.taskId)}
                className={cn(
                  CELL_PRIMARY,
                  "min-w-0 cursor-pointer truncate rounded-sm text-left transition-colors hover:text-foreground/70",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
                )}
              >
                {task.taskTitle}
              </button>
            </div>
            <div role="cell" className={cn(COL.status, "hidden items-center sm:flex")}>
              {isMixed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span><StatusTag variant="mixed" /></span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{formatMinutes(task.billableMinutes)} billable · {formatMinutes(task.nonBillableMinutes)} non-billable</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <StatusTag variant={task.isBillable ? "billable" : "non-billable"} />
              )}
            </div>
            <span role="cell" className={cn(COL.date, "text-xs tabular-nums text-muted-foreground")}>
              {formatShortDate(task.lastDate)}
            </span>
            <span role="cell" className={cn(COL.entries, "hidden text-xs tabular-nums text-muted-foreground sm:block")}>
              {task.entryCount}
            </span>
            <span role="cell" className={cn(COL.duration, "text-right text-xs tabular-nums text-muted-foreground")}>
              {formatMinutes(task.totalMinutes)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ─── Merge Helper ───────────────────────────────────────────────────────────────

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
      tasks: cat.tasks.map((t) => ({
        ...t, isBillable: true,
        billableMinutes: t.totalMinutes, nonBillableMinutes: 0,
      })),
    })
  }

  for (const cat of nonBillable) {
    const key = cat.workCategoryId ?? "uncategorized"
    const existing = map.get(key)
    if (existing) {
      existing.totalMinutes += cat.totalMinutes
      for (const t of cat.tasks) {
        const existingTask = existing.tasks.find((et) => et.taskId === t.taskId)
        if (existingTask) {
          existingTask.isBillable = true
          existingTask.nonBillableMinutes = t.totalMinutes
          existingTask.totalMinutes += t.totalMinutes
          existingTask.entryCount += t.entryCount
          if (t.firstDate < existingTask.firstDate) existingTask.firstDate = t.firstDate
          if (t.lastDate > existingTask.lastDate) existingTask.lastDate = t.lastDate
        } else {
          existing.tasks.push({
            ...t, isBillable: false,
            billableMinutes: 0, nonBillableMinutes: t.totalMinutes,
          })
        }
      }
    } else {
      map.set(key, {
        categoryId: cat.workCategoryId,
        categoryName: cat.categoryName,
        categoryColor: cat.categoryColor,
        totalMinutes: cat.totalMinutes,
        tasks: cat.tasks.map((t) => ({
          ...t, isBillable: false,
          billableMinutes: 0, nonBillableMinutes: t.totalMinutes,
        })),
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

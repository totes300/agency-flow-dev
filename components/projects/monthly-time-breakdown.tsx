"use client"

import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { getCategoryColor } from "@/convex/lib/constants"
import { TimeLogPlaceholder } from "./time-log-placeholder"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"
import { ChevronDownIcon, ChevronRightIcon, DollarSignIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type TaskData = {
  taskId: string
  taskTitle: string
  totalMinutes: number
  firstDate: string
  lastDate: string
  entryCount: number
  isBillable?: boolean
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
  emptyMessage?: string
}

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

  // Merge billable + non-billable into unified category groups with isBillable on each task
  const unifiedCategories = mergeCategories(
    m.billableCategoryGroups,
    m.nonBillableCategoryGroups,
  )

  const billableMinutes = m.billableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0)
  const nonBillableMinutes = m.nonBillableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Month trigger */}
        <CollapsibleTrigger className="flex w-full items-center justify-between bg-muted/50 px-4 py-2.5 text-left transition-colors hover:bg-muted/70">
          <div className="flex items-center gap-2.5">
            {open ? (
              <ChevronDownIcon className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
            )}
            <span className="text-sm font-semibold tracking-tight">{m.monthLabel}</span>
            <span className="text-xs text-muted-foreground">
              {m.entryCount} {m.entryCount === 1 ? "entry" : "entries"} · {m.taskCount} {m.taskCount === 1 ? "task" : "tasks"}
            </span>
          </div>
          <span className="font-mono text-sm font-semibold tabular-nums">
            {formatMinutes(m.totalMinutes)}
            {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
              <span className="ml-1 text-muted-foreground">
                · {formatCurrencyPrecise(m.totalAmount, currency)}
              </span>
            )}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {/* Column headers */}
          <div className="flex items-center border-t bg-muted/50 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="flex-1">Task</span>
            <span className="w-12 text-center">Billable</span>
            <span className="w-16 text-right">Date</span>
            <span className="w-12 text-right">Entries</span>
            <span className="w-[72px] text-right">Duration</span>
          </div>

          {/* Category groups with task rows */}
          {unifiedCategories.map((cat) => (
            <CategorySection
              key={cat.categoryId ?? "uncategorized"}
              category={cat}
              showAmounts={showAmounts}
              currency={currency}
              onTaskClick={onTaskClick}
            />
          ))}

          {/* Footer */}
          <div className="flex items-start border-t bg-muted/50 px-4 py-2.5">
            <div className="ml-auto flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">Billable</span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {formatMinutes(billableMinutes)}
                  {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
                    <span className="ml-1 font-semibold text-muted-foreground">
                      · {formatCurrencyPrecise(m.totalAmount, currency)}
                    </span>
                  )}
                </span>
              </div>
              {nonBillableMinutes > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">Non-billable</span>
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

function CategorySection({
  category: cat,
  showAmounts,
  currency,
  onTaskClick,
}: {
  category: UnifiedCategory
  showAmounts?: boolean
  currency?: string
  onTaskClick: (taskId: string) => void
}) {
  const c = getCategoryColor(cat.categoryColor)

  return (
    <div>
      {/* Category header row */}
      <div className="flex items-center border-t bg-muted/30 px-4 py-1.5">
        <div className="flex flex-1 items-center gap-1.5">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: c.text }}
          />
          <span className="text-xs font-medium text-muted-foreground">
            {cat.categoryName}
          </span>
          <span className="text-[11px] text-muted-foreground/50">
            {cat.tasks.length}
          </span>
        </div>
        <span className="w-[72px] text-right font-mono text-xs font-medium tabular-nums text-muted-foreground">
          {formatMinutes(cat.totalMinutes)}
        </span>
      </div>

      {/* Task rows */}
      {cat.tasks.map((task) => (
        <div
          key={task.taskId}
          className="flex items-center border-t border-border/40 px-4 py-1.5 pl-7"
        >
          <div className="flex flex-1 items-center gap-2 overflow-hidden">
            <button
              type="button"
              onClick={() => onTaskClick(task.taskId)}
              className="min-w-0 truncate text-[13px] text-foreground hover:underline"
            >
              {task.taskTitle}
            </button>
          </div>
          <div className="flex w-12 items-center justify-center">
            <DollarSignIcon
              className={cn(
                "size-3.5",
                task.isBillable ? "text-blue-500" : "text-muted-foreground/30"
              )}
            />
          </div>
          <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
            {formatShortDateCompact(task.lastDate)}
          </span>
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
            {task.entryCount}
          </span>
          <span className="w-[72px] text-right font-mono text-[13px] font-medium tabular-nums">
            {formatMinutes(task.totalMinutes)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

type UnifiedCategory = {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  totalMinutes: number
  tasks: (TaskData & { isBillable: boolean })[]
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

  // Sort categories alphabetically, tasks by lastDate descending
  return Array.from(map.values())
    .sort((a, b) => a.categoryName.localeCompare(b.categoryName))
    .map((cat) => ({
      ...cat,
      tasks: cat.tasks.sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    }))
}

/** Format a date as short "Mar 23" for the compact table column. */
function formatShortDateCompact(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

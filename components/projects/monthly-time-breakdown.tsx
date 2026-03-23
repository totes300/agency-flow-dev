"use client"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { CategoryGroupHeader } from "./category-group-header"
import { TaskTimeRow } from "./task-time-row"
import { TimeLogPlaceholder } from "./time-log-placeholder"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"

type CategoryGroup = {
  workCategoryId: string | null
  categoryName: string
  categoryColor: string
  totalMinutes: number
  totalAmount?: number
  tasks: Array<{
    taskId: string
    taskTitle: string
    totalMinutes: number
    firstDate: string
    lastDate: string
    entryCount: number
  }>
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
  emptyMessage,
}: Props) {
  if (months.length === 0) {
    return <TimeLogPlaceholder />
  }

  const defaultOpen = months[0]?.month

  return (
    <Accordion type="single" collapsible defaultValue={defaultOpen}>
      {months.map((m) => (
        <AccordionItem key={m.month} value={m.month}>
          <AccordionTrigger>
            <div className="flex w-full items-center gap-3 pr-2">
              <span className="font-medium">{m.monthLabel}</span>
              <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
                {formatMinutes(m.totalMinutes)}
                {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
                  <> · {formatCurrencyPrecise(m.totalAmount, currency)}</>
                )}
              </span>
            </div>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-4 pb-2">
              {/* Billable Work */}
              {m.billableCategoryGroups.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Billable Work
                  </p>
                  {m.billableCategoryGroups.map((cat) => (
                    <div key={cat.workCategoryId ?? "uncategorized"}>
                      <CategoryGroupHeader
                        categoryName={cat.categoryName}
                        categoryColor={cat.categoryColor}
                        taskCount={cat.tasks.length}
                        totalMinutes={cat.totalMinutes}
                        totalAmount={showAmounts ? cat.totalAmount : undefined}
                        currency={currency}
                      />
                      {cat.tasks.map((task) => (
                        <TaskTimeRow
                          key={task.taskId}
                          taskId={task.taskId}
                          title={task.taskTitle}
                          firstDate={task.firstDate}
                          lastDate={task.lastDate}
                          totalMinutes={task.totalMinutes}
                          onClick={onTaskClick}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Non-billable Work — muted styling */}
              {m.nonBillableCategoryGroups.length > 0 && (
                <div className="opacity-75">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground/60">
                    Non-billable Work
                  </p>
                  {m.nonBillableCategoryGroups.map((cat) => (
                    <div key={cat.workCategoryId ?? "uncategorized-nb"}>
                      <CategoryGroupHeader
                        categoryName={cat.categoryName}
                        categoryColor={cat.categoryColor}
                        taskCount={cat.tasks.length}
                        totalMinutes={cat.totalMinutes}
                        muted
                      />
                      {cat.tasks.map((task) => (
                        <TaskTimeRow
                          key={task.taskId}
                          taskId={task.taskId}
                          title={task.taskTitle}
                          firstDate={task.firstDate}
                          lastDate={task.lastDate}
                          totalMinutes={task.totalMinutes}
                          onClick={onTaskClick}
                          muted
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <MonthFooter month={m} showAmounts={showAmounts} currency={currency} />
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}

function MonthFooter({
  month: m,
  showAmounts,
  currency,
}: {
  month: MonthData
  showAmounts?: boolean
  currency?: string
}) {
  const billableMinutes = m.billableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0)
  const nonBillableMinutes = m.nonBillableCategoryGroups.reduce((s, c) => s + c.totalMinutes, 0)

  return (
    <div className="border-t pt-2 text-xs text-muted-foreground tabular-nums">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span>
          Billable: {formatMinutes(billableMinutes)}
          {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
            <> · {formatCurrencyPrecise(m.totalAmount, currency)}</>
          )}
        </span>
        {nonBillableMinutes > 0 && (
          <span>Non-billable: {formatMinutes(nonBillableMinutes)}</span>
        )}
      </div>
      <p className="mt-0.5">
        {m.entryCount} {m.entryCount === 1 ? "entry" : "entries"} · {m.taskCount} {m.taskCount === 1 ? "task" : "tasks"} · {m.categoryCount} {m.categoryCount === 1 ? "category" : "categories"}
      </p>
    </div>
  )
}

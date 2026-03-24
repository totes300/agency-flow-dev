"use client"

import { useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { SectionCard } from "@/components/ui/section-card"
import { SectionHeader } from "@/components/ui/section-header"
import { MonthTaskTable } from "./month-task-table"
import { TimeLogPlaceholder } from "./time-log-placeholder"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"
import { CELL_KEY } from "@/lib/table-tokens"

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

  const trailingContent = (
    <span className={CELL_KEY}>
      {formatMinutes(m.totalMinutes)}
      {showAmounts && m.totalAmount != null && m.totalAmount > 0 && currency && (
        <span className="ml-1.5 font-normal text-muted-foreground">
          · {formatCurrencyPrecise(m.totalAmount, currency)}
        </span>
      )}
    </span>
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SectionCard>
        <SectionHeader
          title={m.monthLabel}
          subtitle={`${m.entryCount} ${m.entryCount === 1 ? "entry" : "entries"} · ${m.taskCount} ${m.taskCount === 1 ? "task" : "tasks"}`}
          trailing={trailingContent}
          collapsible
          open={open}
        />

        <CollapsibleContent>
          <MonthTaskTable
            billableCategoryGroups={m.billableCategoryGroups}
            nonBillableCategoryGroups={m.nonBillableCategoryGroups}
            onTaskClick={onTaskClick}
            showAmounts={showAmounts}
            totalAmount={m.totalAmount}
            currency={currency}
            ariaLabel={`Time entries for ${m.monthLabel}`}
          />
        </CollapsibleContent>
      </SectionCard>
    </Collapsible>
  )
}

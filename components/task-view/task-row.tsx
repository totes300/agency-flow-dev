"use client"

import { memo } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { CELL_RENDERERS, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"

/** Shared by the header row and every task row so all tracks line up (U2). */
export const ROW_GRID_CLASS =
  "grid items-center gap-x-3 pl-10 pr-3 [grid-template-columns:var(--task-cols)]"

/**
 * THE task row (docs/prd-tasks-refactor.md §6.2): one CSS grid line per task,
 * one track per visible column from the registry. Clicking the row opens the
 * task; editable cells open their property menu instead. The selection
 * checkbox sits in the left gutter and shows on hover or while a selection
 * exists (prototype v4).
 */
export const TaskRow = memo(function TaskRow({
  row,
  columns,
  ctx,
  isSelected,
  hasSelection,
  isFocused,
  isOpen,
  onToggleSelect,
  onOpen,
}: {
  row: TaskRowModel
  columns: readonly ColumnKey[]
  ctx: CellContext
  isSelected: boolean
  hasSelection: boolean
  isFocused: boolean
  isOpen: boolean
  onToggleSelect: (taskId: Id<"tasks">, opts: { shiftKey: boolean }) => void
  onOpen: (taskId: Id<"tasks">) => void
}) {
  const taskId = row.task._id
  return (
    <div
      role="row"
      aria-selected={isSelected}
      data-task-id={taskId}
      data-focused={isFocused || undefined}
      className={cn(
        ROW_GRID_CLASS,
        "group/row relative h-10 scroll-mt-[72px] scroll-mb-4 border-b border-border/60 text-[13px] transition-colors hover:bg-muted/50",
        isFocused && "bg-muted/70 hover:bg-muted/70",
        (isSelected || isOpen) && "bg-primary/5 hover:bg-primary/[0.07]",
      )}
      onClick={() => onOpen(taskId)}
    >
      <div
        className={cn(
          "absolute top-1/2 left-3 flex -translate-y-1/2 transition-opacity",
          hasSelection || isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100",
        )}
      >
        <Checkbox
          checked={isSelected}
          aria-label={`Select ${row.task.title}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(taskId, { shiftKey: e.shiftKey })
          }}
        />
      </div>
      {columns.map((key) => (
        <div key={key} role="gridcell" data-col={key} className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          {CELL_RENDERERS[key](row, ctx)}
        </div>
      ))}
    </div>
  )
})

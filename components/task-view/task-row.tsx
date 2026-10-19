"use client"

import { memo } from "react"
import { useSortable } from "@dnd-kit/react/sortable"
import type { Id } from "@/convex/_generated/dataModel"
import { Checkbox } from "@/components/ui/checkbox"
import { GripNavIcon } from "@/components/icons/nav-icons"
import { cn } from "@/lib/utils"
import { CELL_RENDERERS, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"

/** Shared by the header row and every task row so all tracks line up (U2). */
export const ROW_GRID_CLASS =
  "grid items-center gap-x-3 pl-10 pr-3 [grid-template-columns:var(--task-cols)]"

/**
 * Compact rows (sub-tasks inside the task detail): no selection checkbox, so
 * the gutter only holds the drag grip; tighter gaps for the narrow column.
 */
export const ROW_GRID_COMPACT_CLASS =
  "grid items-center gap-x-2 pl-6 pr-2 [grid-template-columns:var(--task-cols)]"

/**
 * The left gutter (40px): the drag grip at 10–22px, the selection checkbox at
 * 22–38px. The grip keeps a 10px inner gutter so a drag never starts on the
 * sidebar's rail, which overhangs the inset panel's left edge by ~8px.
 */
export const ROW_GRIP_CLASS = "absolute inset-y-0 left-2.5 w-3"
export const ROW_CHECKBOX_LEFT_CLASS = "left-[22px]"

/**
 * THE task row (docs/prd-tasks-refactor.md §6.2): one CSS grid line per task,
 * one track per visible column from the registry. Clicking the row opens the
 * task; editable cells open their property menu instead. The selection
 * checkbox sits in the left gutter and shows on hover or while a selection
 * exists (prototype v4). In manual order the row is sortable (`SortableTaskRow`)
 * and a quiet grip — always visible — sits at the gutter's edge.
 */
type TaskRowProps = {
  row: TaskRowModel
  columns: readonly ColumnKey[]
  ctx: CellContext
  isSelected: boolean
  hasSelection: boolean
  isFocused: boolean
  isOpen: boolean
  onToggleSelect: (taskId: Id<"tasks">, opts: { shiftKey: boolean }) => void
  onOpen: (taskId: Id<"tasks">) => void
  /** Compact row (task detail sub-tasks): no selection checkbox, narrow gutter. */
  compact?: boolean
}

/** dnd-kit sortable wiring (only on rows in a manual-order list). */
type DragProps = {
  setRowElement?: (element: Element | null) => void
  setHandleElement?: (element: Element | null) => void
  isDragging?: boolean
}

export const TaskRow = memo(function TaskRow(props: TaskRowProps) {
  return <TaskRowView {...props} />
})

/**
 * A row in a manual-order list: dnd-kit sortable inside its group's
 * provider. The grip is the drag source (pointer after 5px, or focus it and
 * use Space + arrows), so clicking anywhere else still opens the task.
 */
export const SortableTaskRow = memo(function SortableTaskRow({
  sortableId,
  index,
  ...props
}: TaskRowProps & { sortableId: string; index: number }) {
  const { ref, handleRef, isDragging } = useSortable({ id: sortableId, index })
  return <TaskRowView {...props} setRowElement={ref} setHandleElement={handleRef} isDragging={isDragging} />
})

function TaskRowView({
  row,
  columns,
  ctx,
  isSelected,
  hasSelection,
  isFocused,
  isOpen,
  onToggleSelect,
  onOpen,
  compact = false,
  setRowElement,
  setHandleElement,
  isDragging = false,
}: TaskRowProps & DragProps) {
  const taskId = row.task._id
  return (
    <div
      ref={setRowElement}
      role="row"
      aria-selected={isSelected}
      data-task-id={taskId}
      data-focused={isFocused || undefined}
      className={cn(
        compact ? ROW_GRID_COMPACT_CLASS : ROW_GRID_CLASS,
        "group/row relative scroll-mt-[72px] scroll-mb-4 border-b border-border/60 text-[13px] transition-colors hover:bg-muted/50",
        compact ? "h-9" : "h-10",
        isFocused && "bg-muted/70 hover:bg-muted/70",
        (isSelected || isOpen) && "bg-primary/5 hover:bg-primary/[0.07]",
        isDragging && "z-[1] bg-background shadow-sm",
      )}
      onClick={() => onOpen(taskId)}
    >
      {setHandleElement ? (
        <button
          ref={setHandleElement}
          type="button"
          aria-label={`Drag to reorder ${row.task.title}`}
          className={cn(
            compact ? "absolute inset-y-0 left-1.5 w-3" : ROW_GRIP_CLASS,
            "flex cursor-grab items-center justify-center text-muted-foreground/40 outline-none hover:text-muted-foreground focus-visible:text-foreground active:cursor-grabbing",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <GripNavIcon size={12} />
        </button>
      ) : null}
      {compact ? null : <div
        className={cn(
          "absolute top-1/2 flex -translate-y-1/2 transition-opacity",
          ROW_CHECKBOX_LEFT_CLASS,
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
      </div>}
      {columns.map((key) => (
        <div
          key={key}
          role="gridcell"
          data-col={key}
          className={cn("flex min-w-0 items-center gap-1.5 overflow-hidden", key === "title" && "@container/title")}
        >
          {CELL_RENDERERS[key](row, ctx)}
        </div>
      ))}
    </div>
  )
}

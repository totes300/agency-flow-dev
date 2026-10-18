"use client"

import { memo } from "react"
import { useDraggable } from "@dnd-kit/react"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import { CELL_RENDERERS, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"

/** Card lines, in order. Only the keys the view shows (and the column does not repeat) render. */
const META_KEYS: readonly ColumnKey[] = ["priority", "labels", "category", "due", "estimate"]
const FOOTER_KEYS: readonly ColumnKey[] = ["client", "assignee", "time"]

export type BoardCardDragData = { taskId: Id<"tasks">; fromKey: string }

/**
 * A board card (prototype v4): the same cell renderers as the table row, laid
 * out as a card. No task ID, and never the column's own property (the
 * registry's U3 rules decide the visible keys). Status shows as an icon
 * before the title unless the board's columns are statuses.
 */
export const BoardCard = memo(function BoardCard({
  row,
  columnKey,
  keys,
  ctx,
  draggable,
  isFocused,
  isOpen,
  onOpen,
}: {
  row: TaskRowModel
  columnKey: string
  /** Visible column keys for the board (already without the grouped property). */
  keys: ReadonlySet<ColumnKey>
  ctx: CellContext
  draggable: boolean
  isFocused: boolean
  isOpen: boolean
  onOpen: (taskId: Id<"tasks">) => void
}) {
  const taskId = row.task._id
  const { ref, isDragging } = useDraggable({
    id: `${columnKey}:${taskId}`,
    data: { taskId, fromKey: columnKey } satisfies BoardCardDragData,
    disabled: !draggable,
  })
  const showStatus = keys.has("status") || keys.has("statusIcon")
  // An empty label list would render an "Add labels" target; cards stay quiet.
  const meta = META_KEYS.filter((k) => keys.has(k) && (k !== "labels" || row.labels.length > 0))
  const footer = FOOTER_KEYS.filter((k) => keys.has(k))

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-task-id={taskId}
      data-focused={isFocused || undefined}
      className={cn(
        "group/card flex cursor-default flex-col gap-2 rounded-lg bg-background px-3 py-2.5 text-[13px] shadow-xs ring-1 ring-border transition-shadow outline-none hover:ring-foreground/20",
        isFocused && "ring-foreground/30",
        isOpen && "ring-primary/40",
        isDragging && "opacity-60",
      )}
      onClick={() => onOpen(taskId)}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        {showStatus && row.status ? <span className="flex h-5 shrink-0 items-center">{CELL_RENDERERS.statusIcon(row, ctx)}</span> : null}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 [&>span.truncate]:line-clamp-2 [&>span.truncate]:whitespace-normal">
          {CELL_RENDERERS.title(row, ctx)}
        </div>
      </div>
      {meta.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden">
          {meta.map((key) => (
            <CardCell key={key} col={key} row={row} ctx={ctx} />
          ))}
        </div>
      ) : null}
      {footer.length > 0 ? (
        <div className="flex min-w-0 items-center gap-2">
          {footer.includes("client") ? (
            <div className="min-w-0 flex-1 truncate">{CELL_RENDERERS.client(row, ctx)}</div>
          ) : (
            <span className="flex-1" />
          )}
          {footer.includes("assignee") ? <CardCell col="assignee" row={row} ctx={ctx} /> : null}
          {footer.includes("time") ? <CardCell col="time" row={row} ctx={ctx} /> : null}
        </div>
      ) : null}
    </div>
  )
})

function CardCell({ col, row, ctx }: { col: ColumnKey; row: TaskRowModel; ctx: CellContext }) {
  const content = CELL_RENDERERS[col](row, ctx)
  if (content === null) return null
  return (
    <div data-col={col} className="flex min-w-0 items-center gap-1.5 [&_button]:ml-0">
      {content}
    </div>
  )
}

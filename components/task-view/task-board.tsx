"use client"

import { Fragment, useMemo, type ReactNode } from "react"
import { DragDropProvider, useDroppable } from "@dnd-kit/react"
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { PlusNavIcon } from "@/components/icons/nav-icons"
import { cn } from "@/lib/utils"
import type { CellContext, ColumnKey } from "@/components/task-view/columns"
import { GroupIcon } from "@/components/task-view/group-header"
import { BoardCard, type BoardCardDragData } from "@/components/task-view/board-card"
import type { TaskGroup, TaskRowModel } from "@/components/task-view/row-model"

/** Pointer (after 5px, so a click still opens the card) and keyboard (focus a card, Space, arrows, Space). */
const BOARD_DRAG_SENSORS = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
  KeyboardSensor,
]

/**
 * The board layout (U6, prototype v4): one column per value of the grouping
 * property, cards in the view's order. Dragging a card to another column
 * changes that property (`onMove`, through the slice-1 mutations); boards
 * the caller may not change are not draggable.
 */
export function TaskBoard({
  columns,
  keys,
  ctx,
  draggable,
  focusedId,
  openId,
  onOpen,
  onMove,
  onCreateInColumn,
  fill = false,
  dividerFor,
  emptyFor,
}: {
  columns: readonly TaskGroup[]
  keys: readonly ColumnKey[]
  ctx: CellContext
  draggable: boolean
  focusedId: Id<"tasks"> | null
  openId: string | null
  onOpen: (taskId: Id<"tasks">) => void
  onMove: (taskId: Id<"tasks">, fromKey: string, toKey: string) => void
  onCreateInColumn: (column: TaskGroup) => (() => void) | undefined
  /** Equal columns across the available width (embedded boards) instead of fixed 19rem tracks. */
  fill?: boolean
  dividerFor?: (column: TaskGroup, row: TaskRowModel) => string | null
  emptyFor?: (column: TaskGroup) => ReactNode
}) {
  const keySet = useMemo(() => new Set(keys), [keys])
  return (
    <DragDropProvider
      sensors={BOARD_DRAG_SENSORS}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source, target } = event.operation
        const data = source?.data as BoardCardDragData | undefined
        if (!data || !target) return
        onMove(data.taskId, data.fromKey, String(target.id))
      }}
    >
      <div className={cn("flex items-start gap-3", fill ? "w-full" : "h-full min-w-min p-3")} role="list" aria-label="Board">
        {columns.map((column) => (
          <BoardColumn
            key={column.key}
            column={column}
            keys={keySet}
            ctx={ctx}
            draggable={draggable}
            focusedId={focusedId}
            openId={openId}
            onOpen={onOpen}
            onCreate={onCreateInColumn(column)}
            fill={fill}
            dividerFor={dividerFor}
            empty={column.rows.length === 0 ? emptyFor?.(column) : undefined}
          />
        ))}
      </div>
    </DragDropProvider>
  )
}

function BoardColumn({
  column,
  keys,
  ctx,
  draggable,
  focusedId,
  openId,
  onOpen,
  onCreate,
  fill,
  dividerFor,
  empty,
}: {
  column: TaskGroup
  keys: ReadonlySet<ColumnKey>
  ctx: CellContext
  draggable: boolean
  focusedId: Id<"tasks"> | null
  openId: string | null
  onOpen: (taskId: Id<"tasks">) => void
  onCreate?: () => void
  fill: boolean
  dividerFor?: (column: TaskGroup, row: TaskRowModel) => string | null
  empty?: ReactNode
}) {
  const { ref, isDropTarget } = useDroppable({ id: column.key, disabled: !draggable })
  return (
    <section
      ref={ref}
      role="listitem"
      aria-label={column.label}
      className={cn(
        "flex max-h-full min-h-60 shrink-0 flex-col gap-2 rounded-2xl bg-muted p-2 transition-colors",
        fill ? "w-[17rem] md:w-auto md:min-w-0 md:flex-1 md:shrink" : "w-[19rem]",
        isDropTarget && "ring-2 ring-primary/25",
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 pr-1 pl-2 text-[13px] font-medium">
        <GroupIcon header={column.header} />
        <span className="min-w-0 truncate">{column.label}</span>
        <span className="font-normal text-muted-foreground tabular-nums">{column.rows.length > 0 ? column.rows.length : null}</span>
        <span className="flex-1" />
        {onCreate ? (
          <Button variant="ghost" size="icon-xs" aria-label={`New task in ${column.label}`} onClick={onCreate}>
            <PlusNavIcon />
          </Button>
        ) : null}
      </header>
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-px">
        {column.rows.map((row) => {
          const divider = dividerFor?.(column, row)
          return (
            <Fragment key={row.task._id}>
              {divider ? <p className="px-1.5 pt-1 text-xs font-medium text-muted-foreground">{divider}</p> : null}
              <BoardCard
                row={row}
                columnKey={column.key}
                keys={keys}
                ctx={ctx}
                draggable={draggable}
                isFocused={focusedId === row.task._id}
                isOpen={openId === row.task._id}
                onOpen={onOpen}
              />
            </Fragment>
          )
        })}
        {empty ? <div className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">{empty}</div> : null}
      </div>
    </section>
  )
}

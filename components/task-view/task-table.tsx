"use client"

import { Fragment, type CSSProperties, type ReactNode } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom"
import type { Id } from "@/convex/_generated/dataModel"
import { Checkbox } from "@/components/ui/checkbox"
import { ChevronDownNavIcon } from "@/components/icons/nav-icons"
import { cn } from "@/lib/utils"
import {
  columnMeta,
  gridTemplateFor,
  tableMinWidthFor,
  type CellContext,
  type ColumnKey,
} from "@/components/task-view/columns"
import type { OrderBy } from "@/components/task-view/column-rules"
import { GroupHeader } from "@/components/task-view/group-header"
import { InlineAddRow } from "@/components/task-view/inline-add-row"
import { ROW_CHECKBOX_LEFT_CLASS, ROW_GRID_CLASS, SortableTaskRow, TaskRow } from "@/components/task-view/task-row"
import type { TaskGroup } from "@/components/task-view/row-model"

/** Same setup as the board: pointer after 5px (a click still opens), keyboard on the focused grip. */
export const LIST_DRAG_SENSORS = [
  PointerSensor.configure({ activationConstraints: [new PointerActivationConstraints.Distance({ value: 5 })] }),
  KeyboardSensor,
]

export type HeaderSelectionState = "none" | "some" | "all"

/**
 * The aligned-column task table (U2, §6.3): a sticky header row, then per
 * group a sticky group header and its rows, all on one CSS grid template
 * built from the column registry. Below the template's minimum width the
 * surrounding panel scrolls horizontally.
 *
 * In manual order (`onReorder` set) each group is its own dnd-kit sortable
 * list — its own `DragDropProvider`, separate from the board's — so a row only
 * moves inside its group and a drop never changes the grouped property. Each
 * group ends with an inline "add task" row when `inlineAdd` returns a handler.
 */
export function TaskTable({
  columns,
  groups,
  grouped,
  orderBy,
  defaultOrderBy,
  onOrderBy,
  isCollapsed,
  onToggleGroup,
  onCreateInGroup,
  ctx,
  isSelected,
  hasSelection,
  headerSelection,
  onToggleAll,
  onToggleSelect,
  focusedId,
  openId,
  onOpen,
  onReorder,
  inlineAdd,
  groupTotal,
}: {
  columns: readonly ColumnKey[]
  groups: readonly TaskGroup[]
  grouped: boolean
  orderBy: OrderBy
  defaultOrderBy: OrderBy
  onOrderBy: (orderBy: OrderBy) => void
  isCollapsed: (groupKey: string) => boolean
  onToggleGroup: (groupKey: string) => void
  /** Returns a "create in this group" handler when the group's value can be prefilled. */
  onCreateInGroup: (group: TaskGroup) => (() => void) | undefined
  ctx: CellContext
  isSelected: (taskId: Id<"tasks">) => boolean
  hasSelection: boolean
  headerSelection: HeaderSelectionState
  onToggleAll: () => void
  onToggleSelect: (taskId: Id<"tasks">, opts: { shiftKey: boolean }) => void
  focusedId: Id<"tasks"> | null
  openId: string | null
  onOpen: (taskId: Id<"tasks">) => void
  /** Drag reorder inside a group (manual order only); null = not offered. */
  onReorder: ((group: TaskGroup, from: number, to: number) => void) | null
  /** The inline add row's create handler for a group, if the group offers one. */
  inlineAdd: (group: TaskGroup) => ((title: string) => void) | undefined
  /** A group's right-aligned total, when the surface shows one. */
  groupTotal?: (group: TaskGroup) => string | undefined
}) {
  const titleColumn = columns.indexOf("title") + 1

  return (
    <TaskGrid columns={columns}>
      <TaskTableHeader
        columns={columns}
        hasSelection={hasSelection}
        headerSelection={headerSelection}
        onToggleAll={onToggleAll}
        orderBy={orderBy}
        defaultOrderBy={defaultOrderBy}
        onOrderBy={onOrderBy}
      />

      {groups.map((group) => {
        const collapsed = grouped && isCollapsed(group.key)
        return (
          <Fragment key={group.key}>
            {grouped ? (
              <GroupHeader
                group={group}
                collapsed={collapsed}
                onToggle={() => onToggleGroup(group.key)}
                onCreate={onCreateInGroup(group)}
                total={groupTotal?.(group)}
              />
            ) : null}
            {collapsed ? null : (
              <GroupRows group={group} onReorder={onReorder}>
                {(row, index) => {
                  const rowProps = {
                    row,
                    columns,
                    ctx,
                    isSelected: isSelected(row.task._id),
                    hasSelection,
                    isFocused: focusedId === row.task._id,
                    isOpen: openId === row.task._id,
                    onToggleSelect,
                    onOpen,
                  }
                  return onReorder ? (
                    <SortableTaskRow
                      key={row.task._id}
                      sortableId={`${group.key}:${row.task._id}`}
                      index={index}
                      {...rowProps}
                    />
                  ) : (
                    <TaskRow key={row.task._id} {...rowProps} />
                  )
                }}
              </GroupRows>
            )}
            {collapsed ? null : <GroupAddRow group={group} titleColumn={titleColumn} inlineAdd={inlineAdd} />}
          </Fragment>
        )
      })}
    </TaskGrid>
  )
}

/** The grid container: one column template (from the registry) for the header and every row. */
export function TaskGrid({
  columns,
  template,
  children,
}: {
  columns: readonly ColumnKey[]
  /** Explicit track template (compact lists such as the detail's sub-tasks); no minimum width. */
  template?: string
  children: ReactNode
}) {
  const style = {
    "--task-cols": template ?? gridTemplateFor(columns),
    minWidth: template ? undefined : tableMinWidthFor(columns),
  } as CSSProperties
  return (
    <div role="grid" aria-label="Tasks" style={style}>
      {children}
    </div>
  )
}

/**
 * The sticky column header row. Sortable headers set the order (clicking the
 * active one goes back to the view's default); without `onOrderBy` the
 * headers are plain labels (a manual-order list such as Today).
 */
export function TaskTableHeader({
  columns,
  hasSelection,
  headerSelection,
  onToggleAll,
  orderBy,
  defaultOrderBy,
  onOrderBy,
}: {
  columns: readonly ColumnKey[]
  hasSelection: boolean
  headerSelection: HeaderSelectionState
  onToggleAll: () => void
  orderBy?: OrderBy
  defaultOrderBy?: OrderBy
  onOrderBy?: (orderBy: OrderBy) => void
}) {
  return (
    <div
      role="row"
      className={cn(
        ROW_GRID_CLASS,
        "sticky top-0 z-[3] h-9 border-b border-border/60 bg-background text-xs text-muted-foreground",
      )}
    >
      {hasSelection ? (
        <div className={cn("absolute top-1/2 flex -translate-y-1/2", ROW_CHECKBOX_LEFT_CLASS)}>
          <Checkbox
            checked={headerSelection === "all" ? true : headerSelection === "some" ? "indeterminate" : false}
            aria-label="Select all visible tasks"
            onClick={onToggleAll}
          />
        </div>
      ) : null}
      {columns.map((key) => {
        const meta = columnMeta(key)
        const sortBy = meta.header && onOrderBy ? meta.sortBy : undefined
        if (!sortBy || !onOrderBy) {
          return (
            <span key={key} role="columnheader" className="truncate">
              {meta.header}
            </span>
          )
        }
        const active = orderBy === sortBy
        return (
          <span key={key} role="columnheader" aria-sort={active ? "other" : "none"} className="min-w-0">
            <button
              type="button"
              className={cn(
                "flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:text-foreground",
                active && "text-foreground",
              )}
              onClick={() => onOrderBy(active ? (defaultOrderBy ?? sortBy) : sortBy)}
            >
              <span className="truncate">{meta.header}</span>
              {active ? <ChevronDownNavIcon size={11} strokeWidth={1.6} /> : null}
            </button>
          </span>
        )
      })}
    </div>
  )
}

/** A group's rows; in manual order wrapped in the group's own sortable provider. */
function GroupRows({
  group,
  onReorder,
  children,
}: {
  group: TaskGroup
  onReorder: ((group: TaskGroup, from: number, to: number) => void) | null
  children: (row: TaskGroup["rows"][number], index: number) => ReactNode
}) {
  const rows = group.rows.map((row, i) => children(row, i))
  if (!onReorder) return <>{rows}</>
  return (
    <DragDropProvider
      sensors={LIST_DRAG_SENSORS}
      onDragEnd={(event) => {
        if (event.canceled) return
        const { source } = event.operation
        if (!isSortable(source)) return
        const { initialIndex, index } = source
        if (initialIndex !== index) onReorder(group, initialIndex, index)
      }}
    >
      {rows}
    </DragDropProvider>
  )
}

function GroupAddRow({
  group,
  titleColumn,
  inlineAdd,
}: {
  group: TaskGroup
  titleColumn: number
  inlineAdd: (group: TaskGroup) => ((title: string) => void) | undefined
}) {
  const onCreate = inlineAdd(group)
  if (!onCreate) return null
  return <InlineAddRow titleColumn={titleColumn} groupLabel={group.label} onCreate={onCreate} />
}

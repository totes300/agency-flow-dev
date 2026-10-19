"use client"

import { useMemo, type CSSProperties } from "react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { InlineAddButton } from "@/components/inline-add-button"
import { PlusNavIcon, SunNavIcon } from "@/components/icons/nav-icons"
import { StatusIcon } from "@/components/icons/status-icon"
import { formatMinutesDisplay } from "@/lib/duration"
import { cn } from "@/lib/utils"
import type { CellContext } from "@/components/task-view/columns"
import { GroupHeaderRow } from "@/components/task-view/group-header"
import type { StatusRef, TaskRowModel } from "@/components/task-view/row-model"
import { LIST_DRAG_SENSORS, TaskGrid, TaskTableHeader, type HeaderSelectionState } from "@/components/task-view/task-table"
import { ROW_GRID_CLASS, SortableTaskRow, TaskRow } from "@/components/task-view/task-row"
import { CarriedOver, type TodayRowProps } from "@/components/my-tasks/carried-over"
import { moveInOrder, todayHeading, type TodaySections } from "@/components/my-tasks/today-model"

/**
 * My Tasks → Today (U8, §5.6; prototype v4): the date and a muted summary,
 * then on one aligned grid (the shared header and row) "Carried over", the
 * Today list in the user's hand-made order and the collapsed "Done today".
 *
 * The Today rows are sortable in their own dnd-kit provider with their own
 * handler: a drop sends the whole new order to `tasks.today.reorderToday`
 * (`planSegments.todaySortKey`, per person), never the global `sortKey`.
 */
export function TodayList({
  today,
  sections,
  ctx,
  rowProps,
  headerSelection,
  onToggleAll,
  collapsed,
  onToggleSection,
  doneStatus,
  trackedTodayMinutes,
  onPick,
  onKeep,
  onKeepAll,
  onRemoveCarried,
  onReorder,
}: {
  today: string
  sections: TodaySections
  ctx: CellContext
  rowProps: TodayRowProps
  headerSelection: HeaderSelectionState
  onToggleAll: () => void
  collapsed: { carried: boolean; done: boolean }
  onToggleSection: (section: "carried" | "done") => void
  /** The org's default completed status (Done today's icon). */
  doneStatus: StatusRef | null
  trackedTodayMinutes: number | undefined
  onPick: () => void
  onKeep: (taskId: Id<"tasks">) => void
  onKeepAll: () => void
  onRemoveCarried: (taskId: Id<"tasks">) => void
  onReorder: (orderedIds: Id<"tasks">[]) => void
}) {
  const { columns } = rowProps
  const titleColumn = columns.indexOf("title") + 1

  // The group header already says Today: rows carry no sun (prototype v4). T or
  // the selection bar takes a task out of today.
  const plainCtx: CellContext = useMemo(() => ({ ...ctx, sun: undefined, titleAccessory: undefined, titleActions: undefined }), [ctx])

  const summary = [
    `${sections.today.length} planned`,
    `${sections.done.length} done`,
    trackedTodayMinutes !== undefined ? `${formatMinutesDisplay(trackedTodayMinutes)} tracked today` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const rowBase = (row: TaskRowModel, rowCtx: CellContext) => ({
    row,
    columns,
    ctx: rowCtx,
    isSelected: rowProps.isSelected(row.task._id),
    hasSelection: rowProps.hasSelection,
    isFocused: rowProps.focusedId === row.task._id,
    isOpen: rowProps.openId === row.task._id,
    onToggleSelect: rowProps.onToggleSelect,
    onOpen: rowProps.onOpen,
  })

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold">{todayHeading(today)}</h2>
        <span className="text-[13px] text-muted-foreground tabular-nums">{summary}</span>
      </div>
      <TaskGrid columns={columns}>
        <TaskTableHeader
          columns={columns}
          hasSelection={rowProps.hasSelection}
          headerSelection={headerSelection}
          onToggleAll={onToggleAll}
        />

        <CarriedOver
          carried={sections.carried}
          today={today}
          ctx={ctx}
          collapsed={collapsed.carried}
          onToggle={() => onToggleSection("carried")}
          onKeep={onKeep}
          onKeepAll={onKeepAll}
          onRemove={onRemoveCarried}
          rowProps={rowProps}
        />

        <GroupHeaderRow label="Today" count={sections.today.length} icon={<SunNavIcon size={14} strokeWidth={1.7} className="text-warning" />}>
          <Button variant="ghost" size="icon-xs" aria-label="Add tasks to today" title="Add tasks (T)" onClick={onPick}>
            <PlusNavIcon />
          </Button>
        </GroupHeaderRow>
        <DragDropProvider
          sensors={LIST_DRAG_SENSORS}
          onDragEnd={(event) => {
            if (event.canceled) return
            const { source } = event.operation
            if (!isSortable(source)) return
            const next = moveInOrder(
              sections.today.map((r) => r.task._id),
              source.initialIndex,
              source.index,
            )
            if (next) onReorder(next)
          }}
        >
          {sections.today.map((row, index) => (
            <SortableTaskRow key={row.task._id} sortableId={`today:${row.task._id}`} index={index} {...rowBase(row, plainCtx)} />
          ))}
        </DragDropProvider>
        <div role="row" className={cn(ROW_GRID_CLASS, "h-10 border-b border-border/60 text-[13px]")}>
          <div role="gridcell" style={{ gridColumnStart: titleColumn } as CSSProperties} className="-ml-2.5 flex min-w-0 items-center">
            <InlineAddButton onClick={onPick} label="Add tasks to today" />
          </div>
        </div>

        <div className="h-4" aria-hidden="true" />
        <GroupHeaderRow
          label="Done today"
          count={sections.done.length}
          icon={doneStatus ? <StatusIcon icon={doneStatus.icon} color={doneStatus.color} /> : null}
          collapsed={collapsed.done}
          onToggle={() => onToggleSection("done")}
        />
        {collapsed.done ? null : sections.done.map((row) => <TaskRow key={row.task._id} {...rowBase(row, plainCtx)} />)}
      </TaskGrid>
    </>
  )
}

"use client"

import { useMemo } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { SunNavIcon } from "@/components/icons/nav-icons"
import type { CellContext, ColumnKey } from "@/components/task-view/columns"
import { GroupHeaderRow } from "@/components/task-view/group-header"
import { TaskRow } from "@/components/task-view/task-row"
import type { TaskRowModel } from "@/components/task-view/row-model"
import { plannedOnLabel, type TodaySections } from "@/components/my-tasks/today-model"

export type TodayRowProps = {
  columns: readonly ColumnKey[]
  isSelected: (taskId: Id<"tasks">) => boolean
  hasSelection: boolean
  focusedId: Id<"tasks"> | null
  openId: string | null
  onToggleSelect: (taskId: Id<"tasks">, opts: { shiftKey: boolean }) => void
  onOpen: (taskId: Id<"tasks">) => void
}

/**
 * "Carried over" (U8, §5.6): tasks planned on an earlier day that are not
 * finished and have nothing planned today. Each row says when it was planned
 * and offers Keep (for today) / Remove, always visible and right-aligned; the
 * header keeps them all. Rows are THE task row; these actions replace the sun.
 */
export function CarriedOver({
  carried,
  today,
  ctx,
  collapsed,
  onToggle,
  onKeep,
  onKeepAll,
  onRemove,
  rowProps,
}: {
  carried: TodaySections["carried"]
  today: string
  ctx: CellContext
  collapsed: boolean
  onToggle: () => void
  onKeep: (taskId: Id<"tasks">) => void
  onKeepAll: () => void
  onRemove: (taskId: Id<"tasks">) => void
  rowProps: TodayRowProps
}) {
  const plannedOnById = useMemo(() => new Map(carried.map((c) => [c.row.task._id, c.plannedOn])), [carried])
  const carriedCtx: CellContext = useMemo(
    () => ({
      ...ctx,
      sun: undefined,
      titleAccessory: undefined,
      // Right-aligned so they line up across rows; the title keeps the slack.
      titleActions: (row: TaskRowModel) => {
        const plannedOn = plannedOnById.get(row.task._id)
        return (
          <span className="flex shrink-0 items-center">
            {plannedOn ? (
              // Dropped first when the Task column is narrow, so Keep / Remove stay whole.
              <span className="mr-1 text-xs whitespace-nowrap text-muted-foreground @max-[24rem]/title:hidden">
                planned {plannedOnLabel(plannedOn, today)}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              title="Keep for today"
              onClick={(e) => {
                e.stopPropagation()
                onKeep(row.task._id)
              }}
            >
              <SunNavIcon data-icon="inline-start" className="text-warning" />
              Keep
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              title="Remove the earlier plan"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(row.task._id)
              }}
            >
              Remove
            </Button>
          </span>
        )
      },
    }),
    [ctx, onKeep, onRemove, plannedOnById, today],
  )

  if (carried.length === 0) return null
  return (
    <>
      <GroupHeaderRow
        label="Carried over"
        count={carried.length}
        note="planned on an earlier day, not finished"
        collapsed={collapsed}
        onToggle={onToggle}
      >
        <Button variant="ghost" size="xs" className="font-normal text-muted-foreground" onClick={onKeepAll}>
          Keep all for today
        </Button>
      </GroupHeaderRow>
      {collapsed
        ? null
        : carried.map(({ row }) => (
            <TaskRow
              key={row.task._id}
              row={row}
              columns={rowProps.columns}
              ctx={carriedCtx}
              isSelected={rowProps.isSelected(row.task._id)}
              hasSelection={rowProps.hasSelection}
              isFocused={rowProps.focusedId === row.task._id}
              isOpen={rowProps.openId === row.task._id}
              onToggleSelect={rowProps.onToggleSelect}
              onOpen={rowProps.onOpen}
            />
          ))}
    </>
  )
}

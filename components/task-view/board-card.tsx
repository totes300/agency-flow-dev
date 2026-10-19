"use client"

import { memo, type ReactNode } from "react"
import { useDraggable } from "@dnd-kit/react"
import type { Id } from "@/convex/_generated/dataModel"
import { PRIORITY, PRIORITY_LABELS } from "@/convex/tasks/model"
import { CategoryBadge } from "@/components/category-badge"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { InlineSubtaskRing } from "@/components/tasks/activity-indicators"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { CalendarNavIcon, CommentNavIcon, SunNavIcon } from "@/components/icons/nav-icons"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { formatHoursShort } from "@/lib/format"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import { AssigneeAvatars, CELL_RENDERERS, formatDue, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"

export type BoardCardDragData = { taskId: Id<"tasks">; fromKey: string }

/** Labels shown as chips before "+N". */
const MAX_CARD_LABELS = 2

/** A property chip: quiet fill, no border, one value each (Notion/Linear card chips). */
function Chip({ className, children, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

/**
 * A board card, laid out like Linear's / Notion's: a vertical stack where
 * every row has one job, generous padding, the title as the largest element.
 *
 *   Arlo Coffee                                   (photos)   ← where + who
 *   ○ Summer campaign landing page redesign                  ← what
 *   [▂▄]  [• Design]  [▢ Oct 21]                             ← properties, one chip each
 *   ▶ 01:30                                        💬 2      ← activity (only when there is any)
 *
 * Only values that are set and visible render; never the column's own
 * property (U3 rules decide `keys`) and no task ID. A task in today leads the
 * chips with the sun. Status shows as an icon
 * before the title unless the columns are statuses.
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
  const { task, perUser } = row
  const taskId = task._id
  const { ref, isDragging } = useDraggable({
    id: `${columnKey}:${taskId}`,
    data: { taskId, fromKey: columnKey } satisfies BoardCardDragData,
    disabled: !draggable,
  })
  const { isRunningOn } = useTimerActions()
  const running = isRunningOn(taskId)

  const client = keys.has("client") ? row.client : null
  const assignees = keys.has("assignee") ? row.assignees : []
  const showStatus = (keys.has("status") || keys.has("statusIcon")) && row.status
  const overdue = !!task.dueDate && !row.isClosed && task.dueDate < ctx.today
  const unread = perUser.unreadComments

  const chips: ReactNode[] = []
  // The sun shows on a card only while the task is in today (a quiet chip that
  // takes it out again); adding happens with T on the focused card or in the detail.
  const sun = ctx.sun?.stateFor(row)
  if (sun?.kind === "on") {
    chips.push(
      <button
        key="today"
        type="button"
        data-menu-anchor="today"
        aria-label={sun.label}
        title={sun.label}
        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-secondary px-2 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={(e) => {
          e.stopPropagation()
          ctx.sun?.toggle(row, sun)
        }}
      >
        <SunNavIcon size={12} strokeWidth={1.8} className="text-warning" />
        Today
      </button>,
    )
  }
  if (keys.has("priority") && task.priority !== PRIORITY.none) {
    chips.push(
      <button
        key="priority"
        type="button"
        data-menu-anchor="priority"
        aria-label={`Priority: ${PRIORITY_LABELS[task.priority]}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={(e) => {
          e.stopPropagation()
          ctx.openMenu("priority", taskId, e.currentTarget)
        }}
      >
        <PriorityIcon priority={task.priority} label={false} />
      </button>,
    )
  }
  if (keys.has("category") && row.workCategory) {
    chips.push(
      <CategoryBadge key="category" name={row.workCategory.name} color={row.workCategory.color} className="h-6 max-w-full truncate rounded-md" />,
    )
  }
  if (keys.has("labels")) {
    for (const label of row.labels.slice(0, MAX_CARD_LABELS)) {
      chips.push(
        <Chip key={label._id}>
          <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(label.color).dot }} />
          <span className="truncate">{label.name}</span>
        </Chip>,
      )
    }
    if (row.labels.length > MAX_CARD_LABELS) {
      chips.push(<Chip key="labels-more" className="tabular-nums">+{row.labels.length - MAX_CARD_LABELS}</Chip>)
    }
  }
  if (keys.has("due") && task.dueDate) {
    chips.push(
      <Chip key="due" className={cn("tabular-nums", overdue && "text-destructive")}>
        <CalendarNavIcon size={12} className="shrink-0" />
        {formatDue(task.dueDate, ctx.today)}
      </Chip>,
    )
  }
  if (keys.has("estimate") && task.estimateMinutes) {
    chips.push(<Chip key="estimate" className="tabular-nums">{formatHoursShort(task.estimateMinutes)}</Chip>)
  }
  if (task.subtaskCount > 0) {
    chips.push(
      <Chip key="subtasks" className="tabular-nums" aria-label={`${task.subtaskDoneCount} of ${task.subtaskCount} sub-tasks done`}>
        <InlineSubtaskRing done={task.subtaskDoneCount} total={task.subtaskCount} isUnseen={false} />
        {task.subtaskDoneCount}/{task.subtaskCount}
      </Chip>,
    )
  }

  const showTime = keys.has("time") && (task.trackedMinutes > 0 || running)
  const showComments = task.commentCount > 0 || unread > 0

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-task-id={taskId}
      data-focused={isFocused || undefined}
      className={cn(
        "flex cursor-default flex-col gap-2.5 rounded-xl bg-background p-3.5 ring-1 ring-border transition-[box-shadow,opacity] outline-none",
        "shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] hover:shadow-[0_2px_6px_-1px_rgb(0_0_0/0.08)]",
        isFocused && "ring-foreground/25",
        isOpen && "ring-primary/40",
        isDragging && "opacity-60",
      )}
      onClick={() => onOpen(taskId)}
    >
      {client || assignees.length > 0 ? (
        <div className="-mb-1 flex h-5 min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{client?.name ?? ""}</span>
          {assignees.length > 0 ? <AssigneeAvatars assignees={assignees} className="shrink-0" /> : null}
        </div>
      ) : null}

      <div className="flex min-w-0 items-start gap-2">
        {showStatus ? <span className="flex h-5 shrink-0 items-center">{CELL_RENDERERS.statusIcon(row, ctx)}</span> : null}
        <span className="line-clamp-3 min-w-0 flex-1 text-sm leading-5 font-medium">
          {perUser.hasUnseenChanges ? (
            <span className="mr-1.5 mb-px inline-block size-1.5 rounded-full bg-primary align-middle" aria-label="Updated since you last opened it" />
          ) : null}
          {task.title}
        </span>
      </div>

      {chips.length > 0 ? <div className="flex min-w-0 flex-wrap items-center gap-1.5">{chips}</div> : null}

      {showTime || showComments ? (
        <div className="flex h-5 items-center gap-3 text-xs text-muted-foreground">
          {showTime ? (
            <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
              <InlineTimeCell taskId={taskId} totalMinutes={task.trackedMinutes} isDone={row.isClosed} isBillable={task.billable} />
            </span>
          ) : null}
          <span className="flex-1" />
          {showComments ? (
            <span
              className={cn("flex items-center gap-1 tabular-nums", unread > 0 && "font-medium text-destructive")}
              aria-label={unread > 0 ? `${unread} new comments since your last visit` : `${task.commentCount} comments`}
            >
              <CommentNavIcon size={13} strokeWidth={unread > 0 ? 1.8 : 1.4} />
              {unread > 0 ? unread : task.commentCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

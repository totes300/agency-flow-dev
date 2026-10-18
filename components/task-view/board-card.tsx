"use client"

import { memo, type ReactNode } from "react"
import { useDraggable } from "@dnd-kit/react"
import type { Id } from "@/convex/_generated/dataModel"
import { PRIORITY } from "@/convex/tasks/model"
import { CategoryBadge } from "@/components/category-badge"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { InlineSubtaskRing } from "@/components/tasks/activity-indicators"
import { CalendarNavIcon, CommentNavIcon } from "@/components/icons/nav-icons"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { formatHoursShort } from "@/lib/format"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import { AssigneeAvatars, CELL_RENDERERS, formatDue, type CellContext, type ColumnKey } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"

export type BoardCardDragData = { taskId: Id<"tasks">; fromKey: string }

/** Labels shown on a card before "+N". */
const MAX_CARD_LABELS = 2

/**
 * A board card, Linear-style: two calm lines.
 *
 *   ○ Title that may wrap to two lines              (avatars)
 *   ▂▄  • Category  Client  Due (wraps)      💬 2   01:30
 *
 * Line 1 is the status icon (unless the columns ARE statuses), the title and
 * the assignee photos. Line 2 is one row of muted metadata — only values that
 * are set, never the column's own property (the registry's U3 rules decide
 * `keys`), no task ID. No filled pills: category and labels are a colour dot
 * plus muted text; priority shows only when set; tracked time shows when
 * there is some (or the timer runs), the play control appears on hover.
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

  const showStatus = (keys.has("status") || keys.has("statusIcon")) && row.status
  const overdue = !!task.dueDate && !row.isClosed && task.dueDate < ctx.today
  const unread = perUser.unreadComments

  // Line 2, left: only what is set and visible.
  const meta: ReactNode[] = []
  if (keys.has("priority") && task.priority !== PRIORITY.none) {
    meta.push(<span key="priority" className="-mx-1 flex">{CELL_RENDERERS.priority(row, ctx)}</span>)
  }
  if (keys.has("category") && row.workCategory) {
    meta.push(<CategoryBadge key="category" variant="plain" name={row.workCategory.name} color={row.workCategory.color} className="shrink-0" />)
  }
  if (keys.has("labels") && row.labels.length > 0) {
    meta.push(
      <span key="labels" className="flex shrink-0 items-center gap-2">
        {row.labels.slice(0, MAX_CARD_LABELS).map((label) => (
          <span key={label._id} className="flex min-w-0 items-center gap-1.5">
            <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(label.color).dot }} />
            <span className="truncate">{label.name}</span>
          </span>
        ))}
        {row.labels.length > MAX_CARD_LABELS ? <span className="tabular-nums">+{row.labels.length - MAX_CARD_LABELS}</span> : null}
      </span>,
    )
  }
  if (keys.has("client") && row.client) {
    meta.push(<span key="client" className="shrink-0 truncate">{row.client.name}</span>)
  }
  if (keys.has("due") && task.dueDate) {
    meta.push(
      <span key="due" className={cn("flex shrink-0 items-center gap-1 tabular-nums", overdue && "text-destructive")}>
        <CalendarNavIcon size={12} className="opacity-70" />
        {formatDue(task.dueDate, ctx.today)}
      </span>,
    )
  }
  if (keys.has("estimate") && task.estimateMinutes) {
    meta.push(<span key="estimate" className="shrink-0 tabular-nums">{formatHoursShort(task.estimateMinutes)}</span>)
  }
  if (task.subtaskCount > 0) {
    meta.push(
      <span key="subtasks" className="flex shrink-0 items-center gap-1 tabular-nums" aria-label={`${task.subtaskDoneCount} of ${task.subtaskCount} sub-tasks done`}>
        <InlineSubtaskRing done={task.subtaskDoneCount} total={task.subtaskCount} isUnseen={false} />
        {task.subtaskDoneCount}/{task.subtaskCount}
      </span>,
    )
  }

  const showComments = task.commentCount > 0 || unread > 0
  const showTime = keys.has("time") && (task.trackedMinutes > 0 || running || !row.isClosed)
  const timeAlwaysVisible = task.trackedMinutes > 0 || running

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      data-task-id={taskId}
      data-focused={isFocused || undefined}
      className={cn(
        "group/card flex cursor-default flex-col gap-2 rounded-lg bg-background px-3 py-2.5 text-[13px] ring-1 ring-border/80 transition-[box-shadow,opacity] outline-none",
        "shadow-[0_1px_2px_0_rgb(0_0_0/0.03)] hover:ring-foreground/15",
        isFocused && "ring-foreground/25",
        isOpen && "ring-primary/40",
        isDragging && "opacity-60",
      )}
      onClick={() => onOpen(taskId)}
    >
      <div className="flex min-w-0 items-start gap-2">
        {showStatus ? <span className="-ml-0.5 flex h-[18px] shrink-0 items-center">{CELL_RENDERERS.statusIcon(row, ctx)}</span> : null}
        <span className="line-clamp-2 min-w-0 flex-1 leading-[18px] font-medium">
          {perUser.hasUnseenChanges ? (
            <span className="mr-1.5 mb-px inline-block size-1.5 rounded-full bg-primary align-middle" aria-label="Updated since you last opened it" />
          ) : null}
          {task.title}
        </span>
        {keys.has("assignee") && row.assignees.length > 0 ? (
          <AssigneeAvatars assignees={row.assignees} className="shrink-0 [&_[data-slot=avatar]]:size-[18px]" />
        ) : null}
      </div>

      {meta.length > 0 || showComments || showTime ? (
        <div className="flex min-h-5 min-w-0 items-end gap-2.5 text-xs text-muted-foreground">
          {/* Values wrap instead of truncating to stubs; comments + time stay bottom-right. */}
          <div className="flex min-h-5 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1 [&>*]:max-w-[10rem]">{meta}</div>
          {showComments ? (
            <span
              className={cn("flex h-5 shrink-0 items-center gap-1 tabular-nums", unread > 0 && "font-medium text-destructive")}
              aria-label={unread > 0 ? `${unread} new comments since your last visit` : `${task.commentCount} comments`}
            >
              <CommentNavIcon size={13} strokeWidth={unread > 0 ? 1.8 : 1.4} />
              {unread > 0 ? unread : task.commentCount}
            </span>
          ) : null}
          {showTime ? (
            <span
              className={cn(
                "flex h-5 shrink-0 items-center transition-opacity",
                !timeAlwaysVisible && "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <InlineTimeCell taskId={taskId} totalMinutes={task.trackedMinutes} isDone={row.isClosed} isBillable={task.billable} align="end" />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})

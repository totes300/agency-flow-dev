"use client"

import { memo } from "react"
import { AlertTriangleIcon, CalendarIcon } from "lucide-react"
import { CompletionCheckbox } from "./completion-checkbox"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { CommentPill } from "@/components/tasks/activity-indicators"
import { getCategoryColor } from "@/convex/lib/constants"
import { CommentHoverPopover } from "@/components/tasks/comment-hover-popover"
import { cn } from "@/lib/utils"
import { getClientDisplayName } from "@/lib/format"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { Id } from "@/convex/_generated/dataModel"

function isOverdue(dueDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10)
  return dueDate < today
}

function formatDueDate(dueDate: string): string {
  const d = new Date(dueDate + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export const MyTaskRow = memo(function MyTaskRow({
  task,
  totalMinutes,
  activity,
  isCompletedToday,
  onOpenDetail,
  onComplete,
  defaultStatusId,
  isDetailOpen,
}: {
  task: TaskWithJoins
  totalMinutes?: number
  activity?: ActivityIndicator
  isCompletedToday?: boolean
  onOpenDetail?: (taskId: string) => void
  onComplete?: (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => void
  defaultStatusId?: Id<"statuses">
  isDetailOpen?: boolean
}) {
  const isCompleted = isCompletedToday ?? false
  const hasMetadata = task.project || task.dueDate || task.category
  const hasUnseen = activity?.hasUnseen ?? false
  const minutes = totalMinutes ?? 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail?.(task._id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpenDetail?.(task._id)
        }
      }}
      className={cn(
        "group/row relative flex w-full flex-col px-3 py-2.5 text-left transition-colors",
        "after:pointer-events-none after:absolute after:bottom-0 after:left-3 after:right-3 after:border-b after:border-border/40 after:content-['']",
        "cursor-pointer",
        isDetailOpen && "bg-muted/40",
      )}
    >
      <div className="grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5">
        {/* Checkbox — fixed */}
        <div className="col-start-1 row-start-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <CompletionCheckbox
            isSubmitted={isCompleted}
            defaultStatusId={defaultStatusId}
            onComplete={(statusId, coords) => onComplete?.(task._id, statusId, coords)}
          />
        </div>

        {/* Title — fills remaining space */}
        <div className="col-start-2 row-start-1 flex min-w-0 items-center gap-1.5">
          {hasUnseen && !isCompleted && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <span className={cn("truncate text-sm font-medium", isCompleted && "line-through text-muted-foreground/60")}>
            {task.title}
          </span>
        </div>

        {/* Right columns — fixed widths, always present */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Comments column — fixed width (hidden for completed tasks) */}
          <div className="flex w-14 items-center justify-end">
            {!isCompleted && activity && activity.commentCount > 0 ? (
              <CommentHoverPopover
                taskId={task._id as Id<"tasks">}
                totalCount={activity.commentCount}
                onOpenDetail={onOpenDetail}
              >
                <CommentPill
                  count={activity.commentCount}
                  unreadCount={activity.unreadCommentCount}
                  hasUnseen={activity.hasUnseenComments}
                />
              </CommentHoverPopover>
            ) : null}
          </div>

          {/* Timer column — fixed width */}
          <div className="flex w-[88px] items-center justify-end gap-1">
            <InlineTimeCell
              taskId={task._id}
              totalMinutes={minutes}
              isDone={isCompleted}
              isBillable={task.billable}
              align="end"
            />
          </div>
        </div>

        {/* Metadata row — starts under the title column and doesn't affect divider placement */}
        {hasMetadata && (
          <div className="col-start-2 col-end-4 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {task.project && (
              <span className="truncate">
                {task.client ? `${getClientDisplayName(task.client)} · ` : ""}
                {task.project.name}
              </span>
            )}

            {task.category && (
              <span className="flex shrink-0 items-center gap-1">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: getCategoryColor(task.category.color).dot }}
                />
                {task.category.name}
              </span>
            )}

            {task.dueDate && (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  !isCompleted && isOverdue(task.dueDate) && "text-red-500 font-medium",
                )}
              >
                {!isCompleted && isOverdue(task.dueDate) ? (
                  <AlertTriangleIcon className="size-3 shrink-0" />
                ) : (
                  <CalendarIcon className="size-3 shrink-0" />
                )}
                {formatDueDate(task.dueDate)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

"use client"

import { memo } from "react"
import { FolderIcon, AlertTriangleIcon } from "lucide-react"
import { CompletionCheckbox } from "./completion-checkbox"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { StatusBadge } from "@/components/status-badge"
import { CommentPill } from "@/components/tasks/activity-indicators"
import { CommentHoverPopover } from "@/components/tasks/comment-hover-popover"
import { cn } from "@/lib/utils"
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
  onComplete?: (taskId: string, statusId: Id<"statuses">) => void
  defaultStatusId?: Id<"statuses">
  isDetailOpen?: boolean
}) {
  const isCompleted = isCompletedToday ?? false
  const hasMetadata = task.project || task.dueDate || (isCompleted && task.status)
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
        "group/row flex w-full items-start gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition-colors",
        "hover:bg-muted/50 cursor-pointer",
        isDetailOpen && "bg-muted/40",
        isCompleted && "opacity-50",
      )}
    >
      {/* Checkbox — fixed */}
      <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <CompletionCheckbox
          isSubmitted={isCompleted}
          defaultStatusId={defaultStatusId}
          onComplete={(statusId) => onComplete?.(task._id, statusId)}
        />
      </div>

      {/* Title + metadata — fills remaining space */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          {hasUnseen && !isCompleted && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <span
            className={cn(
              "truncate text-sm font-medium",
              isCompleted && "line-through",
            )}
          >
            {task.title}
          </span>
        </div>

        {hasMetadata && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground/60">
            {task.project && (
              <span className="flex items-center gap-1 truncate">
                <FolderIcon className="size-3 shrink-0" />
                {task.client ? `${task.client.name} · ` : ""}
                {task.project.name}
              </span>
            )}

            {task.dueDate && !isCompleted && (
              <span
                className={cn(
                  "shrink-0",
                  isOverdue(task.dueDate) && "text-red-500 font-medium",
                )}
              >
                {isOverdue(task.dueDate) && (
                  <AlertTriangleIcon className="mr-0.5 inline size-3" />
                )}
                {formatDueDate(task.dueDate)}
              </span>
            )}

            {/* Completed today: show destination status */}
            {isCompleted && task.status && (
              <StatusBadge
                name={task.status.name}
                color={task.status.color}
                type={task.status.type}
                variant="inline"
              />
            )}
          </div>
        )}
      </div>

      {/* Right columns — fixed widths, always present */}
      <div className="mt-0.5 flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* Comments column — fixed width */}
        <div className="flex w-14 items-center justify-end">
          {activity && activity.commentCount > 0 ? (
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
        <div className="flex w-16 items-center justify-end gap-1">
          <InlineTimeCell
            taskId={task._id}
            totalMinutes={minutes}
            isDone={isCompleted}
            isBillable={task.billable}
            align="end"
          />
        </div>
      </div>
    </div>
  )
})

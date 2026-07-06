"use client"

import { memo } from "react"
import { AlertTriangleIcon, CalendarIcon } from "lucide-react"
import { CompletionCheckbox } from "./completion-checkbox"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { CommentPill } from "@/components/tasks/activity-indicators"
import { getCategoryColor } from "@/convex/lib/constants"
import { CommentHoverPopover } from "@/components/tasks/comment-hover-popover"
import { StatusBadge } from "@/components/status-badge"
import { UserAvatar } from "@/components/user-avatar"
import { AddToTodayButton } from "@/components/add-to-today-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getClientDisplayName } from "@/lib/format"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { Id } from "@/convex/_generated/dataModel"

function isOverdue(dueDate: string): boolean {
  const today = new Date().toLocaleDateString("en-CA") // YYYY-MM-DD in local timezone
  return dueDate < today
}

function formatDueDate(dueDate: string): string {
  const d = new Date(dueDate + "T00:00:00")
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

/**
 * Quiet assignment-mismatch indicator for Today rows: the plan wins over
 * assignment, so a task planned for me but assigned elsewhere shows the
 * actual assignee's dimmed avatar (dashed empty circle when unassigned).
 */
function AssignmentMismatchIndicator({ assignees }: { assignees: TaskWithJoins["assignees"] }) {
  const assignee = assignees[0]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center">
          {assignee ? (
            <UserAvatar
              name={assignee.name}
              imageUrl={assignee.imageUrl}
              size="sm"
              className="size-5 opacity-50"
            />
          ) : (
            <span className="size-5 rounded-full border border-dashed border-muted-foreground/40" />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {assignee
          ? `Assigned to ${assignee.name} — planned for you today`
          : "Unassigned — planned for you today"}
      </TooltipContent>
    </Tooltip>
  )
}

export const MyTaskRow = memo(function MyTaskRow({
  task,
  totalMinutes,
  activity,
  isCompletedToday,
  isTodayRow,
  currentUserId,
  onOpenDetail,
  onComplete,
  defaultStatusId,
  isDetailOpen,
}: {
  task: TaskWithJoins
  totalMinutes?: number
  activity?: ActivityIndicator
  isCompletedToday?: boolean
  /** Row rendered inside the derived Today group (status badge + mismatch indicator). */
  isTodayRow?: boolean
  currentUserId?: Id<"users">
  onOpenDetail?: (taskId: string) => void
  onComplete?: (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => void
  defaultStatusId?: Id<"statuses">
  isDetailOpen?: boolean
}) {
  const isCompleted = isCompletedToday ?? false
  const showStatusBadge = (isTodayRow ?? false) && task.status !== null
  const assignmentMismatch =
    (isTodayRow ?? false) &&
    currentUserId !== undefined &&
    !task.assigneeIds.includes(currentUserId)
  const hasMetadata = task.project || task.dueDate || task.category || showStatusBadge
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
          {hasUnseen && !isCompleted ? (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          ) : null}
          <span className={cn("truncate text-sm font-medium", isCompleted && "line-through text-muted-foreground/60")}>
            {task.title}
          </span>
        </div>

        {/* Right columns — fixed widths, always present */}
        <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Sun gesture: add on status-group rows, remove (filled) on Today rows */}
          {!isCompleted ? (
            <AddToTodayButton taskId={task._id as Id<"tasks">} inToday={isTodayRow ?? false} />
          ) : null}

          {/* Assignment mismatch — Today rows where the plan wins over assignment */}
          {assignmentMismatch ? (
            <AssignmentMismatchIndicator assignees={task.assignees} />
          ) : null}

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
        {hasMetadata ? (
          <div className="col-start-2 col-end-4 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            {/* Status badge on Today rows — plan membership and workflow state are independent facts */}
            {showStatusBadge && task.status ? (
              <StatusBadge
                name={task.status.name}
                color={task.status.color}
                type={task.status.type}
                className="shrink-0"
              />
            ) : null}

            {task.project ? (
              <span className="truncate">
                {task.client ? `${getClientDisplayName(task.client)} · ` : ""}
                {task.project.name}
              </span>
            ) : null}

            {task.category ? (
              <span className="flex shrink-0 items-center gap-1">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: getCategoryColor(task.category.color).dot }}
                />
                {task.category.name}
              </span>
            ) : null}

            {task.dueDate ? (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1",
                  !isCompleted && isOverdue(task.dueDate) && "text-destructive font-medium",
                )}
              >
                {!isCompleted && isOverdue(task.dueDate) ? (
                  <AlertTriangleIcon className="size-3 shrink-0" />
                ) : (
                  <CalendarIcon className="size-3 shrink-0" />
                )}
                {formatDueDate(task.dueDate)}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})

"use client"

import { memo } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"
import { formatRelativeTime, formatShortDate, isOverdue } from "@/lib/format"
import { formatActivitySubtitle } from "@/lib/format-activity-subtitle"
import { Checkbox } from "@/components/ui/checkbox"
import { TASK_GRID_COLS } from "@/components/tasks/tasks-table"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { RowActionMenu } from "@/components/row-action-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { toastError } from "@/lib/toast-helpers"
import {
  CopyIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  MessageCircleIcon,
  FileTextIcon,
} from "lucide-react"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { ActivityHoverPopover } from "@/components/tasks/activity-hover-popover"
import { DescriptionHoverPopover } from "@/components/tasks/description-hover-popover"
import { SubtaskHoverPopover } from "@/components/tasks/subtask-hover-popover"
import { CommentHoverPopover } from "@/components/tasks/comment-hover-popover"
import type { TaskWithJoins } from "@/components/tasks/tasks-table"
import type { Id } from "@/convex/_generated/dataModel"

export type ActivityIndicator = {
  subtaskTotal: number
  subtaskDone: number
  commentCount: number
  hasDescription: boolean
  hasUnseenNonComment: boolean
  hasUnseenSubtasks: boolean
  hasUnseenComments: boolean
  hasUnseenDescription: boolean
  hasUnseen: boolean
  unreadCommentCount: number
  lastActivity: {
    userName: string
    type: string
    metadata: Record<string, unknown>
    createdAt: number
  } | null
}

export const TaskRow = memo(function TaskRow({
  task,
  isAdmin,
  isSelected,
  hasSelection,
  onSelect,
  onArchive,
  onRestore,
  onDelete,
  onOpenDetail,
  totalMinutes = 0,
  activity,
  isArchivedView = false,
}: {
  task: TaskWithJoins
  isAdmin: boolean
  isSelected: boolean
  hasSelection: boolean
  onSelect: (taskId: string, selected: boolean) => void
  onArchive: (taskId: string) => void
  onRestore?: (taskId: string) => void
  onDelete: (taskId: string) => void
  onOpenDetail?: (taskId: string) => void
  totalMinutes?: number
  activity?: ActivityIndicator
  isArchivedView?: boolean
}) {
  const duplicateTask = useMutation(api.tasks.duplicate)
  const isDone = task.statusType === "done"
  const overdue = isOverdue(task.dueDate)

  const hasUnseen = activity?.hasUnseen ?? false
  const hasDescription = activity?.hasDescription ?? false

  // Subtitle: last activity or "Created . Xm ago" fallback
  const subtitle = activity?.lastActivity
    ? formatActivitySubtitle(activity.lastActivity)
    : `Created \u00b7 ${formatRelativeTime(task.createdAt)}`

  return (
    <div
      className={cn(
        `group/row grid ${TASK_GRID_COLS} items-center gap-x-4 border-b border-border/40 px-3 py-2.5 transition-colors hover:bg-muted/30 [&>*]:min-w-0 [&>*]:overflow-hidden`,
        isSelected && "bg-primary/5",
        isDone && "opacity-50",
      )}
    >
      {/* 1. Checkbox — hidden until row hover or selection active */}
      <div className={cn(
        "flex items-center justify-center transition-opacity",
        hasSelection || isSelected || isDone ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
      )}>
        <Checkbox
          checked={isDone || isSelected}
          onCheckedChange={() => onSelect(task._id, !isSelected)}
          onClick={(e) => e.stopPropagation()}
          disabled={isDone}
          aria-label={isDone ? `${task.title} (done)` : `Select ${task.title}`}
          className={cn(isDone && "border-emerald-600 bg-emerald-600 text-white data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500 dark:data-[state=checked]:border-emerald-500 dark:data-[state=checked]:bg-emerald-500")}
        />
      </div>

      {/* 2. Task name + subtitle */}
      <ActivityHoverPopover taskId={task._id as Id<"tasks">} onOpenDetail={onOpenDetail}>
        <div
          className="cursor-pointer"
          onClick={() => onOpenDetail?.(task._id)}
        >
          <div className="flex items-center gap-1.5">
            {hasUnseen && (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" />
            )}
            <span className={cn(
              "truncate text-sm transition-colors hover:text-primary",
              isDone && "line-through",
              hasUnseen ? "font-semibold" : "font-normal",
            )}>
              {task.title}
            </span>
            {hasDescription && (
              <DescriptionHoverPopover
                description={task.description}
                taskId={task._id}
                onOpenDetail={onOpenDetail}
              >
                <span>
                  <FileTextIcon
                    className={cn(
                      "size-3 shrink-0",
                      hasUnseen ? "opacity-45" : "opacity-30",
                    )}
                  />
                </span>
              </DescriptionHoverPopover>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {subtitle}
          </div>
        </div>
      </ActivityHoverPopover>

      {/* 3. Activity indicators */}
      {activity ? (
        <div className="flex items-center gap-2.5 text-muted-foreground/80">
          {activity.subtaskTotal > 0 ? (
            <SubtaskHoverPopover
              taskId={task._id as Id<"tasks">}
              done={activity.subtaskDone}
              total={activity.subtaskTotal}
              onOpenDetail={onOpenDetail}
            >
              <div>
                <SubtaskRing
                  done={activity.subtaskDone}
                  total={activity.subtaskTotal}
                  isUnseen={activity.hasUnseenSubtasks}
                />
              </div>
            </SubtaskHoverPopover>
          ) : (
            <SubtaskRing
              done={activity.subtaskDone}
              total={activity.subtaskTotal}
              isUnseen={activity.hasUnseenSubtasks}
            />
          )}
          {activity.commentCount > 0 ? (
            <CommentHoverPopover
              taskId={task._id as Id<"tasks">}
              onOpenDetail={onOpenDetail}
            >
              <div>
                <CommentIndicator
                  count={activity.commentCount}
                  unreadCount={activity.unreadCommentCount}
                  isUnseen={activity.hasUnseenComments}
                />
              </div>
            </CommentHoverPopover>
          ) : (
            <CommentIndicator
              count={activity.commentCount}
              unreadCount={activity.unreadCommentCount}
              isUnseen={activity.hasUnseenComments}
            />
          )}
        </div>
      ) : (
        <div className="flex w-[96px] items-center gap-2.5">
          <div className="size-3.5 rounded-full bg-muted/30" />
          <div className="h-3 w-8 rounded bg-muted/30" />
        </div>
      )}

      {/* 4. Status (inline edit) */}
      <InlineStatusCell taskId={task._id} status={task.status} isAdmin={isAdmin} />

      {/* 5. Category (inline edit) */}
      <InlineCategoryCell taskId={task._id} category={task.category} />

      {/* 6. Client / Project (inline edit) */}
      <InlineProjectCell
        taskId={task._id}
        project={task.project}
        client={task.client}
      />

      {/* 7. Assignee (inline edit) */}
      <InlineAssigneeCell taskId={task._id} assignees={task.assignees} />

      {/* 8. Due date (inline edit) */}
      <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={overdue} />

      {/* 9. Time */}
      <InlineTimeCell taskId={task._id} totalMinutes={totalMinutes} isDone={isDone} isBillable={task.billable} />

      {/* 10. Action menu */}
      <RowActionMenu>
        {isArchivedView ? (
          <>
            <DropdownMenuItem onClick={() => onRestore?.(task._id)}>
              <ArchiveRestoreIcon className="size-4" />
              Restore
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(task._id)}
                >
                  <Trash2Icon className="size-4" />
                  Delete permanently
                </DropdownMenuItem>
              </>
            )}
          </>
        ) : (
          <>
            <DropdownMenuItem
              onClick={async () => {
                try { await duplicateTask({ id: task._id }) } catch (err) { toastError(err, "Failed to duplicate task") }
              }}
            >
              <CopyIcon className="size-4" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onArchive(task._id)}>
              <ArchiveIcon className="size-4" />
              Archive
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(task._id)}
                >
                  <Trash2Icon className="size-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </RowActionMenu>
    </div>
  )
})

function SubtaskRing({ done, total, isUnseen }: { done: number; total: number; isUnseen: boolean }) {
  if (total === 0) return null
  const circumference = 2 * Math.PI * 6.5
  const progress = done / total
  const offset = circumference * (1 - progress)

  return (
    <div className="flex items-center gap-1">
      <svg width={14} height={14} viewBox="0 0 16 16">
        <circle
          cx={8} cy={8} r={6.5}
          fill="none"
          stroke={isUnseen ? "color-mix(in srgb, var(--primary) 15%, transparent)" : "var(--border)"}
          strokeWidth={1.75}
        />
        <circle
          cx={8} cy={8} r={6.5}
          fill="none"
          className={isUnseen ? "stroke-primary opacity-60" : "stroke-muted-foreground"}
          strokeWidth={1.75}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
      <span className={cn(
        "text-[10px] tabular-nums",
        isUnseen ? "font-semibold text-primary" : "text-muted-foreground/80",
      )}>
        {done}<span className="opacity-40">/{total}</span>
      </span>
    </div>
  )
}

function CommentIndicator({ count, unreadCount, isUnseen }: { count: number; unreadCount: number; isUnseen: boolean }) {
  if (count === 0) return null

  return (
    <div className="flex items-center gap-1">
      <MessageCircleIcon
        className={cn(
          "size-[13px] shrink-0",
          isUnseen ? "stroke-primary opacity-70" : "stroke-muted-foreground/80",
        )}
        strokeWidth={isUnseen ? 2.25 : 1.75}
      />
      {isUnseen ? (
        <span className="inline-flex items-center h-3.5 px-1 rounded-full bg-primary/[0.06] text-[9px] font-semibold text-primary">
          {unreadCount}
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/80">{count}</span>
      )}
    </div>
  )
}

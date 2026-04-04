"use client"

import { memo } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"
import { formatRelativeTime, isOverdue } from "@/lib/format"
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
import { TaskPreviewPopover } from "@/components/tasks/task-preview-popover"
import { SubtaskHoverPopover } from "@/components/tasks/subtask-hover-popover"
import { CommentHoverPopover } from "@/components/tasks/comment-hover-popover"
import { CommentPill, InlineSubtaskRing } from "@/components/tasks/activity-indicators"
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
  isDetailOpen = false,
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
  isDetailOpen?: boolean
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
      data-task-id={task._id}
      className={cn(
        "group/row relative border-b border-border/55 transition-colors",
        "before:pointer-events-none before:absolute before:inset-y-0 before:-left-13 before:w-13 before:transition-colors",
        "hover:bg-muted/[0.38] hover:before:bg-muted/[0.38]",
        isSelected && "bg-primary/5 before:bg-primary/5",
        isDetailOpen && "bg-accent/50 before:bg-accent/50 before:border-l-2 before:border-l-primary",
      )}
    >
      {/* Checkbox — positioned in left margin, hidden until row hover or selection active */}
      <div className={cn(
        "absolute -left-7 top-0 bottom-0 flex w-4 items-center transition-opacity",
        hasSelection || isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
      )}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect(task._id, !isSelected)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${task.title}`}
        />
      </div>

      <div className={`grid ${TASK_GRID_COLS} items-center gap-x-6 pr-3 py-2.5 [&>*]:min-w-0 [&>*]:overflow-hidden`}>
      {/* 1. Task name + subtitle + inline icons */}
      <button
        type="button"
        className="cursor-pointer text-left"
        onClick={() => onOpenDetail?.(task._id)}
      >
        <div className="flex items-center gap-1.5">
          {hasUnseen && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <TaskPreviewPopover
            taskId={task._id as Id<"tasks">}
            description={task.description}
            updatedAt={task.updatedAt}
            onOpenDetail={onOpenDetail}
          >
            <span className={cn(
              "truncate text-sm font-medium",
            )}>
              {task.title}
            </span>
          </TaskPreviewPopover>
          {hasDescription && (
            <TaskPreviewPopover
              taskId={task._id as Id<"tasks">}
              description={task.description}
              updatedAt={task.updatedAt}
              onOpenDetail={onOpenDetail}
            >
              <span className="shrink-0 rounded p-0.5 transition-colors hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                <FileTextIcon
                  className={cn(
                    "size-[13px]",
                    hasUnseen ? "opacity-45" : "opacity-30",
                  )}
                />
              </span>
            </TaskPreviewPopover>
          )}
          {activity && activity.subtaskTotal > 0 && (
            <SubtaskHoverPopover
              taskId={task._id as Id<"tasks">}
              done={activity.subtaskDone}
              total={activity.subtaskTotal}
              onOpenDetail={onOpenDetail}
            >
              <span className="shrink-0 rounded p-0.5 transition-colors hover:bg-muted" onClick={(e) => e.stopPropagation()}>
                <InlineSubtaskRing
                  done={activity.subtaskDone}
                  total={activity.subtaskTotal}
                  isUnseen={activity.hasUnseenSubtasks}
                />
              </span>
            </SubtaskHoverPopover>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground/85">
          {subtitle}
        </div>
      </button>

      {/* 3. Comments */}
      {activity ? (
        activity.commentCount > 0 ? (
          <CommentHoverPopover
            taskId={task._id as Id<"tasks">}
            totalCount={activity.commentCount}
            onOpenDetail={onOpenDetail}
          >
            <div className="flex items-center justify-center">
              <CommentPill
                count={activity.commentCount}
                unreadCount={activity.unreadCommentCount}
                hasUnseen={activity.hasUnseenComments}
              />
            </div>
          </CommentHoverPopover>
        ) : (
          <div />
        )
      ) : (
        <div className="flex items-center justify-center">
          <div className="h-[22px] w-10 rounded-full bg-muted/30 animate-pulse" />
        </div>
      )}

      {/* 4. Status (inline edit) */}
      <InlineStatusCell taskId={task._id} status={task.status} isAdmin={isAdmin} />

      {/* 5. Category (inline edit) */}
      <InlineCategoryCell taskId={task._id} category={task.category} emptyLabel="Add" />

      {/* 6. Client / Project (inline edit) */}
      <InlineProjectCell
        taskId={task._id}
        project={task.project}
        client={task.client}
        emptyLabel="Add"
      />

      {/* 7. Assignee (inline edit) */}
      <div className="min-w-0">
        <InlineAssigneeCell taskId={task._id} assignees={task.assignees} emptyLabel="Add" />
      </div>

      {/* 8. Due date (inline edit) */}
      <div className="min-w-0">
        <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={overdue} emptyLabel="Add" />
      </div>

      {/* 9. Time */}
      <div className="min-w-0">
        <InlineTimeCell taskId={task._id} totalMinutes={totalMinutes} isDone={isDone} isBillable={task.billable} />
      </div>

      {/* 10. Action menu */}
      <div className={cn(
        "flex justify-end transition-opacity",
        hasSelection || isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
      )}>
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
      </div>
    </div>
  )
})


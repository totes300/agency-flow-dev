"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"
import { formatRelativeTime, formatShortDate, isOverdue } from "@/lib/format"
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
  ListChecksIcon,
  MessageSquareIcon,
  FileTextIcon,
} from "lucide-react"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import type { TaskWithJoins } from "@/components/tasks/tasks-table"

export type ActivityIndicator = {
  subtaskTotal: number
  subtaskDone: number
  commentCount: number
  hasAttachments: boolean
}

export function TaskRow({
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

  return (
    <div
      className={cn(
        `group/row grid ${TASK_GRID_COLS} items-center gap-x-4 border-b border-border/40 px-3 py-2 transition-colors hover:bg-muted/30 [&>*]:min-w-0 [&>*]:overflow-hidden`,
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
          className={cn(isDone && "border-green-600 bg-green-600 text-white data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600")}
        />
      </div>

      {/* 2. Task name + subtitle */}
      <div
        className="cursor-pointer"
        onClick={() => onOpenDetail?.(task._id)}
      >
        <div className={cn("truncate text-sm font-medium hover:text-primary transition-colors", isDone && "line-through")}>
          {task.title}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {task.createdBy ? "Created · " : ""}{formatRelativeTime(task.updatedAt)}
        </div>
      </div>

      {/* 3. Activity indicators */}
      <ActivityIcons activity={activity} hasDescription={!!task.description} />

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
}

function ActivityIcons({ activity, hasDescription }: { activity?: ActivityIndicator; hasDescription: boolean }) {
  const subtaskTotal = activity?.subtaskTotal ?? 0
  const subtaskDone = activity?.subtaskDone ?? 0
  const commentCount = activity?.commentCount ?? 0
  const hasAttachments = activity?.hasAttachments ?? false

  return (
    <div className="flex items-center gap-2 text-muted-foreground/70">
      {/* Subtask progress */}
      {subtaskTotal > 0 && (
        <span className="flex items-center gap-0.5 text-[11px]" title={`${subtaskDone}/${subtaskTotal} subtasks`}>
          <ListChecksIcon className="size-3 shrink-0" />
          <span>{subtaskDone}/{subtaskTotal}</span>
        </span>
      )}
      {/* Comment count */}
      {commentCount > 0 && (
        <span className="flex items-center gap-0.5 text-[11px]" title={`${commentCount} comments`}>
          <MessageSquareIcon className="size-3 shrink-0" />
          <span>{commentCount}</span>
        </span>
      )}
      {/* Description/attachment icon */}
      {(hasDescription || hasAttachments) && (
        <span title={hasAttachments ? "Has attachments" : "Has description"}>
          <FileTextIcon className="size-3 shrink-0" />
        </span>
      )}
    </div>
  )
}


"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"
import { formatRelativeTime, formatShortDate } from "@/lib/format"
import { Checkbox } from "@/components/ui/checkbox"
import { TASK_GRID_COLS } from "@/components/tasks/tasks-table"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { RowActionMenu } from "@/components/row-action-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import {
  CheckIcon,
  CopyIcon,
  ArchiveIcon,
  Trash2Icon,
  PlayIcon,
  CalendarIcon,
  ListChecksIcon,
  MessageSquareIcon,
  FileTextIcon,
} from "lucide-react"
import type { TaskWithJoins } from "@/components/tasks/tasks-table"

export function TaskRow({
  task,
  isAdmin,
  isSelected,
  hasSelection,
  onSelect,
  onArchive,
  onDelete,
}: {
  task: TaskWithJoins
  isAdmin: boolean
  isSelected: boolean
  hasSelection: boolean
  onSelect: (taskId: string, selected: boolean) => void
  onArchive: (taskId: string) => void
  onDelete: (taskId: string) => void
}) {
  const duplicateTask = useMutation(api.tasks.duplicate)
  const isDone = task.statusType === "done"

  const isOverdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10)

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
          aria-label={`Select ${task.title}`}
          className={cn(isDone && "border-green-600 bg-green-600 text-white data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600")}
        />
      </div>

      {/* 2. Task name + subtitle */}
      <div>
        <div className={cn("truncate text-sm font-medium", isDone && "line-through")}>
          {task.title}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">
          {task.createdBy ? "Created" : ""} · {formatRelativeTime(task.updatedAt)}
        </div>
      </div>

      {/* 3. Activity (mock — wired to real data in Phase 6) */}
      <ActivityIcons title={task.title} hasDescription={!!task.description} />

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
      <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={!!isOverdue} />

      {/* 9. Time (mock) */}
      <div className="flex items-center">
        <button className="text-muted-foreground/50 hover:text-muted-foreground">
          <PlayIcon className="size-3.5" />
        </button>
      </div>

      {/* 10. Action menu */}
      <RowActionMenu>
        <DropdownMenuItem
          onClick={async () => {
            try { await duplicateTask({ id: task._id }) } catch { /* toast in future */ }
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
      </RowActionMenu>
    </div>
  )
}

/**
 * Mock activity indicators — subtask progress, comment count, description icon.
 * Uses a simple hash of the title to generate deterministic mock data.
 * Will be replaced with real data from subtask/comment queries in Phase 6.
 */
function ActivityIcons({ title, hasDescription }: { title: string; hasDescription: boolean }) {
  // Deterministic mock from title hash
  const hash = simpleHash(title)
  const totalSubs = (hash % 8) + 1      // 1-8 subtasks
  const doneSubs = hash % (totalSubs + 1) // 0-total done
  const comments = (hash >> 3) % 10      // 0-9 comments
  const hasAttachment = hash % 3 === 0

  return (
    <div className="flex items-center gap-2 text-muted-foreground/70">
      {/* Subtask progress */}
      <span className="flex items-center gap-0.5 text-[11px]" title={`${doneSubs}/${totalSubs} subtasks`}>
        <ListChecksIcon className="size-3 shrink-0" />
        <span>{doneSubs}/{totalSubs}</span>
      </span>
      {/* Comment count */}
      {comments > 0 && (
        <span className="flex items-center gap-0.5 text-[11px]" title={`${comments} comments`}>
          <MessageSquareIcon className="size-3 shrink-0" />
          <span>{comments}</span>
        </span>
      )}
      {/* Description/attachment icon */}
      {(hasDescription || hasAttachment) && (
        <span title="Has description">
          <FileTextIcon className="size-3 shrink-0" />
        </span>
      )}
    </div>
  )
}

function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}


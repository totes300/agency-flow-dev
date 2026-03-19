"use client"

import { useSortable } from "@dnd-kit/react/sortable"
import { cn } from "@/lib/utils"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { RowActionMenu } from "@/components/row-action-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { isOverdue } from "@/lib/format"
import { GripVerticalIcon, ArchiveIcon, Trash2Icon } from "lucide-react"
import type { Doc, Id } from "@/convex/_generated/dataModel"

import { SUBTASK_GRID_COLS } from "@/components/tasks/subtask-constants"

export type SubtaskData = {
  _id: Id<"tasks">
  title: string
  statusType: string
  billable: boolean
  dueDate?: string
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type"> | null
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
  totalMinutes: number
}

export function SubtaskRow({
  subtask,
  index,
  isAdmin,
  onOpenDetail,
  onArchive,
  onDelete,
}: {
  subtask: SubtaskData
  index: number
  isAdmin: boolean
  onOpenDetail: (taskId: string) => void
  onArchive: (taskId: string) => void
  onDelete: (taskId: string) => void
}) {
  const { ref, isDragging } = useSortable({
    id: subtask._id,
    index,
  })

  const isDone = subtask.statusType === "done"
  const overdue = isOverdue(subtask.dueDate)

  return (
    <div
      ref={ref}
      className={cn(
        `group/row grid ${SUBTASK_GRID_COLS} items-center gap-x-3 border-b border-border/30 px-2 py-1.5 transition-colors hover:bg-muted/30 [&>*]:min-w-0 [&>*]:overflow-hidden`,
        isDragging && "opacity-50 bg-muted/30 z-10",
        isDone && "opacity-50",
      )}
    >
      {/* 1. Drag handle */}
      <div className="flex cursor-grab items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-40">
        <GripVerticalIcon className="size-3.5 text-muted-foreground" />
      </div>

      {/* 2. Task name */}
      <div
        className="cursor-pointer"
        onClick={() => onOpenDetail(subtask._id)}
      >
        <div className={cn("truncate text-sm font-medium hover:text-primary transition-colors", isDone && "line-through")}>
          {subtask.title}
        </div>
      </div>

      {/* 3. Status */}
      <InlineStatusCell taskId={subtask._id} status={subtask.status} isAdmin={isAdmin} />

      {/* 4. Category */}
      <InlineCategoryCell taskId={subtask._id} category={subtask.category} />

      {/* 5. Assignee */}
      <InlineAssigneeCell taskId={subtask._id} assignees={subtask.assignees} />

      {/* 6. Due date */}
      <InlineDueDateCell taskId={subtask._id} dueDate={subtask.dueDate ?? null} isOverdue={overdue} />

      {/* 7. Time */}
      <InlineTimeCell taskId={subtask._id} totalMinutes={subtask.totalMinutes} isDone={isDone} isBillable={subtask.billable} />

      {/* 8. Action menu */}
      <RowActionMenu>
        <DropdownMenuItem onClick={() => onArchive(subtask._id)}>
          <ArchiveIcon className="size-4" />
          Archive
        </DropdownMenuItem>
        {isAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onDelete(subtask._id)}
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

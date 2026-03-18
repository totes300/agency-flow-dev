"use client"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { CalendarIcon } from "lucide-react"
import { formatRelativeTime, formatShortDate, isOverdue, firstName } from "@/lib/format"
import type { TaskWithJoins } from "@/components/tasks/tasks-table"

export function TaskCard({
  task,
  isSelected,
  hasSelection,
  onSelect,
}: {
  task: TaskWithJoins
  isSelected: boolean
  hasSelection: boolean
  onSelect: (taskId: string, selected: boolean) => void
}) {
  const isDone = task.statusType === "done"
  const overdue = isOverdue(task.dueDate)

  return (
    <div
      className={cn(
        "flex gap-3 border-b border-border/40 px-4 py-3 transition-colors",
        isSelected && "bg-primary/5",
        isDone && "opacity-50",
      )}
    >
      {/* Checkbox */}
      <div className={cn(
        "pt-0.5 transition-opacity",
        hasSelection || isSelected || isDone ? "opacity-100" : "opacity-0",
      )}>
        <Checkbox
          checked={isDone || isSelected}
          onCheckedChange={() => onSelect(task._id, !isSelected)}
          disabled={isDone}
          className={cn(isDone && !isSelected && "border-green-600 bg-green-600 text-white data-[state=checked]:border-green-600 data-[state=checked]:bg-green-600")}
        />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Title */}
        <div className={cn("text-sm font-medium", isDone && "line-through")}>
          {task.title}
        </div>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {task.status && (
            <StatusBadge name={task.status.name} color={task.status.color} />
          )}
          {task.category && (
            <CategoryBadge name={task.category.name} color={task.category.color} />
          )}
        </div>

        {/* Project + Assignee + Due */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {task.client && task.project && (
            <span className="truncate">
              {task.client.name} · {task.project.name}
            </span>
          )}
          {task.assignees.length > 0 && (
            <span className="flex items-center gap-1">
              <UserAvatar
                name={task.assignees[0].name}
                imageUrl={task.assignees[0].imageUrl}
                className="size-4 text-[7px]"
              />
              {firstName(task.assignees[0].name)}
              {task.assignees.length > 1 && ` +${task.assignees.length - 1}`}
            </span>
          )}
          {task.dueDate && (
            <span className={cn("flex items-center gap-0.5", overdue && "font-medium text-destructive")}>
              <CalendarIcon className="size-3" />
              {overdue ? "Overdue" : formatShortDate(task.dueDate)}
            </span>
          )}
        </div>

        {/* Subtitle */}
        <div className="text-[11px] text-muted-foreground/60">
          {formatRelativeTime(task.updatedAt)}
        </div>
      </div>
    </div>
  )
}

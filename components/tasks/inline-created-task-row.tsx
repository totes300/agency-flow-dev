"use client"

import { AlertCircleIcon, CheckCircle2Icon, LoaderIcon, PlusIcon, XIcon } from "lucide-react"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { TASK_GRID_COLS } from "@/components/tasks/tasks-table"
import { cn } from "@/lib/utils"
import { formatRelativeTime, formatShortDate, firstName } from "@/lib/format"
import type { Doc, Id } from "@/convex/_generated/dataModel"

type StatusPick = Pick<Doc<"statuses">, "_id" | "name" | "color" | "type">
type CategoryPick = Pick<Doc<"workCategories">, "_id" | "name" | "color">
type ProjectPick = Pick<Doc<"projects">, "_id" | "name" | "code">
type ClientPick = Pick<Doc<"clients">, "_id" | "name">
type UserPick = Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">

export type InlineCreatedTask = {
  localId: string
  groupKey: string
  title: string
  createdAt: number
  status: StatusPick | null
  category: CategoryPick | null
  project: ProjectPick | null
  client: ClientPick | null
  assignees: UserPick[]
  dueDate: string | null
  serverId?: Id<"tasks">
  saveState: "saving" | "saved" | "error"
}

export function InlineCreatedTaskRow({
  task,
  onDismiss,
  onRetry,
}: {
  task: InlineCreatedTask
  onDismiss?: (localId: string) => void
  onRetry?: (draft: InlineCreatedTask) => void
}) {
  return (
    <div
      className={cn(
        `group/row grid ${TASK_GRID_COLS} items-center gap-x-6 border-b border-border/40 px-3 py-2.5 [&>*]:min-w-0 [&>*]:overflow-hidden`,
        task.saveState === "error" && "bg-red-500/5",
      )}
    >
      <div />

      <div>
        <div className="flex items-center gap-1.5">
          <PlusIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
          <span className="truncate text-sm">{task.title}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {task.saveState === "saving" ? (
            <>
              <LoaderIcon className="size-3 animate-spin" />
              <span>Saving...</span>
            </>
          ) : task.saveState === "error" ? (
            <>
              <AlertCircleIcon className="size-3 text-red-500" />
              <span className="text-red-600">Failed to save</span>
              {onRetry && (
                <>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => onRetry(task)}
                    className="font-medium text-red-600 underline-offset-2 hover:underline"
                  >
                    Retry
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <CheckCircle2Icon className="size-3 text-emerald-600" />
              <span>Created</span>
            </>
          )}
          <span>·</span>
          <span>{formatRelativeTime(task.createdAt)}</span>
        </div>
      </div>

      <div />

      <div className="flex items-center py-0.5">
        {task.status ? (
          <StatusBadge name={task.status.name} color={task.status.color} type={task.status.type} />
        ) : null}
      </div>

      <div className="flex items-center py-0.5">
        {task.category ? (
          <CategoryBadge name={task.category.name} color={task.category.color} />
        ) : null}
      </div>

      <div className="min-w-0 py-0.5 text-left">
        {task.project ? (
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{task.client?.name}</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground/60">{task.project.name}</div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center py-0.5">
        {task.assignees.length === 0 ? null : task.assignees.length === 1 ? (
          <span className="flex items-center gap-1.5">
            <UserAvatar name={task.assignees[0].name} imageUrl={task.assignees[0].imageUrl} size="sm" />
            <span className="truncate text-[11px] text-muted-foreground">
              {firstName(task.assignees[0].name)}
            </span>
          </span>
        ) : (
          <AvatarGroup className="[&_[data-slot=avatar]]:relative [&_[data-slot=avatar]]:z-0">
            {task.assignees.slice(0, 3).map((assignee) => (
              <span key={assignee._id}>
                <UserAvatar name={assignee.name} imageUrl={assignee.imageUrl} size="sm" />
              </span>
            ))}
            {task.assignees.length > 3 && (
              <AvatarGroupCount>
                <span className="text-xs">+{task.assignees.length - 3}</span>
              </AvatarGroupCount>
            )}
          </AvatarGroup>
        )}
      </div>

      <div className="py-0.5 text-xs text-muted-foreground">
        {task.dueDate ? formatShortDate(task.dueDate) : null}
      </div>

      <div className="text-right" />
      <div className="flex items-center justify-center">
        {task.saveState === "error" && onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(task.localId)}
            className="rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="Dismiss failed task"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

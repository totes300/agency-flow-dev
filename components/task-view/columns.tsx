"use client"

import type { ReactNode } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { PRIORITY_LABELS } from "@/convex/tasks/model"
import { Button } from "@/components/ui/button"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { CommentPill, InlineSubtaskRing } from "@/components/tasks/activity-indicators"
import { StatusIcon } from "@/components/icons/status-icon"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { CalendarNavIcon, NoAssigneeNavIcon } from "@/components/icons/nav-icons"
import { firstName, formatHoursShort, formatRelativeTime, formatShortDate } from "@/lib/format"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import type { ColumnKey } from "@/components/task-view/column-rules"
import type { PropertyMenuKind } from "@/components/task-view/property-menus"
import type { MemberRef, TaskRowModel } from "@/components/task-view/row-model"

export {
  COLUMNS,
  columnMeta,
  gridTemplateFor,
  tableMinWidthFor,
  visibleColumnKeys,
  type ColumnKey,
  type ColumnMeta,
} from "@/components/task-view/column-rules"

/**
 * Column registry — cell renderers (docs/prd-tasks-refactor.md §6.3, §6.4).
 * Metadata and the U3 visibility rules live in `column-rules.ts`. In-row
 * visuals reuse the design system: `CategoryBadge` (the tinted dot pill),
 * `ColoredPillBadge` for labels, `UserAvatar` photos, the existing
 * `InlineTimeCell`, `CommentPill` and `InlineSubtaskRing` from the old row,
 * shadcn `Button` for the editable cells. Numbers are plain tabular text.
 */

export type CellContext = {
  /** Today in the client's calendar (YYYY-MM-DD), for overdue / "Today". */
  today: string
  openMenu: (kind: PropertyMenuKind, taskId: Id<"tasks">, anchor: HTMLElement) => void
  memberById: ReadonlyMap<Id<"users">, MemberRef>
}

type CellRenderer = (row: TaskRowModel, ctx: CellContext) => ReactNode

/** Marks the element a keyboard shortcut anchors its menu to. */
const menuAnchor = (kind: PropertyMenuKind) => ({ "data-menu-anchor": kind })

function menuClick(ctx: CellContext, kind: PropertyMenuKind, taskId: Id<"tasks">) {
  return (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    ctx.openMenu(kind, taskId, e.currentTarget)
  }
}

/** "Today" or a short date (Due date cell, board card). */
export function formatDue(date: string, today: string): string {
  return date === today ? "Today" : formatShortDate(date)
}

function ymdOf(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ACTIVITY_VERBS: Record<string, string> = {
  task_created: "created the task",
  title_changed: "renamed the task",
  description_changed: "updated the description",
  status_changed: "changed status",
  priority_changed: "changed priority",
  assignee_added: "assigned someone",
  assignee_removed: "unassigned someone",
  label_added: "added a label",
  label_removed: "removed a label",
  due_date_changed: "changed the due date",
  start_date_changed: "changed the start date",
  estimate_changed: "changed the estimate",
  project_changed: "moved the task",
  category_changed: "changed the category",
  billable_changed: "changed billable",
  comment_added: "commented",
  comment_resolved: "resolved a comment",
  comment_reopened: "reopened a comment",
  subtask_created: "added a sub-task",
  subtask_completed: "completed a sub-task",
  subtask_deleted: "deleted a sub-task",
  time_entry_logged: "logged time",
  time_entry_deleted: "deleted time",
  task_archived: "archived the task",
  task_restored: "restored the task",
}

function AssigneeStack({ assignees }: { assignees: MemberRef[] }) {
  if (assignees.length === 0) {
    return <NoAssigneeNavIcon className="text-muted-foreground/60" aria-label="No assignee" />
  }
  if (assignees.length === 1) {
    const [member] = assignees
    return (
      <>
        <UserAvatar name={member.name} imageUrl={member.imageUrl} size="sm" className="size-5" />
        <span className="truncate">{firstName(member.name)}</span>
      </>
    )
  }
  return <AssigneeAvatars assignees={assignees} />
}

/** Overlapping assignee photos (up to three, then "+N"). Shared by the row cell and board cards. */
export function AssigneeAvatars({ assignees, className }: { assignees: readonly MemberRef[]; className?: string }) {
  return (
    <span className={cn("flex", className)} aria-label={assignees.map((a) => a.name).join(", ")}>
      {assignees.slice(0, 3).map((m) => (
        <UserAvatar key={m._id} name={m.name} imageUrl={m.imageUrl} size="sm" className="size-5 ring-2 ring-background not-first:-ml-1.5" />
      ))}
      {assignees.length > 3 ? (
        <span className="pl-1.5 text-xs text-muted-foreground tabular-nums">+{assignees.length - 3}</span>
      ) : null}
    </span>
  )
}

export const CELL_RENDERERS: Record<ColumnKey, CellRenderer> = {
  priority: (row, ctx) => (
    <Button
      variant="ghost"
      size="icon-xs"
      className="size-[22px]"
      aria-label={`Priority: ${PRIORITY_LABELS[row.task.priority]}`}
      onClick={menuClick(ctx, "priority", row.task._id)}
      {...menuAnchor("priority")}
    >
      <PriorityIcon priority={row.task.priority} label={false} />
    </Button>
  ),

  id: (row) => <span className="truncate text-muted-foreground tabular-nums">{row.task.identifier ?? ""}</span>,

  statusIcon: (row, ctx) =>
    row.status ? (
      <Button
        variant="ghost"
        size="icon-xs"
        className="size-[18px]"
        aria-label={`Status: ${row.status.name}`}
        onClick={menuClick(ctx, "status", row.task._id)}
        {...menuAnchor("status")}
      >
        <StatusIcon icon={row.status.icon} color={row.status.color} className="size-3.5" />
      </Button>
    ) : null,

  title: (row) => {
    const { task, perUser } = row
    const unread = perUser.unreadComments
    return (
      <>
        {perUser.hasUnseenChanges ? (
          <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Updated since you last opened it" />
        ) : null}
        <span className="min-w-0 truncate font-medium">
          {row.parentTitle ? <span className="mr-1.5 font-normal text-muted-foreground">{row.parentTitle} ›</span> : null}
          {task.title}
        </span>
        {task.subtaskCount > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
            aria-label={`${task.subtaskDoneCount} of ${task.subtaskCount} sub-tasks done`}
          >
            <InlineSubtaskRing done={task.subtaskDoneCount} total={task.subtaskCount} isUnseen={false} />
            {task.subtaskDoneCount}/{task.subtaskCount}
          </span>
        ) : null}
        <span className="flex-1" />
        {task.commentCount > 0 || unread > 0 ? (
          <span
            className="shrink-0"
            aria-label={unread > 0 ? `${unread} new comments since your last visit` : `${task.commentCount} comments`}
          >
            <CommentPill count={task.commentCount} unreadCount={unread} hasUnseen={unread > 0} />
          </span>
        ) : null}
      </>
    )
  },

  status: (row, ctx) =>
    row.status ? (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 max-w-full justify-start font-normal"
        onClick={menuClick(ctx, "status", row.task._id)}
        {...menuAnchor("status")}
      >
        <StatusIcon icon={row.status.icon} color={row.status.color} className="size-3.5" />
        <span className="truncate">{row.status.name}</span>
      </Button>
    ) : null,

  category: (row) =>
    row.workCategory ? (
      <CategoryBadge name={row.workCategory.name} color={row.workCategory.color} className="max-w-full truncate" />
    ) : null,

  labels: (row, ctx) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-1 h-7 max-w-full justify-start gap-1 overflow-hidden px-1 font-normal"
      aria-label={row.labels.length > 0 ? `Labels: ${row.labels.map((l) => l.name).join(", ")}` : "Add labels"}
      onClick={menuClick(ctx, "labels", row.task._id)}
      {...menuAnchor("labels")}
    >
      {row.labels.map((label) => (
        <ColoredPillBadge
          key={label._id}
          label={label.name}
          leading={<span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(label.color).dot }} />}
        />
      ))}
    </Button>
  ),

  client: (row) => <span className="truncate text-muted-foreground">{row.client?.name ?? ""}</span>,

  assignee: (row, ctx) => (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2 max-w-full justify-start gap-1.5 font-normal"
      aria-label={row.assignees.length > 0 ? `Assignees: ${row.assignees.map((a) => a.name).join(", ")}` : "Assign"}
      onClick={menuClick(ctx, "assignee", row.task._id)}
      {...menuAnchor("assignee")}
    >
      <AssigneeStack assignees={row.assignees} />
    </Button>
  ),

  due: (row, ctx) => {
    const due = row.task.dueDate
    if (!due) return null
    const overdue = !row.isClosed && due < ctx.today
    return (
      <span className={cn("flex items-center gap-1.5 tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
        <CalendarNavIcon size={13} className="shrink-0 opacity-70" />
        {formatDue(due, ctx.today)}
      </span>
    )
  },

  estimate: (row) =>
    row.task.estimateMinutes ? (
      <span className="text-muted-foreground tabular-nums">{formatHoursShort(row.task.estimateMinutes)}</span>
    ) : null,

  time: (row) => (
    <InlineTimeCell
      taskId={row.task._id}
      totalMinutes={row.task.trackedMinutes}
      isDone={row.isClosed}
      isBillable={row.task.billable}
    />
  ),

  created: (row) => (
    <span className="text-muted-foreground tabular-nums">{formatShortDate(ymdOf(row.task.createdAt))}</span>
  ),

  activity: (row, ctx) => {
    const last = row.task.lastActivity
    if (!last) return null
    const actor = ctx.memberById.get(last.actorId)
    return (
      <span className="truncate text-xs text-muted-foreground">
        {actor ? `${firstName(actor.name)} ` : ""}
        {ACTIVITY_VERBS[last.kind] ?? "updated the task"} · {formatRelativeTime(last.at)}
      </span>
    )
  },
}

"use client"

import {
  ListChecksIcon,
  CircleDashedIcon,
  MessageCircleIcon,
  HashIcon,
  FolderIcon,
  UserIcon,
  CalendarIcon,
  ClockIcon,
} from "lucide-react"
import type { Doc } from "@/convex/_generated/dataModel"
import type { GroupByOption } from "@/lib/hooks/use-task-filters"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { TaskGroup } from "@/components/tasks/task-group"

// Grid column template — shared between header and rows
// Only Task is flexible (1fr). Everything else is fixed width.
// The table container sets min-width and scrolls horizontally if needed.
// Checkbox 36 | Task 1fr | Comments 56 | Status 116 | Category 108 | Project 176 | Assignee 80 | Due 96 | Time 76 | Menu 36
export const TASK_GRID_COLS = "grid-cols-[36px_1fr_56px_116px_108px_176px_80px_96px_76px_36px]"
// Fixed columns total = 860px + 9 gaps × 16px = 1004px. With 1fr min ~200px → ~1204px.
export const TASK_TABLE_MIN_W = "min-w-[1200px]"

type TaskWithJoins = Doc<"tasks"> & {
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type" | "icon"> | null
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null
  client: Pick<Doc<"clients">, "_id" | "name"> | null
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
}

type TaskGroupData = {
  key: string
  label: string
  color?: string
  count: number
  tasks: TaskWithJoins[]
  hasMore: boolean
}

const COLUMN_HEADERS = [
  { label: "", width: null }, // checkbox
  { label: "Task", icon: ListChecksIcon },
  { label: "Comments", icon: MessageCircleIcon },
  { label: "Status", icon: CircleDashedIcon },
  { label: "Category", icon: HashIcon },
  { label: "Client / Project", icon: FolderIcon },
  { label: "Assignee", icon: UserIcon },
  { label: "Due date", icon: CalendarIcon },
  { label: "Time", icon: ClockIcon },
  { label: "", width: null }, // menu
]

export function TasksTable({
  groups,
  isGrouped,
  groupBy,
  orgId,
  selectedIds,
  onSelectAll,
  onLoadMore,
  renderRow,
  renderAddTask,
}: {
  groups: TaskGroupData[]
  isGrouped: boolean
  groupBy: GroupByOption | ""
  orgId: string
  selectedIds: Set<string>
  onSelectAll: (taskIds: string[], selected: boolean) => void
  onLoadMore?: () => void
  renderRow: (task: TaskWithJoins) => React.ReactNode
  renderAddTask?: (groupKey: string) => React.ReactNode
}) {
  // Selectable task IDs — capped at 50 to match the bulk operation limit
  const allTaskIds = groups.flatMap((g) => g.tasks.map((t) => t._id as string))
  const selectableIds = allTaskIds.slice(0, 50)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected = selectableIds.some((id) => selectedIds.has(id))

  return (
    <div className="overflow-x-auto">
      <div className={TASK_TABLE_MIN_W}>
        {/* Column headers */}
        <div
          className={`group/header grid ${TASK_GRID_COLS} items-center gap-x-4 border-b border-border/60 px-3 py-4 text-xs text-muted-foreground/70 [&>*]:min-w-0 [&>*]:overflow-hidden`}
        >
          {COLUMN_HEADERS.map((col, i) => (
            <div key={i} className="flex items-center gap-1.5 truncate">
              {i === 0 ? (
                <div className={cn(
                  "transition-opacity",
                  selectedIds.size > 0 ? "opacity-100" : "opacity-0 group-hover/header:opacity-100",
                )}>
                  <SelectCheckbox
                    checked={allSelected}
                    indeterminate={someSelected && !allSelected}
                    onChange={(checked) => onSelectAll(selectableIds, checked)}
                    label="Select all"
                  />
                </div>
              ) : (
                <>
                  {col.icon && <col.icon className="size-3 shrink-0" />}
                  {col.label && <span>{col.label}</span>}
                </>
              )}
            </div>
          ))}
        </div>

        {/* Groups + rows */}
        <div className={cn(isGrouped && "flex flex-col gap-6")}>
        {groups.map((group) => {
          const rows = (
            <>
              {group.tasks.map((task) => renderRow(task))}
              {renderAddTask?.(group.key)}
              {group.hasMore && onLoadMore && (
                <div className="px-3 py-2">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Load more ({group.count - group.tasks.length} remaining)
                  </button>
                </div>
              )}
            </>
          )

          if (!isGrouped) {
            return <div key={group.key}>{rows}</div>
          }

          const groupTaskIds = group.tasks.map((t) => t._id as string)
          return (
            <TaskGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              color={group.color}
              count={group.count}
              groupBy={groupBy}
              orgId={orgId}
              taskIds={groupTaskIds}
              selectedIds={selectedIds}
              onSelectGroup={onSelectAll}
            >
              {rows}
            </TaskGroup>
          )
        })}
        </div>
      </div>
    </div>
  )
}

/** Checkbox with indeterminate support for select-all patterns. */
export function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <Checkbox
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={(val) => onChange(val === true)}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

export type { TaskWithJoins, TaskGroupData }

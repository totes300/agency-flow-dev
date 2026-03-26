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
  ChevronUpIcon,
  ChevronDownIcon,
  RotateCcwIcon,
} from "lucide-react"
import type { Doc } from "@/convex/_generated/dataModel"
import type { GroupByOption, SortField, SortOrder } from "@/lib/hooks/use-task-filters"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TaskGroup } from "@/components/tasks/task-group"
import type { InlineCreatedTask } from "@/components/tasks/inline-created-task-row"

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
  items?: TaskListItem[]
  hasMore: boolean
}

type TaskListItem =
  | { kind: "task"; key: string; task: TaskWithJoins }
  | { kind: "draft"; key: string; draft: InlineCreatedTask }

type ColumnDef = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  sortField?: SortField
  ascLabel?: string
  descLabel?: string
}

const COLUMN_HEADERS: ColumnDef[] = [
  { label: "" }, // checkbox
  { label: "Task", icon: ListChecksIcon, sortField: "title", ascLabel: "Ascending (A→Z)", descLabel: "Descending (Z→A)" },
  { label: "" },
  { label: "Status", icon: CircleDashedIcon, sortField: "status", ascLabel: "Ascending", descLabel: "Descending" },
  { label: "Category", icon: HashIcon, sortField: "category", ascLabel: "Ascending (A→Z)", descLabel: "Descending (Z→A)" },
  { label: "Client / Project", icon: FolderIcon },
  { label: "Assignee", icon: UserIcon },
  { label: "Due date", icon: CalendarIcon, sortField: "dueDate", ascLabel: "Earliest first", descLabel: "Latest first" },
  { label: "Time", icon: ClockIcon },
  { label: "" }, // menu
]

export function TasksTable({
  groups,
  isGrouped,
  groupBy,
  orgId,
  selectedIds,
  onSelectAll,
  onLoadMore,
  sortBy,
  sortOrder,
  onSort,
  onResetSort,
  renderItem,
  renderAddTask,
}: {
  groups: TaskGroupData[]
  isGrouped: boolean
  groupBy: GroupByOption | ""
  orgId: string
  selectedIds: Set<string>
  onSelectAll: (taskIds: string[], selected: boolean) => void
  onLoadMore?: () => void
  sortBy?: SortField
  sortOrder?: SortOrder
  onSort?: (field: SortField, order: SortOrder) => void
  onResetSort?: () => void
  renderItem: (item: TaskListItem) => React.ReactNode
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
          className={`group/header grid ${TASK_GRID_COLS} items-center gap-x-4 border-b border-border/60 px-3 text-xs text-muted-foreground/70 [&>*]:min-w-0 [&>*]:overflow-hidden`}
          style={{ height: 40 }}
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
              ) : col.sortField && onSort ? (
                <SortableHeader
                  col={col}
                  isActive={sortBy === col.sortField}
                  sortOrder={sortBy === col.sortField ? sortOrder : undefined}
                  onSort={(order) => onSort(col.sortField!, order)}
                  onResetSort={onResetSort}
                />
              ) : (
                <span className={cn("flex items-center gap-1.5", !col.sortField && col.label && "opacity-65")}>
                  {col.icon && <col.icon className="size-3 shrink-0" />}
                  {col.label && <span>{col.label}</span>}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Groups + rows */}
        <div className={cn(isGrouped && "flex flex-col gap-6")}>
        {groups.map((group) => {
          const items = group.items ?? group.tasks.map((task) => ({
            kind: "task" as const,
            key: task._id as string,
            task,
          }))
          const rows = (
            <>
              {items.map((item) => renderItem(item))}
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

/** Sortable column header with dropdown menu. */
function SortableHeader({
  col,
  isActive,
  sortOrder: order,
  onSort,
  onResetSort,
}: {
  col: ColumnDef
  isActive: boolean
  sortOrder?: SortOrder
  onSort: (order: SortOrder) => void
  onResetSort?: () => void
}) {
  const Icon = col.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 -mx-1.5 transition-colors hover:bg-black/[0.04] hover:text-muted-foreground",
            isActive && "text-foreground",
          )}
        >
          {Icon && <Icon className="size-3 shrink-0" />}
          <span>{col.label}</span>
          {isActive && order === "asc" && <ChevronUpIcon className="size-3 shrink-0 opacity-50" />}
          {isActive && order === "desc" && <ChevronDownIcon className="size-3 shrink-0 opacity-50" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[180px]">
        <DropdownMenuItem
          onClick={() => onSort("asc")}
          className={cn(isActive && order === "asc" && "font-medium")}
        >
          <ChevronUpIcon className="size-3.5 opacity-45" />
          {col.ascLabel ?? "Ascending"}
          {isActive && order === "asc" && <span className="ml-auto text-muted-foreground">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onSort("desc")}
          className={cn(isActive && order === "desc" && "font-medium")}
        >
          <ChevronDownIcon className="size-3.5 opacity-45" />
          {col.descLabel ?? "Descending"}
          {isActive && order === "desc" && <span className="ml-auto text-muted-foreground">✓</span>}
        </DropdownMenuItem>
        {onResetSort && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onResetSort}>
              <RotateCcwIcon className="size-3.5 opacity-45" />
              Reset to default
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
export type { TaskListItem }

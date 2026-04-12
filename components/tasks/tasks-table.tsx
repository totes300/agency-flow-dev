"use client"

import { useMemo } from "react"
import {
  ListChecksIcon,
  CircleDashedIcon,
  HashIcon,
  FolderIcon,
  UserIcon,
  CalendarIcon,
  ClockIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronsUpDownIcon,
  RotateCcwIcon,
} from "lucide-react"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { PointerSensor, PointerActivationConstraints } from "@dnd-kit/dom"
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
import { SortableTaskRow } from "@/components/tasks/sortable-task-row"
import type { InlineCreatedTask } from "@/components/tasks/inline-created-task-row"

// Grid column template — shared between header and rows
// Checkbox is positioned absolutely in the left margin (Notion-style alignment).
// Only Task is flexible (1fr). Everything else is fixed width.
// Task 1fr | Comments 52 | Status 112 | Category 104 | Project 160 | Assignee 88 | Due 92 | Time 96 | Menu 32
export const TASK_GRID_COLS = "grid-cols-[1fr_52px_112px_104px_160px_88px_92px_96px_32px]"
// Fixed columns total = 736px + 8 gaps × 24px = 928px. With 1fr min ~168px → ~1096px.
export const TASK_TABLE_MIN_W = "min-w-[1096px]"

type TaskWithJoins = Doc<"tasks"> & {
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type" | "icon"> | null
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null
  client: Pick<Doc<"clients">, "_id" | "name" | "prefix" | "usePrefix"> | null
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
}

type TaskGroupData = {
  key: string
  label: string
  color?: string
  statusType?: string
  count: number
  tasks: TaskWithJoins[]
  items?: TaskListItem[]
  hasMore: boolean
}

type TaskListItem =
  | { kind: "task"; key: string; task: TaskWithJoins }
  | { kind: "draft"; key: string; draft: InlineCreatedTask }

const DRAG_SENSORS = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 5 }),
    ],
  }),
]

type ColumnDef = {
  label: string
  icon?: React.ComponentType<{ className?: string }>
  sortField?: SortField
  ascLabel?: string
  descLabel?: string
  align?: "start" | "center" | "end"
}

const COLUMN_HEADERS: ColumnDef[] = [
  { label: "Task", icon: ListChecksIcon, sortField: "title", ascLabel: "Ascending (A→Z)", descLabel: "Descending (Z→A)" },
  { label: "", align: "center" },
  { label: "Status", icon: CircleDashedIcon, sortField: "status", ascLabel: "Ascending", descLabel: "Descending" },
  { label: "Category", icon: HashIcon, sortField: "category", ascLabel: "Ascending (A→Z)", descLabel: "Descending (Z→A)" },
  { label: "Client / Project", icon: FolderIcon },
  { label: "Assignee", icon: UserIcon },
  { label: "Due date", icon: CalendarIcon, sortField: "dueDate", ascLabel: "Earliest first", descLabel: "Latest first" },
  { label: "Time", icon: ClockIcon },
  { label: "", align: "end" }, // menu
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
  onReorder,
  isDragEnabled = false,
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
  onReorder?: (taskId: string, fromIndex: number, toIndex: number) => void
  isDragEnabled?: boolean
}) {
  // Selectable task IDs — capped at 50 to match the bulk operation limit
  const allTaskIds = useMemo(() => groups.flatMap((g) => g.tasks.map((t) => t._id as string)), [groups])
  const selectableIds = allTaskIds.slice(0, 50)
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id))
  const someSelected = selectableIds.some((id) => selectedIds.has(id))

  return (
    <div className="overflow-x-auto">
      <div className={cn(TASK_TABLE_MIN_W, "md:pl-13")}>
        {/* Column headers */}
        <div className="group/header relative">
          {/* Select-all checkbox — positioned in left margin */}
          <div className={cn(
            "absolute -left-7 top-0 bottom-0 flex w-4 items-center transition-opacity",
            selectedIds.size > 0 ? "opacity-100" : "opacity-0 group-hover/header:opacity-100",
          )}>
            <SelectCheckbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onChange={(checked) => onSelectAll(selectableIds, checked)}
              label="Select all"
            />
          </div>
          <div
            className={`grid ${TASK_GRID_COLS} items-center gap-x-6 border-b border-border/50 pr-3 py-2 text-xs font-medium text-muted-foreground/60 [&>*]:min-w-0 [&>*]:overflow-hidden`}
          >
            {COLUMN_HEADERS.map((col, i) => (
              <div key={i} className={cn("flex items-center gap-1.5 truncate", getHeaderAlignmentClass(col.align))}>
                {col.sortField && onSort ? (
                  <SortableHeader
                    col={col}
                    isActive={sortBy === col.sortField}
                    sortOrder={sortBy === col.sortField ? sortOrder : undefined}
                    onSort={(order) => onSort(col.sortField!, order)}
                    onResetSort={onResetSort}
                  />
                ) : (
                  <span className="flex items-center gap-1.5">
                    {col.icon && <col.icon className="size-3 shrink-0" />}
                    {col.label && <span>{col.label}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Groups + rows */}
        <DragDropProvider
          sensors={DRAG_SENSORS}
          onDragEnd={(event) => {
            if (!isDragEnabled || !onReorder || event.canceled) return

            const { source } = event.operation
            if (!isSortable(source)) return

            const { initialIndex, index } = source
            if (initialIndex === index) return

            onReorder(String(source.id), initialIndex, index)
          }}
        >
        <div className={cn(isGrouped && "flex flex-col gap-5")}>
        {groups.map((group) => {
          const items = group.items ?? group.tasks.map((task) => ({
            kind: "task" as const,
            key: task._id as string,
            task,
          }))
          const rows = (
            <>
              {items.map((item, idx) => {
                if (isDragEnabled && item.kind === "task") {
                  return (
                    <SortableTaskRow key={item.key} id={item.key} index={idx}>
                      {renderItem(item)}
                    </SortableTaskRow>
                  )
                }
                return renderItem(item)
              })}
              {renderAddTask?.(group.key)}
              {group.hasMore && onLoadMore && (
                <div className="px-3 py-2">
                  <button
                    type="button"
                    onClick={onLoadMore}
                    className="text-xs font-medium text-muted-foreground/85 underline-offset-4 transition-colors hover:text-foreground hover:underline"
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
              statusType={group.statusType}
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
        </DragDropProvider>
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
            "-mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-background/80 focus-visible:outline-none",
            isActive ? "text-foreground" : "",
            col.align === "end" && "ml-auto",
            col.align === "center" && "mx-auto",
          )}
        >
          {Icon && <Icon className="size-3 shrink-0" />}
          <span>{col.label}</span>
          {isActive && order === "asc" && <ChevronUpIcon className="size-3 shrink-0" />}
          {isActive && order === "desc" && <ChevronDownIcon className="size-3 shrink-0" />}
          {!isActive && <ChevronsUpDownIcon className="size-3 shrink-0" />}
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

function getHeaderAlignmentClass(align?: ColumnDef["align"]) {
  if (align === "end") return "justify-end text-right"
  if (align === "center") return "justify-center text-center"
  return ""
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

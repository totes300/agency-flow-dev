"use client"

import { useState, useEffect } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { cn } from "@/lib/utils"
import type { StatusType } from "@/convex/lib/constants"
import type { GroupByOption } from "@/lib/hooks/use-task-filters"

const STORAGE_PREFIX = "task-group-collapse:"

function getCollapseKey(orgId: string, groupBy: string, groupKey: string): string {
  return `${STORAGE_PREFIX}${orgId}:${groupBy}:${groupKey}`
}

export function TaskGroup({
  groupKey,
  label,
  color,
  statusType,
  count,
  groupBy,
  orgId,
  taskIds,
  selectedIds,
  onSelectGroup,
  children,
}: {
  groupKey: string
  label: string
  color?: string
  statusType?: string
  count: number
  groupBy: GroupByOption | ""
  orgId: string
  taskIds?: string[]
  selectedIds?: Set<string>
  onSelectGroup?: (taskIds: string[], selected: boolean) => void
  children: React.ReactNode
}) {
  const storageKey = getCollapseKey(orgId, groupBy ?? "", groupKey)

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(storageKey) === "1"
  })

  useEffect(() => {
    if (collapsed) {
      localStorage.setItem(storageKey, "1")
    } else {
      localStorage.removeItem(storageKey)
    }
  }, [collapsed, storageKey])

  const contentId = `group-content-${groupKey}`

  // Group selection state — derived from the same capped subset used by the toggle
  const selectableIds = taskIds?.slice(0, 50) ?? []
  const groupAllSelected = selectableIds.length > 0 && selectedIds
    ? selectableIds.every((id) => selectedIds.has(id))
    : false
  const groupSomeSelected = selectableIds.length > 0 && selectedIds
    ? selectableIds.some((id) => selectedIds.has(id))
    : false

  return (
    <div>
      <div className="group/group relative flex w-full items-center gap-2 border-b border-border/70 bg-muted/[0.16] pr-3 py-2.5 transition-colors hover:bg-muted/[0.3] before:pointer-events-none before:absolute before:inset-y-0 before:-left-13 before:w-13 before:bg-muted/[0.16] before:transition-colors hover:before:bg-muted/[0.3]">
        {/* Group checkbox — positioned in left gutter */}
        {taskIds && selectedIds && onSelectGroup && (
          <div className={cn(
            "absolute -left-7 top-0 bottom-0 flex w-4 items-center transition-opacity",
            selectedIds.size > 0 || groupSomeSelected ? "opacity-100" : "opacity-0 group-hover/group:opacity-100 focus-within:opacity-100",
          )}>
            <Checkbox
              checked={groupSomeSelected && !groupAllSelected ? "indeterminate" : groupAllSelected}
              onCheckedChange={() => onSelectGroup(selectableIds, !groupAllSelected)}
              aria-label={`Select all in ${label}`}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          className="flex flex-1 items-center gap-2 text-left"
        >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {groupBy === "status" && color ? (
          <StatusBadge name={label} color={color} type={statusType as StatusType | "backlog" | undefined} />
        ) : groupBy === "category" && color ? (
          <CategoryBadge name={label} color={color} />
        ) : (
          <span className="text-[13px] font-medium text-foreground">
            {label}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/75">
          {count}
        </span>
        </button>
      </div>

      {/* Group content */}
      {!collapsed && <div id={contentId}>{children}</div>}
    </div>
  )
}


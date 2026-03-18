"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FilterIcon, LayoutListIcon, CheckIcon } from "lucide-react"
import type { TaskTab, GroupByOption } from "@/lib/hooks/use-task-filters"

type TabDef = {
  key: TaskTab
  label: string
}

const TABS: TabDef[] = [
  { key: "all", label: "All" },
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
]

const GROUP_BY_OPTIONS: { key: GroupByOption; label: string; adminOnly?: boolean }[] = [
  { key: null, label: "None" },
  { key: "project", label: "Project" },
  { key: "client", label: "Client", adminOnly: true },
  { key: "category", label: "Category" },
  { key: "assignee", label: "Assignee" },
  { key: "status", label: "Status" },
]

export type TabCounts = {
  all: number
  backlog: number
  in_progress: number
  review: number
  blocked: number
  done: number
}

export function TasksTabs({
  activeTab,
  onTabChange,
  counts,
  isSearching,
  groupBy,
  onGroupByChange,
  hasActiveFilters,
  onFilterToggle,
  isAdmin,
}: {
  activeTab: TaskTab
  onTabChange: (tab: TaskTab) => void
  counts?: TabCounts
  isSearching: boolean
  groupBy: GroupByOption
  onGroupByChange: (option: GroupByOption) => void
  hasActiveFilters: boolean
  onFilterToggle: () => void
  isAdmin: boolean
}) {
  function getCount(tab: TaskTab): number | undefined {
    if (!counts) return undefined
    return counts[tab]
  }

  const groupByLabel = GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? "None"

  return (
    <div className="flex items-center justify-between gap-2 border-b">
      {/* Tabs */}
      <div className="flex items-center overflow-x-auto scrollbar-none">
        {TABS.map((tab) => {
          const count = getCount(tab.key)
          const isActive = !isSearching && activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 px-3 py-2 text-[13px] whitespace-nowrap transition-colors",
                isSearching
                  ? "text-muted-foreground/40"
                  : isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className={cn(
                  "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums leading-none",
                  isActive
                    ? "bg-foreground/8 text-foreground/45"
                    : "bg-foreground/5 text-muted-foreground/45",
                )}>
                  {count}
                </span>
              )}
              {isActive && (
                <span className="absolute inset-x-3 bottom-0 h-px bg-foreground/80" />
              )}
            </button>
          )
        })}
      </div>

      {/* Right side: Filter + Group by */}
      <div className="flex items-center gap-2 pb-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onFilterToggle}
          className={cn(
            "h-8 gap-1.5 text-muted-foreground",
            hasActiveFilters && "text-primary",
          )}
        >
          <FilterIcon className="size-3.5" />
          Filter
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground">
              <LayoutListIcon className="size-3.5" />
              <span>Group: {groupByLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {GROUP_BY_OPTIONS.filter((o) => !o.adminOnly || isAdmin).map((option) => (
              <DropdownMenuItem
                key={option.key ?? "none"}
                onClick={() => onGroupByChange(option.key)}
              >
                <span className="flex items-center gap-2">
                  <span className="w-3.5 shrink-0">
                    {groupBy === option.key && <CheckIcon className="size-3.5" />}
                  </span>
                  {option.label}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
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
  { key: "active", label: "Active" },
  { key: "backlog", label: "All" },
  { key: "today", label: "Today" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Stuck" },
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

export function TasksTabs({
  activeTab,
  onTabChange,
  counts,
  groupBy,
  onGroupByChange,
  hasActiveFilters,
  onFilterToggle,
  isAdmin,
}: {
  activeTab: TaskTab
  onTabChange: (tab: TaskTab) => void
  counts?: {
    active: number
    backlog: number
    today: number
    review: number
    blocked: number
    done: number
  }
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
    <div className="flex items-center justify-between border-b">
      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((tab) => {
          const count = getCount(tab.key)
          const isActive = activeTab === tab.key
          return (
            <button
              key={tab.key}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <Badge
                  variant={isActive ? "default" : "secondary"}
                  className={cn(
                    "h-5 min-w-5 px-1.5 text-[11px] font-semibold",
                    tab.key === "blocked" && count > 0 && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
                  )}
                >
                  {count}
                </Badge>
              )}
              {/* Active indicator */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-foreground" />
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

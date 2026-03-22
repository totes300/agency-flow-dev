"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  LayoutListIcon,
  CheckIcon,
  CircleDashed,
  FolderKanban,
  Building2,
  Tag,
  UserCircle,
} from "lucide-react"
import type { TaskTab, GroupByOption } from "@/lib/hooks/use-task-filters"
import type { Filter } from "@/components/ui/filters"
import { TasksFilterBar, TasksActiveFilters } from "@/components/tasks/tasks-filter-bar"

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
  { key: "archived", label: "Archived" },
]

const GROUP_BY_OPTIONS: { key: GroupByOption; label: string; icon: React.ReactNode; adminOnly?: boolean }[] = [
  { key: null, label: "None", icon: <span className="size-3.5" /> },
  { key: "project", label: "Project", icon: <FolderKanban className="size-3.5" /> },
  { key: "client", label: "Client", icon: <Building2 className="size-3.5" />, adminOnly: true },
  { key: "category", label: "Category", icon: <Tag className="size-3.5" /> },
  { key: "assignee", label: "Assignee", icon: <UserCircle className="size-3.5" /> },
  { key: "status", label: "Status", icon: <CircleDashed className="size-3.5" /> },
]

export type TabCounts = {
  all: number
  backlog: number
  in_progress: number
  review: number
  blocked: number
  done: number
  archived: number
}

export function TasksTabs({
  activeTab,
  onTabChange,
  counts,
  isSearching,
  groupBy,
  onGroupByChange,
  filters,
  setFilters,
  isAdmin,
}: {
  activeTab: TaskTab
  onTabChange: (tab: TaskTab) => void
  counts?: TabCounts
  isSearching: boolean
  groupBy: GroupByOption
  onGroupByChange: (option: GroupByOption) => void
  filters: Filter[]
  setFilters: React.Dispatch<React.SetStateAction<Filter[]>>
  isAdmin: boolean
}) {
  function getCount(tab: TaskTab): number | undefined {
    if (!counts) return undefined
    return counts[tab]
  }

  const groupByLabel = GROUP_BY_OPTIONS.find((o) => o.key === groupBy)?.label ?? "None"
  const isGrouped = groupBy !== null

  const hasActiveFilters = filters.some((f) => f.value?.length > 0)

  return (
    <div>
      {/* Row 1: Tabs + controls — always single row */}
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

        {/* Right side: Filter trigger + Group by */}
        <div className="flex items-center gap-2 pb-1">
          <TasksFilterBar filters={filters} setFilters={setFilters} isAdmin={isAdmin} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-8 gap-1.5 transition-colors",
                  isGrouped
                    ? "bg-blue-500/10 text-blue-600 hover:bg-blue-500/15 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-400"
                    : "text-muted-foreground",
                )}
              >
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
                    <span className="w-3.5 shrink-0 text-muted-foreground">
                      {groupBy === option.key ? <CheckIcon className="size-3.5 text-primary" /> : option.icon}
                    </span>
                    {option.label}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Row 2: Active filter pills — slides down when filters exist */}
      <div
        className="grid transition-all duration-150 ease-out"
        style={{
          gridTemplateRows: hasActiveFilters ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-2 px-1 py-2 transition-opacity duration-150"
            style={{ opacity: hasActiveFilters ? 1 : 0 }}
          >
            <TasksActiveFilters filters={filters} setFilters={setFilters} isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </div>
  )
}

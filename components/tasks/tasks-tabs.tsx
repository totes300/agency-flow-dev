"use client"

import { useRef, useState, useCallback, useLayoutEffect } from "react"
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
  PlusIcon,
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
  search,
  onSearchChange,
  onNewTask,
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
  search: string
  onSearchChange: (value: string) => void
  onNewTask: () => void
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

  const tabsRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })
  const [isIndicatorReady, setIsIndicatorReady] = useState(false)

  const updateIndicator = useCallback(() => {
    const container = tabsRef.current
    const activeEl = tabRefs.current.get(activeTab)
    if (!container || !activeEl) return
    const containerRect = container.getBoundingClientRect()
    const tabRect = activeEl.getBoundingClientRect()
    setIndicator({
      left: tabRect.left - containerRect.left + 12,
      width: tabRect.width - 24,
    })
    setIsIndicatorReady(true)
  }, [activeTab])

  useLayoutEffect(() => {
    updateIndicator()
  }, [updateIndicator])

  return (
    <div className="md:pl-13">
      <div className="border-b border-border/50">
        <div className="flex items-end justify-between">
          {/* Tabs — left side */}
          <div ref={tabsRef} className="relative flex items-center overflow-x-auto scrollbar-none">
            {TABS.map((tab) => {
              const count = getCount(tab.key)
              const isActive = !isSearching && activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  ref={(el) => { if (el) tabRefs.current.set(tab.key, el); }}
                  onClick={() => onTabChange(tab.key)}
                  className={cn(
                    "relative flex shrink-0 items-center gap-1.5 rounded-t-md px-3 pb-3 pt-1.5 text-sm whitespace-nowrap transition-colors duration-200",
                    isSearching
                      ? "text-muted-foreground/40"
                      : isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {count !== undefined && count > 0 && (
                    <span className={cn(
                      "text-[11px] tabular-nums transition-colors duration-200",
                      isActive
                        ? "text-foreground/45"
                        : "text-muted-foreground/45",
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
            {/* Sliding underline */}
            {!isSearching && (
              <span
                className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-foreground/90"
                style={{
                  left: indicator.left,
                  width: indicator.width,
                  transition: isIndicatorReady ? "left 250ms cubic-bezier(.4,0,.2,1), width 250ms cubic-bezier(.4,0,.2,1)" : "none",
                }}
              />
            )}
          </div>

          {/* Controls — right side, same row as tabs */}
          <div className="flex shrink-0 items-center gap-2 pb-2.5 pl-4">
            <TasksFilterBar filters={filters} setFilters={setFilters} isAdmin={isAdmin} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors",
                    isGrouped
                      ? "border-border/80 bg-muted/40 text-foreground hover:bg-muted/55"
                      : "border-border/70 text-foreground/80 hover:bg-muted/55 hover:text-foreground",
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

            <Button size="sm" className="h-8 rounded-lg px-3 text-[13px]" onClick={onNewTask}>
              <PlusIcon className="size-4" />
              New task
            </Button>
          </div>
        </div>
      </div>

      <div
        className="grid pt-2 transition-all duration-150 ease-out"
        style={{
          gridTemplateRows: hasActiveFilters ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-2 py-1 transition-opacity duration-150"
            style={{ opacity: hasActiveFilters ? 1 : 0 }}
          >
            <TasksActiveFilters filters={filters} setFilters={setFilters} isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </div>
  )
}

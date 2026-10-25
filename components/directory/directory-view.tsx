"use client"

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { ComposeIcon } from "@/components/icons/nav-icons"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchBox } from "@/components/task-view/search-box"
import { Skeleton } from "@/components/ui/skeleton"
import { TASK_VIEW_PANEL_CLASS } from "@/components/task-view/task-view-skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"

/**
 * A directory list (projects, clients) on the task surface's panel: one
 * compact toolbar, the active filter chips under it, and an independently
 * scrolling list. Pages feed both tabs from one loaded list, so switching
 * Active/All never unmounts the toolbar.
 */
export function DirectoryView({
  name,
  includeArchived,
  onIncludeArchivedChange,
  search,
  onSearchChange,
  onCreate,
  controls,
  filters,
  children,
}: {
  name: "projects" | "clients"
  includeArchived: boolean
  onIncludeArchivedChange: (value: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  onCreate: () => void
  controls: ReactNode
  /** The active filter chip row, rendered under the toolbar. */
  filters?: ReactNode
  children: ReactNode
}) {
  const view = includeArchived ? "all" : "active"
  return (
    <Tabs
      value={view}
      onValueChange={(value) => onIncludeArchivedChange(value === "all")}
      className={cn(TASK_VIEW_PANEL_CLASS, "gap-0")}
      data-full-bleed
    >
      <h1 className="sr-only">
        {name === "projects" ? "Projects" : "Clients"}
      </h1>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <TabsList variant="pill" aria-label={`${name} views`}>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="all">All {name}</TabsTrigger>
        </TabsList>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <SearchBox
            value={search}
            onChange={onSearchChange}
            label={`Search ${name}`}
          />
          {controls}
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            onClick={onCreate}
            aria-label={`Create ${name === "projects" ? "project" : "client"}`}
            title={`Create ${name === "projects" ? "project" : "client"}`}
          >
            <ComposeIcon />
          </Button>
        </div>
      </div>
      {filters}
      <TabsContent
        key={view}
        value={view}
        className="min-h-0 overflow-auto border-t border-border/60"
      >
        {children}
      </TabsContent>
    </Tabs>
  )
}

/**
 * Empty list. Three cases: the search/filters hide everything; the Active tab
 * is empty while archived records exist (point to the All tab); or there is
 * nothing at all yet.
 */
export function DirectoryEmpty({
  name,
  filtered,
  hasArchived,
  onReset,
  onShowAll,
  onCreate,
}: {
  name: "projects" | "clients"
  filtered: boolean
  /** Active tab only: archived records exist, so the list is not truly empty. */
  hasArchived: boolean
  onReset: () => void
  onShowAll: () => void
  onCreate: () => void
}) {
  const singular = name === "projects" ? "project" : "client"
  const content = filtered
    ? {
        title: `No matching ${name}`,
        description: "Try a different search or clear your filters.",
        action: "Clear filters",
        onClick: onReset,
      }
    : hasArchived
      ? {
          title: `No active ${name}`,
          description: `Archived ${name} are listed under All ${name}.`,
          action: `Show all ${name}`,
          onClick: onShowAll,
        }
      : {
          title: `No ${name} yet`,
          description: `Create your first ${name === "projects" ? "project to organize work and track budgets" : "client to organize contacts and projects"}.`,
          action: `Create ${singular}`,
          onClick: onCreate,
        }
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyTitle>{content.title}</EmptyTitle>
        <EmptyDescription>{content.description}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={content.onClick}>
        {content.action}
      </Button>
    </Empty>
  )
}

export function DirectorySkeleton() {
  return (
    <div
      data-full-bleed
      aria-busy="true"
      aria-label="Loading directory"
      className={TASK_VIEW_PANEL_CLASS}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="size-7 rounded-full" />
        </div>
      </div>
      <div className="h-9 border-b border-border/60" />
      {Array.from({ length: 8 }, (_, index) => (
        <div
          key={index}
          className="flex h-11 items-center gap-3 border-b border-border/60 px-6"
        >
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="ml-auto h-3.5 w-20" />
          <Skeleton className="hidden h-3.5 w-24 sm:block" />
        </div>
      ))}
    </div>
  )
}

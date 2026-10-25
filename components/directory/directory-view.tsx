"use client"

import { cn } from "@/lib/utils"
import type { ReactNode } from "react"
import { SquarePenIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchBox } from "@/components/task-view/search-box"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty"

/** Matches the task surface: one compact toolbar and an independently scrolling list. */
export const DIRECTORY_PANEL_CLASS =
  "flex h-[calc(100svh-3rem)] min-h-[28rem] w-full flex-col overflow-hidden border-t border-border/60 bg-background md:h-[calc(100svh-4rem)]"

export function DirectoryView({
  name,
  includeArchived,
  onIncludeArchivedChange,
  search,
  onSearchChange,
  onCreate,
  controls,
  children,
}: {
  name: "projects" | "clients"
  includeArchived: boolean
  onIncludeArchivedChange: (value: boolean) => void
  search: string
  onSearchChange: (value: string) => void
  onCreate: () => void
  controls: ReactNode
  children: ReactNode
}) {
  const view = includeArchived ? "all" : "active"
  return (
    <Tabs
      value={view}
      onValueChange={(value) => onIncludeArchivedChange(value === "all")}
      className={cn(DIRECTORY_PANEL_CLASS, "gap-0")}
      data-full-bleed
    >
      <h1 className="sr-only">
        {name === "projects" ? "Projects" : "Clients"}
      </h1>
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
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
            <SquarePenIcon />
          </Button>
        </div>
      </div>
      <TabsContent key={view} value={view} className="min-h-0 overflow-auto">
        {children}
      </TabsContent>
    </Tabs>
  )
}

export function DirectoryEmpty({
  name,
  filtered,
  onReset,
  onCreate,
}: {
  name: "projects" | "clients"
  filtered: boolean
  onReset: () => void
  onCreate: () => void
}) {
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyTitle>
          {filtered ? `No matching ${name}` : `No ${name} yet`}
        </EmptyTitle>
        <EmptyDescription>
          {filtered
            ? "Try a different search or clear your filters."
            : `Create your first ${name === "projects" ? "project to organize work and track budgets" : "client to organize contacts and projects"}.`}
        </EmptyDescription>
      </EmptyHeader>
      <Button
        variant="outline"
        size="sm"
        onClick={filtered ? onReset : onCreate}
      >
        {filtered
          ? "Clear filters"
          : `Create ${name === "projects" ? "project" : "client"}`}
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
      className={DIRECTORY_PANEL_CLASS}
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

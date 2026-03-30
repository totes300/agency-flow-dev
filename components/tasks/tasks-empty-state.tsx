"use client"

import { ClipboardListIcon, SearchIcon, FilterIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { TaskTab } from "@/lib/hooks/use-task-filters"

const TAB_CONTENT: Record<TaskTab, { title: string; description: string; showCta: boolean }> = {
  all: {
    title: "No tasks yet",
    description: "Tasks help you track work across projects. Create your first one to get started.",
    showCta: true,
  },
  backlog: {
    title: "Backlog is clear",
    description: "New tasks that haven't been started will show up here.",
    showCta: true,
  },
  in_progress: {
    title: "Nothing in progress",
    description: "Tasks your team is actively working on will appear here.",
    showCta: true,
  },
  review: {
    title: "Nothing in review",
    description: "Tasks waiting for review or approval will appear here.",
    showCta: true,
  },
  blocked: {
    title: "Nothing blocked",
    description: "Great news — no tasks are currently stuck or waiting on dependencies.",
    showCta: false,
  },
  done: {
    title: "No completed tasks",
    description: "Tasks marked as done will appear here for reference.",
    showCta: false,
  },
  archived: {
    title: "No archived tasks",
    description: "Tasks you archive will be stored here for your records.",
    showCta: false,
  },
}

export function TasksEmptyState({
  tab,
  hasFilters,
  isSearching,
  onClearFilters,
  onNewTask,
}: {
  tab: TaskTab
  hasFilters: boolean
  isSearching: boolean
  onClearFilters: () => void
  onNewTask: () => void
}) {
  if (isSearching) {
    return (
      <EmptyShell>
        <EmptyVisual variant="search" />
        <EmptyText
          title="No tasks match your search"
          description="Try a different search term or check your spelling."
        />
      </EmptyShell>
    )
  }

  if (hasFilters) {
    return (
      <EmptyShell>
        <EmptyVisual variant="filter" />
        <EmptyText
          title="No tasks match these filters"
          description="Try adjusting your filters to see more results."
        />
        <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-1">
          Clear all filters
        </Button>
      </EmptyShell>
    )
  }

  const content = TAB_CONTENT[tab]
  return (
    <EmptyShell>
      <EmptyVisual variant="tasks" />
      <EmptyText title={content.title} description={content.description} />
      {content.showCta && (
        <Button onClick={onNewTask} size="sm" className="mt-1">
          <PlusIcon className="size-4" />
          New task
        </Button>
      )}
    </EmptyShell>
  )
}

function EmptyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 py-16">
      <div className="flex flex-col items-center gap-4">{children}</div>
    </div>
  )
}

function EmptyText({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-xs text-center">
      <h3 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

function EmptyVisual({ variant }: { variant: "tasks" | "search" | "filter" }) {
  return (
    <div className="relative mb-2">
      {/* Stacked task line placeholders — suggest what will fill this space */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-9 w-56 items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 opacity-30">
          <div className="size-3.5 rounded border border-border/60" />
          <div className="h-2 w-24 rounded-full bg-muted-foreground/15" />
          <div className="ml-auto h-2 w-10 rounded-full bg-muted-foreground/10" />
        </div>
        <div className="flex h-9 w-56 items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 opacity-50">
          <div className="size-3.5 rounded border border-border/60" />
          <div className="h-2 w-32 rounded-full bg-muted-foreground/15" />
          <div className="ml-auto h-2 w-8 rounded-full bg-muted-foreground/10" />
        </div>
        <div className="flex h-9 w-56 items-center gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 opacity-70">
          <div className="size-3.5 rounded border border-border/60" />
          <div className="h-2 w-20 rounded-full bg-muted-foreground/15" />
          <div className="ml-auto h-2 w-12 rounded-full bg-muted-foreground/10" />
        </div>
      </div>
      {/* Icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex size-11 items-center justify-center rounded-xl border border-border/80 bg-background shadow-sm">
          {variant === "search" ? (
            <SearchIcon className="size-5 text-muted-foreground/70" strokeWidth={1.5} />
          ) : variant === "filter" ? (
            <FilterIcon className="size-5 text-muted-foreground/70" strokeWidth={1.5} />
          ) : (
            <ClipboardListIcon className="size-5 text-muted-foreground/70" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </div>
  )
}

"use client"

import { CheckSquareIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { PlusIcon } from "lucide-react"
import type { TaskTab } from "@/lib/hooks/use-task-filters"

const TAB_MESSAGES: Record<TaskTab, { title: string; description: string }> = {
  all: {
    title: "No tasks yet",
    description: "Create your first task to get started.",
  },
  backlog: {
    title: "Backlog is empty",
    description: "Tasks in backlog statuses will appear here.",
  },
  in_progress: {
    title: "Nothing in progress",
    description: "Tasks with in-progress statuses will appear here.",
  },
  review: {
    title: "Nothing waiting for review",
    description: "Tasks in review statuses will appear here.",
  },
  blocked: {
    title: "Nothing blocked — nice!",
    description: "Blocked tasks will appear here.",
  },
  done: {
    title: "No completed tasks yet",
    description: "Completed tasks will appear here.",
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
      <EmptyState
        icon={CheckSquareIcon}
        title="No tasks match your search"
        description="Try a different search term."
      />
    )
  }

  if (hasFilters) {
    return (
      <EmptyState
        icon={CheckSquareIcon}
        title="No tasks match your filters"
        description="Try adjusting or clearing your filters."
        action={
          <Button variant="outline" onClick={onClearFilters}>
            Clear all filters
          </Button>
        }
      />
    )
  }

  const msg = TAB_MESSAGES[tab]
  return (
    <EmptyState
      icon={CheckSquareIcon}
      title={msg.title}
      description={msg.description}
      action={
        tab === "all" ? (
          <Button onClick={onNewTask}>
            <PlusIcon className="size-4" />
            New task
          </Button>
        ) : undefined
      }
    />
  )
}

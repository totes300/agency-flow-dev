"use client"

import { CheckSquareIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { PlusIcon } from "lucide-react"
import type { TaskTab } from "@/lib/hooks/use-task-filters"

const TAB_MESSAGES: Record<TaskTab, { title: string; description: string }> = {
  active: {
    title: "No active tasks",
    description: "Create one to get started.",
  },
  backlog: {
    title: "Backlog is empty",
    description: "Tasks in backlog statuses will appear here.",
  },
  today: {
    title: "Nothing planned for today",
    description: "Move tasks to \"Today\" status to see them here.",
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
  onClearFilters,
  onNewTask,
}: {
  tab: TaskTab
  hasFilters: boolean
  onClearFilters: () => void
  onNewTask: () => void
}) {
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
        tab === "active" ? (
          <Button onClick={onNewTask}>
            <PlusIcon className="size-4" />
            New task
          </Button>
        ) : undefined
      }
    />
  )
}

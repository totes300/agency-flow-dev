"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

const DOT_COLORS: Record<string, string> = {
  status_changed: "bg-primary",
  subtask_completed: "bg-emerald-500",
  time_entry_logged: "bg-amber-500",
  comment_added: "bg-primary",
}

function eventLabel(type: string, metadata: Record<string, unknown>, userName: string): string {
  const first = userName.split(" ")[0]
  switch (type) {
    case "status_changed":
      return `${first} changed status to ${metadata.to}`
    case "comment_added":
      return `${first} commented`
    case "time_entry_logged":
      return `${first} logged time`
    case "subtask_completed":
      return `${first} completed ${metadata.title}`
    case "subtask_created":
      return `${first} created subtask`
    case "assignee_added":
      return `${first} assigned ${metadata.userName}`
    case "assignee_removed":
      return `${first} unassigned ${metadata.userName}`
    case "due_date_changed":
      return metadata.to ? `${first} set due date` : `${first} removed due date`
    case "task_created":
      return `${first} created this task`
    case "description_changed":
      return `${first} updated description`
    case "category_changed":
      return `${first} changed category to ${metadata.to}`
    case "project_changed":
      return `${first} moved to ${metadata.to ?? "no project"}`
    case "billable_changed":
      return `${first} changed billable to ${metadata.to}`
    default:
      return `${first} updated`
  }
}

export function ActivityHoverPopover({
  taskId,
  onOpenDetail,
  children,
}: {
  taskId: Id<"tasks">
  onOpenDetail?: (taskId: string) => void
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const data = useQuery(
    api.activityLog.latestForTask,
    isOpen ? { taskId } : "skip",
  )

  return (
    <HoverCard openDelay={250} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0 hidden md:block">
        <div className="p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Recent Activity</p>
          {!data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="mt-1.5 size-1.5 rounded-full bg-muted animate-pulse" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No activity yet</p>
          ) : (
            <div className="space-y-1.5">
              {data.map((event, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className={cn(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    DOT_COLORS[event.type] ?? "bg-muted-foreground/40",
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-tight truncate">
                      {eventLabel(event.type, event.metadata, event.userName)}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {formatRelativeTime(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            Open full history
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

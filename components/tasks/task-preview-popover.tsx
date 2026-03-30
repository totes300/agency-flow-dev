"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { CheckIcon, ChevronRightIcon } from "lucide-react"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

type TiptapNode = {
  type?: string
  text?: string
  content?: TiptapNode[]
  attrs?: Record<string, unknown>
}

function extractText(node: TiptapNode): string {
  if (node.type === "text" && node.text) return node.text
  if (node.type === "mention") return `@${node.attrs?.label ?? node.attrs?.id ?? ""}`
  if (node.type === "hardBreak") return " "
  if (node.type === "taskList" || node.type === "taskItem") return ""
  if (!node.content) return ""
  return node.content.map(extractText).join("")
}

function extractChecklistItems(node: TiptapNode): Array<{ text: string; checked: boolean }> {
  const items: Array<{ text: string; checked: boolean }> = []
  if (node.type === "taskItem") {
    const text = node.content?.map(extractText).join("").trim() ?? ""
    if (text) items.push({ text, checked: node.attrs?.checked === true })
  }
  if (node.content) {
    for (const child of node.content) {
      items.push(...extractChecklistItems(child))
    }
  }
  return items
}

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

export function TaskPreviewPopover({
  taskId,
  description,
  updatedAt,
  onOpenDetail,
  children,
}: {
  taskId: Id<"tasks">
  description: string | undefined
  updatedAt?: number
  onOpenDetail?: (taskId: string) => void
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [activityExpanded, setActivityExpanded] = useState(false)

  // Parse description
  let plainText = ""
  let checklistItems: Array<{ text: string; checked: boolean }> = []
  if (description) {
    try {
      const doc = JSON.parse(description) as TiptapNode
      plainText = extractText(doc).trim().slice(0, 150)
      checklistItems = extractChecklistItems(doc)
    } catch {
      // invalid JSON, skip
    }
  }

  const hasDescription = !!(plainText || checklistItems.length > 0)

  // If no description, auto-expand activity
  const showActivityExpanded = activityExpanded || !hasDescription

  // Lazy-load activity only when popover is open AND activity is expanded
  const activityData = useQuery(
    api.activityLog.latestForTask,
    isOpen && showActivityExpanded ? { taskId } : "skip",
  )

  // Reset activity expanded state when popover closes
  const handleOpenChange = (open: boolean) => {
    // Don't open on mobile — prevents hidden popover from firing queries
    if (open && typeof window !== "undefined" && window.innerWidth < 768) return
    setIsOpen(open)
    if (!open) setActivityExpanded(false)
  }

  return (
    <HoverCard openDelay={250} closeDelay={100} open={isOpen} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0 hidden md:block">
        {/* Last edited */}
        {updatedAt && (
          <div className="px-3 pt-2.5 pb-0">
            <p className="text-[10px] text-muted-foreground/50">
              Edited {formatRelativeTime(updatedAt)}
            </p>
          </div>
        )}

        {/* Description section (primary) */}
        {hasDescription && (
          <div className="max-h-[200px] overflow-y-auto p-3 pt-1.5 flex flex-col gap-2">
            {plainText && (
              <p className="text-xs text-foreground/80 leading-relaxed">
                {plainText}{plainText.length >= 150 && "..."}
              </p>
            )}
            {checklistItems.length > 0 && (
              <div className="flex flex-col gap-1">
                {checklistItems.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className={cn(
                      "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                      item.checked
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-muted-foreground/30",
                    )}>
                      {item.checked && <CheckIcon className="size-2.5" />}
                    </span>
                    <span className={cn(
                      "text-xs leading-tight",
                      item.checked && "line-through text-muted-foreground/60",
                    )}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Activity section (collapsible) */}
        <div className={cn(hasDescription && "border-t border-border/40")}>
          {hasDescription ? (
            <button
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              onClick={(e) => { e.stopPropagation(); setActivityExpanded(!activityExpanded) }}
            >
              <ChevronRightIcon className={cn(
                "size-3 shrink-0 transition-transform duration-150",
                activityExpanded && "rotate-90",
              )} />
              Recent activity
            </button>
          ) : (
            <div className="px-3 pt-3 pb-1">
              <p className="text-xs font-medium text-muted-foreground">Recent Activity</p>
            </div>
          )}

          {showActivityExpanded && (
            <div className="px-3 pb-2 flex flex-col gap-1.5">
              {!activityData ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="mt-1.5 size-1.5 rounded-full bg-muted animate-pulse" />
                      <div className="flex-1 flex flex-col gap-1">
                        <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
                        <div className="h-2.5 w-1/3 rounded bg-muted animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : activityData.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">No activity yet</p>
              ) : (
                activityData.map((event, i) => (
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
                ))
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            Open task to read more
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

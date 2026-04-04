"use client"

import { Activity, ChevronRight, CircleCheck, CircleCheckBig, Clock3, FolderOpen, MessageSquare, Tags, UserRound } from "lucide-react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { firstName, formatBatchTimeRange } from "@/lib/format"
import type { AuditBatch } from "@/lib/activity-grouping"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * Build a summary label for a batch, showing the final state when possible.
 * Examples:
 *   "Status → Today (7x)"
 *   "3 properties updated"
 *   "2 time updates"
 */
function getBatchSummary(batch: AuditBatch): { label: string; highlight?: string } {
  const types = new Set(batch.items.map((item) => item.type))

  // Single-type batches: show final state
  if (types.size === 1) {
    const [type] = [...types]
    const lastItem = batch.items[batch.items.length - 1]
    const count = batch.count

    switch (type) {
      case "status_changed": {
        const finalStatus = lastItem.metadata.to as string | undefined
        if (finalStatus && count > 1) {
          return { label: `Status →`, highlight: `${finalStatus} (${count}x)` }
        }
        if (finalStatus) {
          return { label: `Status →`, highlight: finalStatus }
        }
        return { label: `${count} ${count === 1 ? "status change" : "status changes"}` }
      }
      case "assignee_added":
      case "assignee_removed":
        return { label: `${count} ${count === 1 ? "assignment change" : "assignment changes"}` }
      case "category_changed": {
        const finalCat = lastItem.metadata.to as string | undefined
        if (finalCat) {
          return { label: `Category →`, highlight: finalCat }
        }
        return { label: `${count} ${count === 1 ? "category change" : "category changes"}` }
      }
      case "due_date_changed":
      case "project_changed":
      case "billable_changed":
        return { label: `${count} ${count === 1 ? "property updated" : "properties updated"}` }
      case "time_entry_logged":
      case "time_entry_edited":
      case "time_entry_deleted":
        return { label: `${count} time ${count === 1 ? "update" : "updates"}` }
      case "subtask_created":
      case "subtask_completed":
      case "subtask_deleted":
        return { label: `${count} ${count === 1 ? "subtask change" : "subtask changes"}` }
      case "comment_resolved":
        return { label: `${count} ${count === 1 ? "comment resolved" : "comments resolved"}` }
      case "comment_reopened":
        return { label: `${count} ${count === 1 ? "comment re-opened" : "comments re-opened"}` }
      default:
        return { label: `${count} ${count === 1 ? "update" : "updates"}` }
    }
  }

  // Mixed-type batches
  const allPropertyTypes = [
    "status_changed", "assignee_added", "assignee_removed",
    "category_changed", "due_date_changed", "project_changed", "billable_changed",
  ]
  const propertyCount = batch.items.filter((item) => allPropertyTypes.includes(item.type)).length
  const timeCount = batch.items.filter((item) => item.type.startsWith("time_entry_")).length

  if (propertyCount > 0 && timeCount === 0) {
    return { label: `${propertyCount} ${propertyCount === 1 ? "property updated" : "properties updated"}` }
  }
  if (timeCount > 0 && propertyCount === 0) {
    return { label: `${timeCount} ${timeCount === 1 ? "time update" : "time updates"}` }
  }

  return { label: `${batch.count} ${batch.count === 1 ? "change" : "changes"}` }
}

function getRowIcon(type: string) {
  switch (type) {
    case "status_changed":
    case "subtask_completed":
      return CircleCheckBig
    case "assignee_added":
    case "assignee_removed":
      return UserRound
    case "project_changed":
      return FolderOpen
    case "category_changed":
      return Tags
    case "time_entry_logged":
    case "time_entry_edited":
    case "time_entry_deleted":
      return Clock3
    case "comment_resolved":
      return CircleCheck
    case "comment_reopened":
      return MessageSquare
    default:
      return Activity
  }
}

export function ActivityBatch({
  batch,
  currentUserId,
}: {
  batch: AuditBatch
  currentUserId?: Id<"users">
}) {
  const { label, highlight } = getBatchSummary(batch)
  const batchTime = formatBatchTimeRange(batch.startTime, batch.endTime)

  return (
    <Collapsible className="my-2">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-2 text-left transition-colors hover:bg-muted/40">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground/15">
          <Activity className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <span className="text-[13px] font-medium text-foreground/60">
          {label}
          {highlight && (
            <span className="font-semibold text-foreground/80"> {highlight}</span>
          )}
        </span>
        <span className="text-[12px] text-muted-foreground/50">{batchTime}</span>
        <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150 group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 duration-150">
        <TooltipProvider delayDuration={300}>
          <div className="ml-[11px] border-l-2 border-muted pl-[17px] py-1.5">
            {batch.items.map((item) => {
              const displayName =
                currentUserId && item.userId === currentUserId
                  ? "You"
                  : firstName(item.userName ?? "Someone")

              const { text, highlight: rowHighlight } = formatActivityText(
                item.type as ActivityEventType,
                displayName,
                item.metadata,
              )
              const RowIcon = getRowIcon(item.type)
              const rowTime = new Date(item.createdAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              }).toLowerCase()
              const rowFullDate = new Date(item.createdAt).toLocaleString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
                hour12: true,
              })

              return (
                <div key={item.id} className="group/row flex items-center gap-2 py-[5px] text-[12.5px] text-muted-foreground">
                  <RowIcon className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.5} />
                  <span className="flex-1">
                    {text}
                    {rowHighlight && (
                      <span className="font-medium text-foreground/80"> {rowHighlight}</span>
                    )}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 text-[11px] text-muted-foreground/0 transition-colors duration-150 group-hover/row:text-muted-foreground/50">
                        {rowTime}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      {rowFullDate}
                    </TooltipContent>
                  </Tooltip>
                </div>
              )
            })}
          </div>
        </TooltipProvider>
      </CollapsibleContent>
    </Collapsible>
  )
}

"use client"

import { Activity, ChevronRight, CircleCheckBig, Clock3, FolderOpen, Tags, UserRound } from "lucide-react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { firstName, formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AuditBatch } from "@/lib/activity-grouping"
import type { Id } from "@/convex/_generated/dataModel"

function getBatchSummary(batch: AuditBatch): string {
  const types = new Set(batch.items.map((item) => item.type))
  const allPropertyTypes = [
    "status_changed",
    "assignee_added",
    "assignee_removed",
    "category_changed",
    "due_date_changed",
    "project_changed",
    "billable_changed",
  ]

  const propertyCount = batch.items.filter((item) => allPropertyTypes.includes(item.type)).length
  const timeCount = batch.items.filter((item) => item.type.startsWith("time_entry_")).length

  if (types.size === 1) {
    const [type] = [...types]
    switch (type) {
      case "status_changed":
        return `${batch.count} ${batch.count === 1 ? "property updated" : "properties updated"}`
      case "assignee_added":
      case "assignee_removed":
        return `${batch.count} ${batch.count === 1 ? "assignment updated" : "assignments updated"}`
      case "due_date_changed":
        return `${batch.count} ${batch.count === 1 ? "property updated" : "properties updated"}`
      case "category_changed":
      case "project_changed":
        return `${batch.count} ${batch.count === 1 ? "property updated" : "properties updated"}`
      case "billable_changed":
        return `${batch.count} ${batch.count === 1 ? "property updated" : "properties updated"}`
      case "time_entry_logged":
      case "time_entry_edited":
      case "time_entry_deleted":
        return `${batch.count} time ${batch.count === 1 ? "update" : "updates"}`
      case "subtask_created":
      case "subtask_completed":
      case "subtask_deleted":
        return `${batch.count} ${batch.count === 1 ? "subtask updated" : "subtasks updated"}`
      default:
        return `${batch.count} ${batch.count === 1 ? "property updated" : "properties updated"}`
    }
  }

  if (propertyCount > 0 && timeCount === 0) {
    return `${propertyCount} ${propertyCount === 1 ? "property updated" : "properties updated"}`
  }

  if (timeCount > 0 && propertyCount === 0) {
    return `${timeCount} ${timeCount === 1 ? "time update" : "time updates"}`
  }

  return `${batch.count} ${batch.count === 1 ? "change" : "changes"}`
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
  const label = getBatchSummary(batch)
  const batchTime = formatRelativeTime(batch.endTime)

  return (
    <Collapsible className="my-2">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-2 text-left transition-colors hover:bg-muted/40">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <Activity className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <span className="text-[13px] font-medium text-muted-foreground">
          {label}
        </span>
        <span className="text-[12px] text-muted-foreground/50">{batchTime}</span>
        <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150 group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1 duration-150">
        <div className="ml-5 border-l-2 border-muted pl-4 py-1.5">
          {batch.items.map((item) => {
            const displayName =
              currentUserId && item.userId === currentUserId
                ? "You"
                : firstName(item.userName ?? "Someone")

            const { text, highlight } = formatActivityText(
              item.type as ActivityEventType,
              displayName,
              item.metadata,
            )
            const RowIcon = getRowIcon(item.type)

            return (
              <div key={item.id} className="flex items-center gap-2 py-[5px] text-[12.5px] text-muted-foreground">
                <RowIcon className="size-3.5 shrink-0 text-muted-foreground/60" strokeWidth={1.5} />
                <span>
                  {text}
                  {highlight && (
                    <span className="font-medium text-foreground/80"> {highlight}</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

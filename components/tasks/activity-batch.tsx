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
    <Collapsible className="my-3.5 first:mt-0">
      <CollapsibleTrigger className="group grid w-full grid-cols-[28px_minmax(0,1fr)_72px_16px] items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/20">
        <div className="relative flex self-stretch items-center justify-center">
          <div className="relative z-10 flex size-8 items-center justify-center bg-background">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted-foreground/15 text-muted-foreground">
              <Activity className="size-3.5 shrink-0" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground/88">
          {label}
        </div>
        <div className="w-[72px] shrink-0 text-right text-xs text-muted-foreground/78">{batchTime}</div>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-1 pt-1">
          <div className="ml-[26px] border-l border-border/50 pl-[21px]">
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
                <div key={item.id} className="grid grid-cols-[20px_minmax(0,1fr)_72px] items-start gap-3 py-2">
                  <div className="relative z-10 flex pt-[2px] text-muted-foreground/60">
                    <div className="flex size-5 items-center justify-center rounded-full bg-muted/60 text-muted-foreground/85">
                      <RowIcon className="size-2.5" strokeWidth={2} />
                    </div>
                  </div>
                  <div className="min-w-0 pt-[2px] text-[13px] leading-5 text-foreground/72">
                    {text}
                    {highlight && (
                      <span className="font-medium text-foreground/92"> {highlight}</span>
                    )}
                  </div>
                  <div className="pt-0.5 text-right text-xs text-muted-foreground/62">
                    {formatRelativeTime(item.createdAt)}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

"use client"

import { Activity, ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { formatBatchTimeRange, firstName, pluralize } from "@/lib/format"
import type { AuditBatch } from "@/lib/activity-grouping"
import type { Id } from "@/convex/_generated/dataModel"

export function ActivityBatch({
  batch,
  currentUserId,
}: {
  batch: AuditBatch
  currentUserId?: Id<"users">
}) {
  const label = `${batch.count} ${pluralize(batch.count, "change", "changes")}`
  const timeRange = formatBatchTimeRange(batch.startTime, batch.endTime)

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-muted/50">
        <Activity className="size-3.5 shrink-0 text-muted-foreground/40" />
        <span className="text-xs text-muted-foreground/50">
          {label}
          <span className="mx-1.5 text-muted-foreground/30">&middot;</span>
          {timeRange}
        </span>
        <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/30 transition-transform duration-200 data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pb-1 pt-0.5">
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

            return (
              <div
                key={item.id}
                className="py-0.5 pl-6 text-xs text-muted-foreground/50"
              >
                <span className="mr-1.5 text-muted-foreground/30">&middot;</span>
                {text}
                {highlight && (
                  <span className="font-medium text-muted-foreground/70"> {highlight}</span>
                )}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

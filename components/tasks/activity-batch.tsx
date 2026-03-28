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
    <Collapsible className="my-3">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-3 py-0.5 hover:opacity-80">
        <div className="h-px flex-1 bg-border/30" />
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground/40">
          <Activity className="size-3 shrink-0" />
          <span className="text-[11px]">{label}</span>
          <span className="text-[10px]">&middot;</span>
          <span className="text-[10px]">{timeRange}</span>
          <ChevronRight className="size-2.5 shrink-0 transition-transform duration-200 data-[state=open]:rotate-90" />
        </div>
        <div className="h-px flex-1 bg-border/30" />
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

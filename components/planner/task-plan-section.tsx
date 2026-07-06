"use client"

import { useQuery, useMutation, useConvexAuth } from "convex/react"
import { XIcon, CalendarRangeIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { MetadataRow } from "@/components/tasks/task-detail-metadata"
import { formatSegmentRange, spanDays } from "@/lib/planner"
import { toastError } from "@/lib/toast-helpers"

/**
 * The task drawer's "Plan" section: every sitting of the task on the
 * Planner board — date range · person · duration · part n/m — with a
 * per-segment unschedule (×) for admins. Renders wherever the task
 * metadata component is used (drawer, modal), not only on /planner;
 * the board behind updates live through the weekGrid subscription.
 */
export function TaskPlanSection({
  taskId,
  isAdmin,
  variant = "stacked",
}: {
  taskId: Id<"tasks">
  isAdmin: boolean
  variant?: "inline" | "stacked"
}) {
  const { isAuthenticated } = useConvexAuth()
  const segments = useQuery(
    api.planner.taskSegments,
    isAuthenticated ? { taskId } : "skip",
  )
  const removeSegment = useMutation(api.planner.removeSegment)

  const handleRemove = (segmentId: Id<"planSegments">) => {
    void removeSegment({ id: segmentId }).catch((err) =>
      toastError(err, "Couldn't unschedule the segment"),
    )
  }

  return (
    <MetadataRow icon={CalendarRangeIcon} label="Plan" variant={variant}>
      {segments === undefined ? (
        <div className="space-y-1.5 py-0.5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ) : segments.length === 0 ? (
        <span className="text-[13px] text-foreground/50">Not scheduled</span>
      ) : (
        <ul className="flex flex-col gap-1 py-0.5">
          {segments.map((seg) => (
            <li
              key={seg._id}
              className="group/plan flex min-w-0 items-center gap-1.5 text-[13px] text-foreground"
            >
              <span className="whitespace-nowrap tabular-nums">
                {formatSegmentRange(seg.startDate, seg.endDate)}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {seg.userName}
              </span>
              <span className="text-muted-foreground/60">·</span>
              <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                {spanDays(seg)}d
              </span>
              {seg.partCount > 1 ? (
                <span className="flex-none rounded bg-muted px-[5px] py-px font-mono text-[10px] tabular-nums text-muted-foreground">
                  {seg.partIndex}/{seg.partCount}
                </span>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  aria-label="Unschedule this sitting"
                  onClick={() => handleRemove(seg._id)}
                  className="ml-auto flex-none rounded p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/plan:opacity-100"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </MetadataRow>
  )
}

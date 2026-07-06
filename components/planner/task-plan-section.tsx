"use client"

import { useQuery, useMutation, useConvexAuth } from "convex/react"
import { XIcon, CalendarRangeIcon, SunIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { MetadataRow } from "@/components/tasks/task-detail-metadata"
import { formatSegmentRange, spanDays } from "@/lib/planner"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/**
 * The task drawer's "Plan" section: every sitting of the task on the
 * Planner board — date range · person · duration · part n/m. Segments
 * covering today are highlighted. A member can unschedule (×) and add to
 * today for their OWN segments (self-service — the server enforces the same
 * admin-or-self rule); other people's sittings stay read-only for members,
 * admins keep full control. Updates live via the weekGrid subscription.
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
  const plan = useQuery(
    api.planner.taskSegments,
    isAuthenticated ? { taskId } : "skip",
  )
  const removeSegment = useMutation(api.planner.removeSegment)
  const addToToday = useMutation(api.planner.addToToday)

  const handleRemove = (segmentId: Id<"planSegments">) => {
    void removeSegment({ id: segmentId }).catch((err) =>
      toastError(err, "Couldn't unschedule the segment"),
    )
  }

  const handleAddToday = () => {
    void addToToday({ taskId })
      .then((r) => {
        if (r.added) toast.success("Added to today — visible in your Planner row")
      })
      .catch((err) => toastError(err, "Failed to add to today"))
  }

  const segments = plan?.segments

  return (
    <MetadataRow icon={CalendarRangeIcon} label="Plan" variant={variant}>
      {plan === undefined || segments === undefined ? (
        <div className="space-y-1.5 py-0.5">
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ) : segments.length === 0 ? (
        <div className="flex items-center gap-2 py-0.5">
          <span className="text-[13px] text-foreground/50">Not scheduled</span>
          {plan.canAddToToday ? (
            <AddTodayButton onClick={handleAddToday} />
          ) : null}
        </div>
      ) : (
        <ul className="flex flex-col gap-1 py-0.5">
          {segments.map((seg) => {
            // A member may unschedule only their own sittings; admins any.
            const canRemove = isAdmin || seg.isMine
            return (
              <li
                key={seg._id}
                className={cn(
                  "group/plan flex min-w-0 items-center gap-1.5 rounded px-1 text-[13px] text-foreground",
                  seg.coversToday && "bg-amber-500/10",
                )}
              >
                {seg.coversToday ? (
                  <SunIcon className="size-3 shrink-0 text-amber-500" />
                ) : null}
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
                {canRemove ? (
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
            )
          })}
          {plan.canAddToToday ? (
            <li className="pt-0.5">
              <AddTodayButton onClick={handleAddToday} />
            </li>
          ) : null}
        </ul>
      )}
    </MetadataRow>
  )
}

/** Quiet dashed "Add to today" affordance (self-service, no pills). */
function AddTodayButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-foreground"
    >
      <SunIcon className="size-3" />
      Add to today
    </button>
  )
}

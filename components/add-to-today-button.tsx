"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { SunIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

const REMOVAL_TOASTS: Record<"deleted" | "trimmed" | "split", string> = {
  deleted: "Removed from today",
  trimmed: "Removed from today — the other days stay planned",
  split: "The bar split — today was removed, other days stay planned",
}

/**
 * The single shared day-planning affordance — a small inline chip that sits
 * next to the task title (where the eye lands), same everywhere it appears.
 *
 * States (the chip never repeats what its container already says):
 * - not in today → hover-revealed DASHED "Add to today" (or "Move to today"
 *   on Earlier rows). Quiet until you hover the row — non-intrusive.
 * - in today → SOLID amber "Today" chip. Persistent by default so it is
 *   spottable in a mixed list (/tasks). When `todayImplied` is set (the My
 *   Tasks "Today" group, whose header already says Today), the redundant
 *   badge is dropped entirely — hover reveals only a bare amber remove-sun.
 * - pending → dimmed while the mutation round-trips (no optimistic flip).
 */
export function AddToTodayButton({
  taskId,
  inToday,
  moveToToday = false,
  todayImplied = false,
  className,
}: {
  taskId: Id<"tasks">
  inToday: boolean
  /**
   * Earlier-row framing: the add path reads as "move to today" (the old
   * segment stays as history). Copy only — the mutation is the same
   * idempotent addToToday.
   */
  moveToToday?: boolean
  /**
   * The surrounding container already communicates "today" (e.g. the My Tasks
   * "Today" group). When true, the in-today chip is NOT shown persistently —
   * it reveals on hover only, as the quick "remove from today" affordance, so
   * the state is not redundantly repeated on every row.
   */
  todayImplied?: boolean
  className?: string
}) {
  const addToToday = useMutation(api.planner.addToToday)
  const removeFromToday = useMutation(api.planner.removeFromToday)
  const [pending, setPending] = useState(false)

  const addLabel = moveToToday ? "Move to today" : "Add to today"
  const label = inToday ? "Remove from today" : addLabel

  // In today AND the container already says so (the My Tasks "Today" group):
  // drop the redundant badge entirely — hover reveals a bare "remove from
  // today" sun, no repeated "Today" label.
  const isRemoveOnly = inToday && todayImplied

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (pending) return
    setPending(true)

    const action = inToday
      ? removeFromToday({ taskId }).then((result) => {
          if (result.kind) toast.success(REMOVAL_TOASTS[result.kind])
        })
      : addToToday({ taskId }).then((result) => {
          if (result.added) {
            toast.success(
              moveToToday
                ? "Moved to today — yesterday's plan stays in the record"
                : "Added to today — visible in your Planner row",
            )
          }
        })

    void action
      .catch((err: unknown) =>
        toastError(err, inToday ? "Failed to remove from today" : `Failed to ${addLabel.toLowerCase()}`),
      )
      .finally(() => setPending(false))
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          aria-label={label}
          className={cn(
            "flex shrink-0 items-center rounded-md outline-hidden transition-[color,background-color,border-color,opacity]",
            isRemoveOnly
              ? // Today group: no persistent badge, no redundant word — hover
                // reveals a bare amber remove-sun.
                "size-6 justify-center text-amber-500 hover:bg-muted opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
              : cn(
                  "gap-1 border px-1.5 py-0.5 text-[11px] font-medium leading-none",
                  inToday
                    ? "border-transparent bg-amber-500/10 text-amber-600 hover:bg-amber-500/15"
                    : "border-dashed border-border/70 text-muted-foreground/70 opacity-0 hover:border-amber-500/50 hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100",
                ),
            pending && "opacity-40",
            className,
          )}
        >
          <SunIcon
            className={cn(isRemoveOnly ? "size-4" : "size-3", inToday && "fill-amber-500/90")}
          />
          {isRemoveOnly ? null : inToday ? "Today" : addLabel}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

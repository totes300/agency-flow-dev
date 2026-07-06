"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { SunIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

const REMOVAL_TOASTS: Record<"deleted" | "trimmed" | "split", string> = {
  deleted: "Removed from today",
  trimmed: "Removed from today — the other days stay planned",
  split: "The bar split — today was removed, other days stay planned",
}

/**
 * The sun gesture — the single shared control for personal day-planning.
 *
 * States:
 * - default (not in Today): ghost outline sun; hover-revealed on desktop via
 *   the parent's `group/row`, always visible muted on touch (no hover there)
 * - active (in Today): filled amber sun, always visible — removal is the
 *   mirror image of adding
 * - pending: dimmed while a mutation round-trips (no optimistic flip in v1)
 *
 * Toasts speak in plan terms so the mental model teaches itself.
 */
export function AddToTodayButton({
  taskId,
  inToday,
  className,
}: {
  taskId: Id<"tasks">
  inToday: boolean
  className?: string
}) {
  const addToToday = useMutation(api.planner.addToToday)
  const removeFromToday = useMutation(api.planner.removeFromToday)
  const [pending, setPending] = useState(false)

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
            toast.success("Added to today — visible in your Planner row")
          }
        })

    void action
      .catch((err: unknown) =>
        toastError(err, inToday ? "Failed to remove from today" : "Failed to add to today"),
      )
      .finally(() => setPending(false))
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label={inToday ? "Remove from today" : "Add to today"}
      title={inToday ? "Remove from today" : "Add to today"}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md outline-hidden transition-[color,opacity] hover:bg-muted focus-visible:opacity-100",
        inToday
          ? "text-amber-500 hover:text-amber-600"
          : "text-muted-foreground/60 hover:text-foreground opacity-0 group-hover/row:opacity-100 pointer-coarse:opacity-60",
        pending && "opacity-40",
        className,
      )}
    >
      <SunIcon className={cn("size-4", inToday && "fill-amber-500/90")} />
    </button>
  )
}

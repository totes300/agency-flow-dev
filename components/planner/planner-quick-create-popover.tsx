"use client"

import { useEffect, useRef, type CSSProperties } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import { PlannerCreateForm } from "./planner-create-form"

/**
 * The draw-to-create title popover (mockup `qc`): anchored below the drawn
 * ghost bar INSIDE the row canvas, so it pans with the timeline. Enter
 * creates the task + segment atomically; Escape or a pointer-down outside
 * cancels the pending bar. A failed create keeps the popover and the typed
 * title (the form catches the rejection; the toast comes from the mutation
 * wrapper).
 */
export function PlannerQuickCreatePopover({
  style,
  onConfirm,
  onCancel,
}: {
  /** Absolute position within the row canvas (left of the ghost, below it). */
  style: CSSProperties
  onConfirm: (title: string, projectId: Id<"projects"> | null) => Promise<void>
  onCancel: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)

  // Outside pointer-down cancels (mockup). The popover mounts on the draw's
  // pointerup, so the gesture that created it can never dismiss it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || rootRef.current?.contains(target)) return
      // The project select's dropdown is portaled to <body> — picking an
      // option is not "outside".
      if (target.closest("[data-radix-popper-content-wrapper]")) return
      onCancel()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [onCancel])

  return (
    <div
      ref={rootRef}
      className="absolute z-[20] w-[232px] rounded-[10px] border border-border bg-card p-2.5 shadow-[0_12px_32px_-10px_rgb(0_0_0/0.3)]"
      style={style}
    >
      <PlannerCreateForm
        submitLabel="Create task"
        onSubmit={onConfirm}
        onCancel={onCancel}
      />
    </div>
  )
}

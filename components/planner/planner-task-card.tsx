"use client"

import type { CSSProperties } from "react"
import { CheckIcon } from "lucide-react"
import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Shared domain visual: a task card in the Planner's Tasks panel (and as
 * the floating card while dragging one onto the board). Mockup spec: title
 * on top, client name below, category as a colored dot — no estimate text.
 * Done tasks and already-planned tasks (All tab) render dimmed; planned
 * ones get a "✓ planned" mark.
 */
export function PlannerTaskCard({
  title,
  clientName,
  categoryColor,
  isDone = false,
  showPlannedMark = false,
  draggable = false,
  lifted = false,
  floating = false,
  style,
  onClick,
  onPointerDown,
}: {
  title: string
  clientName: string | null
  categoryColor: string | null
  isDone?: boolean
  /** All tab: the task already has at least one sitting. */
  showPlannedMark?: boolean
  /** Admin affordance: grab cursor + pointer-down starts the drag engine. */
  draggable?: boolean
  /** The card is the source of an active drag (mockup .lift). */
  lifted?: boolean
  /** Render as the cursor-following fly card (stronger shadow, no hover). */
  floating?: boolean
  style?: CSSProperties
  onClick?: () => void
  onPointerDown?: (e: React.PointerEvent) => void
}) {
  const tint = getCategoryColor(categoryColor ?? "gray").dot

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      className={cn(
        "flex w-full select-none items-start gap-2 rounded-[10px] border border-border bg-card px-[11px] py-[9px] text-left",
        floating
          ? "shadow-[0_8px_22px_-8px_rgb(0_0_0/0.3)]"
          : "shadow-[0_1px_2px_rgb(0_0_0/0.05)] transition-[box-shadow,border-color] duration-[120ms] hover:border-foreground/15 hover:shadow-[0_3px_10px_-4px_rgb(0_0_0/0.15)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        (isDone || showPlannedMark) && "opacity-[0.62]",
        draggable && "touch-none cursor-grab",
        lifted && "opacity-35",
      )}
      style={style}
    >
      <span
        aria-hidden
        className="mt-[4.5px] size-2 flex-none rounded-full"
        style={{ backgroundColor: tint }}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold leading-[1.35] text-foreground">
          {title}
        </span>
        <span className="block text-[11px] leading-[1.3] text-muted-foreground">
          {clientName ?? "No client"}
        </span>
      </span>
      {showPlannedMark ? (
        <span className="mt-[3px] flex flex-none items-center gap-1 text-[10.5px] text-muted-foreground">
          <CheckIcon className="size-3" strokeWidth={2.5} />
          planned
        </span>
      ) : null}
    </button>
  )
}

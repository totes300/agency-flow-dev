"use client"

import { useState } from "react"
import { getCategoryColor } from "@/convex/lib/constants"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { PX_PER_MIN } from "@/lib/workday"
import type { WorkdayBox } from "@/convex/workday"
import { WorkdayTaskPopover } from "./workday-task-popover"

type Tier = "full" | "medium" | "small" | "sliver"

function tierFor(heightPx: number): Tier {
  if (heightPx < 18) return "sliver"
  if (heightPx < 36) return "small"
  if (heightPx < 60) return "medium"
  return "full"
}

export function WorkdayTaskBox({
  box,
  onOpenTask,
}: {
  box: WorkdayBox
  onOpenTask: (taskId: WorkdayBox["taskId"]) => void
}) {
  const c = box.categoryColor ? getCategoryColor(box.categoryColor) : null
  const tint = c?.dot ?? "var(--color-muted-foreground)"
  const heightPx = Math.max(6, Math.round(box.totalMinutes * PX_PER_MIN))
  const tier = tierFor(heightPx)
  const isSliver = tier === "sliver"

  // Hover deepens tint 11% → 18% per spec. No transform/lift. Held in state
  // so the inline `backgroundColor` only flips for non-slivers.
  const [hovering, setHovering] = useState(false)
  const tintPct = isSliver ? 50 : hovering ? 18 : 11

  return (
    <WorkdayTaskPopover box={box} onOpenTask={() => onOpenTask(box.taskId)}>
      <button
        type="button"
        onClick={() => onOpenTask(box.taskId)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        data-tier={tier}
        className={cn(
          "relative w-full overflow-hidden rounded-[4px] text-left",
          "transition-[background-color] duration-100 focus:outline-none",
          "focus-visible:outline focus-visible:outline-2",
          isSliver
            ? "p-0"
            : tier === "small"
              ? "px-2.5 py-1"
              : "px-2.5 py-1.5",
        )}
        style={{
          height: `${heightPx}px`,
          backgroundColor: `color-mix(in srgb, ${tint} ${tintPct}%, transparent)`,
          outlineColor: tint,
          outlineOffset: "-1px",
        }}
      >
        {!isSliver && (
          <span
            aria-hidden
            className={cn(
              "absolute left-2 size-1.5 rounded-full",
              tier === "small" ? "top-[7px]" : "top-[9px]",
            )}
            style={{ backgroundColor: tint, opacity: 0.85 }}
          />
        )}

        {(tier === "full" || tier === "medium") && (
          <div className="flex items-baseline justify-between gap-2 pl-3 leading-[1.25]">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-0.005em] text-foreground">
              {box.taskTitle}
            </span>
            <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
              {formatDuration(box.totalMinutes)}
            </span>
          </div>
        )}

        {tier === "small" && (
          <div className="flex items-baseline pl-3 leading-[1.25]">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium tracking-[-0.005em] text-foreground">
              {box.taskTitle}
            </span>
          </div>
        )}

        {tier === "full" && box.projectName && (
          <div className="mt-0.5 truncate pl-3 text-[11.5px] leading-[1.3] text-muted-foreground">
            {box.projectName}
          </div>
        )}
      </button>
    </WorkdayTaskPopover>
  )
}

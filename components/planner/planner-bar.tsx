"use client"

import { useState, type CSSProperties } from "react"
import { CheckIcon } from "lucide-react"
import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/** Two-line bar height per the mockup spec. */
export const PLANNER_BAR_HEIGHT_PX = 46
/** Vertical rhythm: one lane = bar height + gap. */
export const PLANNER_LANE_PX = 52
/** Top/bottom padding inside a row canvas. */
export const PLANNER_ROW_PAD_PX = 7

/**
 * Shared domain visual: a plan segment bar. Category-tinted (gray when the
 * task has no category), task title on line one, project name on line two,
 * part badge (`1/2`) on split tasks, day-count label, done check. Clipped
 * edges render squared-off so a bar that continues beyond the visible range
 * is recognizable. Selection ring + dashed sibling outline follow the mockup.
 *
 * Preview variants (drag engine): `ghost` is the snapped drop target of a
 * move/⌥-copy (tinted card + shadow); `solid` is the resize preview — it
 * REPLACES the original bar so "the bar itself" appears to snap day-by-day
 * (mockup ruling: no separate preview element for resize).
 */
export function PlannerBar({
  title,
  projectName,
  categoryColor,
  partIndex,
  partCount,
  durationDays,
  visibleSpanDays,
  labelMinSpan = 2,
  isDone = false,
  isSelected = false,
  isSibling = false,
  preview,
  copyGlyph = false,
  canDrag = false,
  animateTop = false,
  clippedStart = false,
  clippedEnd = false,
  style,
  onClick,
  onHoverChange,
  onPointerDown,
  onResizePointerDown,
}: {
  title: string
  projectName: string | null
  categoryColor: string | null
  partIndex: number
  partCount: number
  /** Full segment span in days (not clamped to the visible range). */
  durationDays: number
  /** Days of the bar visible in range — labels hide below `labelMinSpan`. */
  visibleSpanDays: number
  /** Density-dependent label threshold (wider in the month zoom). */
  labelMinSpan?: number
  isDone?: boolean
  isSelected?: boolean
  isSibling?: boolean
  /** Drag preview variant — see the component doc comment. */
  preview?: "ghost" | "solid"
  /** ⌥-copy affordance: prefix the title with the ⧉ glyph (mockup parity). */
  copyGlyph?: boolean
  /** Admin affordance: grab cursor + pointer-down starts the drag engine. */
  canDrag?: boolean
  /** Animate `top` during live lane reflow (only while a drag is active). */
  animateTop?: boolean
  clippedStart?: boolean
  clippedEnd?: boolean
  style?: CSSProperties
  onClick?: () => void
  onHoverChange?: (hovering: boolean) => void
  onPointerDown?: (e: React.PointerEvent) => void
  /** Edge handles (rendered for draggable bars) start a resize drag. */
  onResizePointerDown?: (edge: "start" | "end", e: React.PointerEvent) => void
}) {
  const tint = getCategoryColor(categoryColor ?? "gray").dot

  // Hover deepens the tint 15% → 22% (mockup). Held in state because the
  // background is an inline color-mix, not a Tailwind class.
  const [hovering, setHovering] = useState(false)
  const tintPct = hovering && !preview ? 22 : 15

  const showLabels = visibleSpanDays >= labelMinSpan
  const showHandles = canDrag && !preview && !!onResizePointerDown

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onPointerDown={onPointerDown}
      onMouseEnter={() => {
        setHovering(true)
        onHoverChange?.(true)
      }}
      onMouseLeave={() => {
        setHovering(false)
        onHoverChange?.(false)
      }}
      className={cn(
        "group/bar absolute flex flex-col justify-center gap-px overflow-hidden rounded-md px-2.5 py-[5px] text-left text-[12.5px]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        animateTop
          ? "transition-[top,background-color,box-shadow] duration-[120ms] ease-out"
          : preview === "solid"
            ? "transition-[left,width] duration-100 ease-out"
            : "transition-[background-color,box-shadow] duration-100",
        clippedStart && "rounded-l-none",
        clippedEnd && "rounded-r-none",
        isDone && "opacity-[0.62]",
        canDrag && !preview && "touch-none cursor-grab",
        preview && "pointer-events-none z-10",
        preview === "ghost" && "shadow-[0_6px_16px_-8px_rgb(0_0_0/0.35)]",
      )}
      style={{
        ...style,
        height: `${PLANNER_BAR_HEIGHT_PX}px`,
        backgroundColor:
          preview === "ghost"
            ? `color-mix(in srgb, ${tint} 20%, var(--card))`
            : `color-mix(in srgb, ${tint} ${tintPct}%, transparent)`,
        color: `color-mix(in srgb, ${tint} 52%, var(--foreground))`,
        boxShadow: isSelected
          ? `0 0 0 2px color-mix(in srgb, ${tint} 65%, transparent)`
          : undefined,
        outline: isSibling
          ? `1.5px dashed color-mix(in srgb, ${tint} 55%, transparent)`
          : undefined,
        outlineOffset: isSibling ? "1px" : undefined,
      }}
    >
      <span className="flex min-w-0 items-center gap-[7px]">
        {isDone ? (
          <CheckIcon
            aria-label="Done"
            className="size-2.5 flex-none"
            strokeWidth={3}
            style={{ color: tint }}
          />
        ) : (
          <span
            aria-hidden
            className="size-2 flex-none rounded-full"
            style={{ backgroundColor: tint }}
          />
        )}
        <span className="min-w-0 truncate font-semibold">
          {copyGlyph ? "⧉ " : ""}
          {title}
        </span>
        {partCount > 1 && showLabels ? (
          <span
            className="flex-none rounded px-[5px] py-px font-mono text-[10px] tabular-nums"
            style={{
              backgroundColor: `color-mix(in srgb, ${tint} 18%, transparent)`,
            }}
          >
            {partIndex}/{partCount}
          </span>
        ) : null}
        {showLabels ? (
          <span className="ml-auto flex-none font-mono text-[10.5px] tabular-nums opacity-75">
            {durationDays}d
          </span>
        ) : null}
      </span>
      <span
        className="truncate pl-[15px] text-[11px] leading-[1.25]"
        style={{
          color: `color-mix(in srgb, ${tint} 34%, var(--muted-foreground))`,
        }}
      >
        {projectName ?? "No project"}
      </span>

      {/* Resize handles — 9px hit zones, pill affordance on bar hover (mockup) */}
      {showHandles ? (
        <>
          {(["start", "end"] as const).map((edge) => (
            <span
              key={edge}
              className={cn(
                "absolute inset-y-0 w-[9px] cursor-ew-resize touch-none",
                edge === "start" ? "left-0" : "right-0",
              )}
              onPointerDown={(e) => {
                e.stopPropagation()
                onResizePointerDown?.(edge, e)
              }}
            >
              <span
                className={cn(
                  "absolute bottom-[13px] top-[13px] w-[3px] rounded-[2px] opacity-0 transition-opacity group-hover/bar:opacity-100",
                  edge === "start" ? "left-[3px]" : "right-[3px]",
                )}
                style={{
                  backgroundColor: `color-mix(in srgb, ${tint} 55%, transparent)`,
                }}
              />
            </span>
          ))}
        </>
      ) : null}
    </button>
  )
}

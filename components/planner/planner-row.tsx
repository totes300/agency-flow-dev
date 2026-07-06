"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { UserAvatar } from "@/components/user-avatar"
import {
  assignLanes,
  clampToRange,
  proposeLaneOrder,
  spanDays,
} from "@/lib/planner"
import type { PlannerSegmentBar, PlannerUserRow as PlannerUserRowData } from "@/convex/planner"
import type { Id } from "@/convex/_generated/dataModel"
import {
  PlannerBar,
  PLANNER_BAR_HEIGHT_PX,
  PLANNER_LANE_PX,
  PLANNER_ROW_PAD_PX,
} from "./planner-bar"
import { PlannerDayStripes } from "./planner-day-stripes"
import { PlannerQuickCreatePopover } from "./planner-quick-create-popover"

/** Gap between the drawn ghost bar and its title popover (mockup: 52). */
const QUICK_CREATE_OFFSET_PX = PLANNER_BAR_HEIGHT_PX + 6

/** Snapped drag preview rendered in this row: `ghost` for move/⌥-copy
 *  (drop-target card), `solid` for resize (replaces the original bar so the
 *  bar itself appears to snap). */
export type PlannerRowPreview = {
  seg: PlannerSegmentBar
  startDate: string
  endDate: string
  kind: "ghost" | "solid"
  /** ⌥ held: the ghost represents a NEW sitting of the same task. */
  copy: boolean
  /** Pointer lane (move drags): the ghost restacks to this position among
   *  colliding bars, previewing the manual reorder before the drop. */
  lane?: number | null
}

export function PlannerRow({
  row,
  days,
  dayPx,
  gridTemplate,
  weekendFlags,
  todayFlags,
  weekStartFlags,
  labelMinSpan,
  highlightTaskId,
  highlightAnchorId,
  selectedSegmentId,
  canDrag,
  dragActive,
  excludeSegmentId,
  preview,
  quickCreate,
  rowRefCallback,
  onBarHover,
  onBarClick,
  onBarPointerDown,
  onResizePointerDown,
  onCanvasPointerDown,
}: {
  row: PlannerUserRowData
  days: string[]
  dayPx: number
  gridTemplate: string
  weekendFlags: boolean[]
  todayFlags: boolean[]
  weekStartFlags?: boolean[]
  /** Minimum visible span (days) before bar labels appear (density-based). */
  labelMinSpan: number
  /** Task whose segments get the sibling outline (hovered or selected). */
  highlightTaskId: Id<"tasks"> | null
  /** The anchor segment (hovered/selected) — excluded from the outline. */
  highlightAnchorId: Id<"planSegments"> | null
  selectedSegmentId: Id<"planSegments"> | null
  /** Admin: bars get grab cursors and start the drag engine. */
  canDrag: boolean
  /** A drag is in progress somewhere on the board (enables reflow motion). */
  dragActive: boolean
  /** The dragged segment — hidden from its source row while dragging. */
  excludeSegmentId: Id<"planSegments"> | null
  preview: PlannerRowPreview | null
  /** Draw-to-create released on this row: anchor the title popover to the
   *  pending ghost bar (which arrives via `preview`). */
  quickCreate?: {
    onConfirm: (
      title: string,
      projectId: Id<"projects"> | null,
    ) => Promise<void>
    onCancel: () => void
  } | null
  rowRefCallback?: (el: HTMLElement | null) => void
  onBarHover: (
    segment: { segmentId: Id<"planSegments">; taskId: Id<"tasks"> } | null,
  ) => void
  onBarClick: (segmentId: Id<"planSegments">, taskId: Id<"tasks">) => void
  onBarPointerDown: (
    seg: PlannerSegmentBar,
    sourceUserId: Id<"users">,
  ) => (e: React.PointerEvent) => void
  onResizePointerDown: (
    seg: PlannerSegmentBar,
    sourceUserId: Id<"users">,
  ) => (edge: "start" | "end", e: React.PointerEvent) => void
  /** Admin: press on empty cells starts draw-to-create (bar presses stop
   *  propagation in the engine, so only empty-cell presses arrive). */
  onCanvasPointerDown?: (e: React.PointerEvent) => void
}) {
  const dayCount = days.length
  const rangeStart = days[0]
  const rangeEnd = days[dayCount - 1]

  // Draw-to-create affordance (owner ruling: no crosshair): hovering an
  // empty cell shows a faint "+" day placeholder — the Notion Calendar /
  // Toggl Plan pattern. Ephemeral hover state, admin rows only.
  const [hoverDayIdx, setHoverDayIdx] = useState<number | null>(null)

  // Clamp to the loaded window, drop the in-flight dragged segment, then
  // pack overlaps into lanes — the ghost preview participates, so
  // neighbouring bars reflow live around the drop target.
  const bars = row.segments.flatMap((seg) => {
    if (seg._id === excludeSegmentId) return []
    const clamped = clampToRange(seg, rangeStart, rangeEnd)
    return clamped ? [{ seg, ...clamped }] : []
  })
  const previewClamped = preview
    ? clampToRange(preview, rangeStart, rangeEnd)
    : null
  // Stable packing: priority = stored laneOrder (creation time until the
  // owner restacks manually), so editing a bar's dates never reshuffles
  // its neighbours. A move ghost carrying a pointer lane previews the
  // manual restack live (same math the drop commits); a resize preview
  // inherits the dragged segment's own priority; ⌥-copy and the synthetic
  // panel/draw ghosts are NEW sittings — they yield to everything.
  const previewOrder = !preview
    ? 0
    : preview.copy
      ? Number.MAX_SAFE_INTEGER
      : preview.lane != null
        ? proposeLaneOrder({
            segments: row.segments,
            excludeId: excludeSegmentId,
            target: { startDate: preview.startDate, endDate: preview.endDate },
            pointerLane: preview.lane,
            rangeStart,
            rangeEnd,
            currentOrder: preview.seg.laneOrder,
          }) ?? preview.seg.laneOrder
        : preview.seg.laneOrder
  const laneInput = [
    ...bars.map((b) => ({
      startIdx: b.startIdx,
      endIdx: b.endIdx,
      order: b.seg.laneOrder,
    })),
    ...(previewClamped
      ? [
          {
            startIdx: previewClamped.startIdx,
            endIdx: previewClamped.endIdx,
            order: previewOrder,
          },
        ]
      : []),
  ]
  const lanes = assignLanes(laneInput)
  const laneCount = Math.max(1, ...lanes.map((l) => l + 1))
  const canvasHeight = laneCount * PLANNER_LANE_PX + PLANNER_ROW_PAD_PX * 2
  const previewLane = previewClamped ? lanes[lanes.length - 1] : 0

  // The hover "+" placeholder sits in the first lane free at the hovered
  // day; hidden while any drag/preview/popover is active, and on days
  // whose every existing lane is occupied (the row must not grow on
  // hover — drawing still works there, it just packs a new lane).
  let hoverCellLane: number | null = null
  if (
    canDrag &&
    onCanvasPointerDown &&
    hoverDayIdx !== null &&
    !dragActive &&
    !preview &&
    !quickCreate
  ) {
    const occupied = new Set<number>()
    bars.forEach((b, i) => {
      if (b.startIdx <= hoverDayIdx && hoverDayIdx <= b.endIdx) {
        occupied.add(lanes[i])
      }
    })
    let lane = 0
    while (occupied.has(lane)) lane++
    if (lane < laneCount) hoverCellLane = lane
  }

  return (
    <div
      ref={rowRefCallback}
      className="grid border-b border-border"
      style={{ gridTemplateColumns: gridTemplate }}
    >
      {/* People rail — sticky under horizontal scroll */}
      <div className="sticky left-0 z-[5] flex items-center gap-2.5 border-r border-border bg-card px-3.5 py-2.5">
        <UserAvatar name={row.user.name} imageUrl={row.user.imageUrl} />
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13px] font-semibold leading-[1.25] text-foreground">
            {row.user.name}
          </span>
          <span className="text-[11px] capitalize leading-[1.2] text-muted-foreground">
            {row.user.role}
          </span>
        </div>
      </div>

      {/* Day canvas — stripes for day boundaries, bars positioned by date */}
      <div
        className={cn(
          "relative",
          dragActive && "transition-[height] duration-[120ms] ease-out",
        )}
        style={{ gridColumn: "2 / -1", height: `${canvasHeight}px` }}
        onPointerDown={canDrag ? onCanvasPointerDown : undefined}
        onMouseMove={
          canDrag && onCanvasPointerDown
            ? (e) => {
                // Over a bar (or its handles) the placeholder hides.
                if ((e.target as HTMLElement).closest("button")) {
                  setHoverDayIdx(null)
                  return
                }
                const rect = e.currentTarget.getBoundingClientRect()
                const idx = Math.max(
                  0,
                  Math.min(
                    dayCount - 1,
                    Math.floor((e.clientX - rect.left) / dayPx),
                  ),
                )
                setHoverDayIdx((prev) => (prev === idx ? prev : idx))
              }
            : undefined
        }
        onMouseLeave={
          canDrag && onCanvasPointerDown
            ? () => setHoverDayIdx(null)
            : undefined
        }
      >
        <PlannerDayStripes
          days={days}
          dayPx={dayPx}
          weekendFlags={weekendFlags}
          todayFlags={todayFlags}
          weekStartFlags={weekStartFlags}
        />

        {bars.map((b, i) => {
          const isSelected = b.seg._id === selectedSegmentId
          return (
            <PlannerBar
              key={b.seg._id}
              title={b.seg.taskTitle}
              projectName={b.seg.projectName}
              categoryColor={b.seg.categoryColor}
              partIndex={b.seg.partIndex}
              partCount={b.seg.partCount}
              durationDays={spanDays(b.seg)}
              visibleSpanDays={b.endIdx - b.startIdx + 1}
              labelMinSpan={labelMinSpan}
              isDone={b.seg.statusType === "done"}
              isSelected={isSelected}
              isSibling={
                !isSelected &&
                highlightTaskId === b.seg.taskId &&
                highlightAnchorId !== b.seg._id
              }
              canDrag={canDrag}
              animateTop={dragActive}
              clippedStart={b.clippedStart}
              clippedEnd={b.clippedEnd}
              style={{
                left: `${b.startIdx * dayPx}px`,
                width: `${(b.endIdx - b.startIdx + 1) * dayPx}px`,
                top: `${PLANNER_ROW_PAD_PX + lanes[i] * PLANNER_LANE_PX}px`,
              }}
              onClick={() => onBarClick(b.seg._id, b.seg.taskId)}
              onHoverChange={(hovering) =>
                onBarHover(
                  hovering
                    ? { segmentId: b.seg._id, taskId: b.seg.taskId }
                    : null,
                )
              }
              // Move/resize only start on editable rows; on read-only rows the
              // bar is click-to-open only (canDrag false → no grab, no handles).
              onPointerDown={
                canDrag ? onBarPointerDown(b.seg, row.user._id) : undefined
              }
              onResizePointerDown={onResizePointerDown(b.seg, row.user._id)}
            />
          )
        })}

        {previewClamped && preview ? (
          <PlannerBar
            title={preview.seg.taskTitle}
            projectName={preview.seg.projectName}
            categoryColor={preview.seg.categoryColor}
            partIndex={preview.seg.partIndex}
            partCount={preview.seg.partCount}
            durationDays={spanDays(preview)}
            visibleSpanDays={previewClamped.endIdx - previewClamped.startIdx + 1}
            labelMinSpan={labelMinSpan}
            isDone={preview.seg.statusType === "done"}
            preview={preview.kind}
            copyGlyph={preview.copy}
            clippedStart={previewClamped.clippedStart}
            clippedEnd={previewClamped.clippedEnd}
            style={{
              left: `${previewClamped.startIdx * dayPx}px`,
              width: `${(previewClamped.endIdx - previewClamped.startIdx + 1) * dayPx}px`,
              top: `${PLANNER_ROW_PAD_PX + previewLane * PLANNER_LANE_PX}px`,
            }}
          />
        ) : null}

        {hoverCellLane !== null && hoverDayIdx !== null ? (
          <div
            aria-hidden
            className="pointer-events-none absolute flex items-center justify-center rounded-md border border-border/60 bg-[color-mix(in_srgb,var(--foreground)_3%,transparent)]"
            style={{
              left: `${hoverDayIdx * dayPx + 3}px`,
              width: `${dayPx - 6}px`,
              top: `${PLANNER_ROW_PAD_PX + hoverCellLane * PLANNER_LANE_PX}px`,
              height: `${PLANNER_BAR_HEIGHT_PX}px`,
            }}
          >
            <PlusIcon className="size-3.5 text-muted-foreground/70" />
          </div>
        ) : null}

        {quickCreate && previewClamped ? (
          <PlannerQuickCreatePopover
            style={{
              left: `${previewClamped.startIdx * dayPx}px`,
              top: `${PLANNER_ROW_PAD_PX + previewLane * PLANNER_LANE_PX + QUICK_CREATE_OFFSET_PX}px`,
            }}
            onConfirm={quickCreate.onConfirm}
            onCancel={quickCreate.onCancel}
          />
        ) : null}
      </div>
    </div>
  )
}

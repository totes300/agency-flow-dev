"use client"

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { cn } from "@/lib/utils"
import { dayDiff, isMondayYmd, isWeekendYmd } from "@/lib/planner"
import type { PlannerZoom } from "@/lib/hooks/use-planner-query-args"
import type {
  PlannerDragEngine,
  PlannerDragTarget,
  PlannerPanelTask,
} from "@/lib/hooks/use-planner-drag"
import type { PlannerGridData, PlannerSegmentBar } from "@/convex/planner"
import type { Id } from "@/convex/_generated/dataModel"
import { PlannerDayStripes } from "./planner-day-stripes"
import { PlannerEmptyState } from "./planner-empty-state"
import { PlannerRow } from "./planner-row"

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function dowName(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return DOW_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Fixed day-column width per zoom — the timeline is a continuous canvas,
 *  so zoom is a density preset, not a range pager. */
export const PLANNER_DAY_PX: Record<PlannerZoom, number> = {
  "1w": 160,
  "2w": 96,
  "1m": 44,
}
export const PLANNER_RAIL_PX = 200

/** Bar labels (day count, part badge) need roughly this many pixels. */
const MIN_LABEL_PX = 150
/** Extend the loaded window when scrolled within this many days of an edge. */
const EDGE_THRESHOLD_DAYS = 14

type SegmentRef = {
  segmentId: Id<"planSegments">
  taskId: Id<"tasks">
}

const IGNORE_HOVER = () => {}

/** Synthetic bar for the draw-to-create sketch and its pending state: a
 *  neutral-gray "New task" ghost (the mockup's create-mode bar). */
function drawPreviewSeg(
  startDate: string,
  endDate: string,
  subtitle: string,
): PlannerSegmentBar {
  return {
    _id: "draw-create-preview" as Id<"planSegments">,
    taskId: "draw-create-task" as Id<"tasks">,
    startDate,
    endDate,
    taskTitle: "New task",
    projectName: subtitle, // the bar's second line (mockup `r2`)
    categoryColor: null, // gray — the created task has no category
    statusType: "backlog",
    partIndex: 1,
    partCount: 1,
    // Newest possible priority: the sketch packs below every real bar.
    laneOrder: Number.MAX_SAFE_INTEGER,
  }
}

/** Synthetic bar for the panel-drag ghost; never rendered as a real bar. */
function panelTaskToPreviewSeg(
  task: PlannerPanelTask,
  startDate: string,
  endDate: string,
): PlannerSegmentBar {
  return {
    _id: "panel-drag-preview" as Id<"planSegments">,
    taskId: task.taskId,
    startDate,
    endDate,
    taskTitle: task.title,
    projectName: task.projectName,
    categoryColor: task.categoryColor,
    statusType: task.statusType,
    partIndex: 1,
    partCount: 1, // no part badge on the drop ghost (mockup)
    // Newest possible priority: the drop ghost packs below every real bar.
    laneOrder: Number.MAX_SAFE_INTEGER,
  }
}

/**
 * Continuous fullscreen people × days timeline (Toggl Plan mold): one wide
 * canvas over the loaded day window; trackpad gestures pan time freely,
 * the window grows near its edges (left-extends compensate scroll so the
 * view never jumps), sticky day header + sticky people rail.
 */
export function PlannerGrid({
  data,
  days,
  todayYMD,
  zoom,
  isAdmin,
  anchorYmd,
  scrollRef,
  engine,
  pendingCreate,
  onConfirmCreate,
  onCancelCreate,
  onExtendBack,
  onExtendForward,
  onViewChange,
  onRemoveSegment,
  onOpenTask,
}: {
  data: PlannerGridData
  days: string[]
  todayYMD: string
  zoom: PlannerZoom
  isAdmin: boolean
  /** Monday to scroll to on first render. */
  anchorYmd: string
  /** Owned by the page so the toolbar can drive smooth scrolling. */
  scrollRef: RefObject<HTMLDivElement | null>
  /** Drag engine — owned by the page so the Tasks panel shares it. */
  engine: PlannerDragEngine
  /** A drawn range awaiting its title popover (page state — it must
   *  survive board re-renders while the user types). */
  pendingCreate: PlannerDragTarget | null
  /** Popover Enter: atomic createTaskWithSegment; rejection keeps it open. */
  onConfirmCreate: (
    title: string,
    projectId: Id<"projects"> | null,
  ) => Promise<void>
  onCancelCreate: () => void
  onExtendBack: () => void
  onExtendForward: () => void
  /** Fires with the visible day span while panning (leading edge first). */
  onViewChange: (startYmd: string, endYmd: string) => void
  /** Optimistic unschedule (Delete on selection). */
  onRemoveSegment: (segmentId: Id<"planSegments">) => void
  /** Bar click (all members): open the task detail drawer. */
  onOpenTask: (taskId: Id<"tasks">) => void
}) {
  const [hovered, setHovered] = useState<SegmentRef | null>(null)
  const [selected, setSelected] = useState<SegmentRef | null>(null)

  const dayPx = PLANNER_DAY_PX[zoom]
  const dayCount = days.length
  const windowStart = days[0]

  const {
    drag,
    panelDrag,
    drawDrag,
    onBarPointerDown,
    onResizePointerDown,
    onCanvasPointerDown,
    registerRowEl,
    consumeClickSuppression,
  } = engine
  const dragActive =
    drag !== null ||
    drawDrag !== null ||
    (panelDrag !== null && !panelDrag.settling)

  // A starting drag steals the pointer — stale hover/selection would fight
  // the ghost preview visually.
  useEffect(() => {
    if (dragActive) {
      setHovered(null)
      setSelected(null)
    }
  }, [dragActive])

  // Delete/Backspace unschedules the selected segment (admin only).
  useEffect(() => {
    if (!selected || !isAdmin) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return
      const target = e.target as HTMLElement | null
      if (target?.closest("input, textarea, [contenteditable='true']")) return
      e.preventDefault()
      onRemoveSegment(selected.segmentId)
      setSelected(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selected, isAdmin, onRemoveSegment])

  // ── Scroll engine refs ────────────────────────────────────────────────
  const didInitRef = useRef(false)
  const leftmostRef = useRef(anchorYmd)
  const prevWindowStartRef = useRef(windowStart)
  const prevZoomRef = useRef(zoom)
  const backPendingRef = useRef(false)
  const forwardPendingRef = useRef(false)

  // Initial position: anchor Monday at the left edge.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (didInitRef.current || !el) return
    el.scrollLeft = Math.max(0, dayDiff(windowStart, anchorYmd)) * dayPx
    leftmostRef.current = anchorYmd
    didInitRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Left-extension compensation: keep the viewed day fixed under the cursor
  // when days are prepended (runs before paint — no visible jump).
  useLayoutEffect(() => {
    const prev = prevWindowStartRef.current
    if (prev !== windowStart) {
      const prepended = dayDiff(windowStart, prev)
      const el = scrollRef.current
      if (prepended > 0 && el) el.scrollLeft += prepended * dayPx
      prevWindowStartRef.current = windowStart
      backPendingRef.current = false
    }
    forwardPendingRef.current = false
  }, [windowStart, dayCount, dayPx, scrollRef])

  // Zoom is a density change — re-anchor so the leftmost visible day stays.
  useLayoutEffect(() => {
    if (prevZoomRef.current === zoom) return
    prevZoomRef.current = zoom
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = Math.max(0, dayDiff(windowStart, leftmostRef.current)) * dayPx
  }, [zoom, dayPx, windowStart, scrollRef])

  // Escape clears the selection (keyboard = external system, effect is fine).
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selected])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const leftIdx = Math.min(
      dayCount - 1,
      Math.max(0, Math.floor(el.scrollLeft / dayPx)),
    )
    leftmostRef.current = days[leftIdx]
    const visibleDays = Math.max(
      1,
      Math.floor((el.clientWidth - PLANNER_RAIL_PX) / dayPx),
    )
    onViewChange(
      days[leftIdx],
      days[Math.min(dayCount - 1, leftIdx + visibleDays - 1)],
    )

    if (
      el.scrollLeft < EDGE_THRESHOLD_DAYS * dayPx &&
      !backPendingRef.current
    ) {
      backPendingRef.current = true
      onExtendBack()
    }
    const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth
    if (remaining < EDGE_THRESHOLD_DAYS * dayPx && !forwardPendingRef.current) {
      forwardPendingRef.current = true
      onExtendForward()
    }
  }

  // Report the initial view span once mounted.
  useEffect(() => {
    handleScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, dayCount])

  if (data.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <PlannerEmptyState
          title="No team members yet"
          description="Once members join your organization the team plan will appear here."
        />
      </div>
    )
  }

  const gridTemplate = `${PLANNER_RAIL_PX}px repeat(${dayCount}, ${dayPx}px)`
  const weekendFlags = days.map(isWeekendYmd)
  const todayFlags = days.map((d) => d === todayYMD)
  const isMonthZoom = zoom === "1m"
  // Monday boundaries help orientation among narrow columns.
  const weekStartFlags = isMonthZoom ? days.map(isMondayYmd) : undefined
  const labelMinSpan = Math.ceil(MIN_LABEL_PX / dayPx)

  // Hover wins over selection for the sibling outline (mockup behavior).
  const highlight = hovered ?? selected
  const hasAnyPlan = data.rows.some((r) => r.segments.length > 0)

  // Panel drag: a synthetic segment renders the snapped ghost so the row
  // pipeline (clamp → lanes → PlannerBar) treats it exactly like a bar.
  const panelTarget = panelDrag && !panelDrag.settling ? panelDrag.target : null
  const panelPreviewSeg = panelTarget
    ? panelTaskToPreviewSeg(panelDrag!.task, panelTarget.startDate, panelTarget.endDate)
    : null

  // Draw-to-create: the live sketch while drawing, then the pending ghost
  // the title popover anchors to (same synthetic-segment pipeline).
  const createTarget = drawDrag ?? pendingCreate
  const createPreviewSeg = createTarget
    ? drawPreviewSeg(
        createTarget.startDate,
        createTarget.endDate,
        drawDrag ? "release to name it" : "name it below",
      )
    : null

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-auto overscroll-x-contain bg-card"
        onClick={() => setSelected(null)}
      >
        <div className="flex min-h-full w-max min-w-full flex-col">
          {/* Header row — sticky under vertical scroll */}
          <div
            className="sticky top-0 z-[6] grid border-b border-border bg-card"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div className="sticky left-0 z-[7] flex items-end border-r border-border bg-card px-3.5 pb-[7px] pt-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              Team
            </div>
            {days.map((date, idx) => {
              const [, m, d] = date.split("-")
              const dayNum = parseInt(d, 10)
              const isToday = todayFlags[idx]
              const showMonth = dayNum === 1
              const dow = dowName(date)
              return (
                <div
                  key={date}
                  className={cn(
                    "border-l pb-1.5 pt-[7px] text-center text-[12px] tabular-nums",
                    weekStartFlags?.[idx] ? "border-border" : "border-border/60",
                    weekendFlags[idx]
                      ? "text-muted-foreground/55"
                      : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "block text-[9.5px] font-semibold uppercase leading-none tracking-[0.08em] text-primary",
                      !showMonth && "invisible",
                    )}
                  >
                    {MONTH_NAMES[parseInt(m, 10) - 1]}
                  </span>
                  {isMonthZoom ? dow.charAt(0) : dow}{" "}
                  <span
                    className={cn(
                      "font-semibold",
                      isToday &&
                        "rounded-full bg-primary px-2 py-px text-primary-foreground",
                    )}
                  >
                    {dayNum}
                  </span>
                </div>
              )
            })}
          </div>

          {data.rows.map((row) => (
            <PlannerRow
              key={row.user._id}
              row={row}
              days={days}
              dayPx={dayPx}
              gridTemplate={gridTemplate}
              weekendFlags={weekendFlags}
              todayFlags={todayFlags}
              weekStartFlags={weekStartFlags}
              labelMinSpan={labelMinSpan}
              highlightTaskId={dragActive ? null : highlight?.taskId ?? null}
              highlightAnchorId={highlight?.segmentId ?? null}
              selectedSegmentId={selected?.segmentId ?? null}
              canDrag={isAdmin}
              dragActive={dragActive}
              // ⌥-copy keeps the original visible (the ghost is the NEW
              // sitting); move and resize hide it and show the preview.
              excludeSegmentId={drag && !drag.copy ? drag.segmentId : null}
              preview={
                drag && drag.target.userId === row.user._id
                  ? {
                      seg: drag.seg,
                      startDate: drag.target.startDate,
                      endDate: drag.target.endDate,
                      kind: drag.mode === "move" ? "ghost" : "solid",
                      copy: drag.copy,
                      lane: drag.mode === "move" ? drag.target.lane : null,
                    }
                  : panelPreviewSeg && panelTarget?.userId === row.user._id
                    ? {
                        seg: panelPreviewSeg,
                        startDate: panelTarget.startDate,
                        endDate: panelTarget.endDate,
                        kind: "ghost",
                        copy: false,
                      }
                    : createPreviewSeg &&
                        createTarget?.userId === row.user._id
                      ? {
                          seg: createPreviewSeg,
                          startDate: createTarget.startDate,
                          endDate: createTarget.endDate,
                          kind: "ghost",
                          copy: false,
                        }
                      : null
              }
              quickCreate={
                pendingCreate &&
                !drawDrag &&
                pendingCreate.userId === row.user._id
                  ? { onConfirm: onConfirmCreate, onCancel: onCancelCreate }
                  : null
              }
              rowRefCallback={registerRowEl(row.user._id.toString())}
              onBarHover={dragActive ? IGNORE_HOVER : setHovered}
              onBarClick={(segmentId, taskId) => {
                if (consumeClickSuppression()) return
                // Click selects AND opens the drawer (slice 5); the selection
                // ring stays visible behind the overlay. Escape closes the
                // drawer first (it stops propagation), then clears selection.
                setSelected({ segmentId, taskId })
                onOpenTask(taskId)
              }}
              onBarPointerDown={onBarPointerDown}
              onResizePointerDown={onResizePointerDown}
              onCanvasPointerDown={
                isAdmin ? onCanvasPointerDown(row.user._id) : undefined
              }
            />
          ))}

          {/* Filler — extends the rail and day columns to the bottom edge */}
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: gridTemplate, minHeight: "48px" }}
          >
            <div className="sticky left-0 z-[5] border-r border-border bg-card" />
            <div className="relative" style={{ gridColumn: "2 / -1" }}>
              <PlannerDayStripes
                days={days}
                dayPx={dayPx}
                weekendFlags={weekendFlags}
                todayFlags={todayFlags}
                weekStartFlags={weekStartFlags}
              />
            </div>
          </div>
        </div>
      </div>

      {/* No-plan overlay — rows exist but nothing is scheduled in the window */}
      {!hasAnyPlan ? (
        <div className="pointer-events-none absolute inset-0 z-[8] flex items-center justify-center">
          <PlannerEmptyState
            title="Nothing planned yet"
            description={
              isAdmin
                ? "Schedule tasks onto your teammates' rows to build the team plan — everyone sees who works on what, on which day."
                : "The Planner shows who works on what, on which day. Scheduled tasks will appear here as bars."
            }
          />
        </div>
      ) : null}
    </div>
  )
}

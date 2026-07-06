"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import type { PlannerSegmentBar } from "@/convex/planner"
import type { StatusType } from "@/convex/lib/constants"
import {
  addDaysYmd,
  dayDiff,
  proposeDrawPlacement,
  proposeMovePlacement,
  proposeResizePlacement,
  spanDays,
} from "@/lib/planner"
import {
  PLANNER_LANE_PX,
  PLANNER_ROW_PAD_PX,
} from "@/components/planner/planner-bar"

/** Pointer must travel this far before a press becomes a drag (else: click). */
const DRAG_THRESHOLD_PX = 4

export type PlannerDragMode = "move" | "resize-start" | "resize-end"

export type PlannerDragTarget = {
  userId: Id<"users">
  startDate: string
  endDate: string
  /** Visual lane index under the pointer in the target row (move drags
   *  only) — drives manual restacking. null/absent = packing decides. */
  lane?: number | null
}

export type PlannerDragState = {
  mode: PlannerDragMode
  segmentId: Id<"planSegments">
  taskId: Id<"tasks">
  sourceUserId: Id<"users">
  seg: PlannerSegmentBar
  target: PlannerDragTarget
  /** ⌥ held during a move: drop creates a NEW segment, the original stays. */
  copy: boolean
}

type PendingPress = {
  pointerId: number
  startClientX: number
  startClientY: number
  mode: PlannerDragMode
  seg: PlannerSegmentBar
  sourceUserId: Id<"users">
  /** Days between the bar's start day and the grabbed day (date-invariant). */
  grabOffsetDays: number
  /** Lane under the pointer at press — a drop on the same dates/row/lane
   *  is a no-op (no restack write for a sloppy click-drag). */
  pressLane: number
  /** Live ⌥ state — tracked from pointer AND key events (toggling mid-drag
   *  without moving the pointer must still switch modes). */
  alt: boolean
}

/** Panel card data the engine needs to drag-to-schedule (slice 6). */
export type PlannerPanelTask = {
  taskId: Id<"tasks">
  title: string
  projectName: string | null
  clientName: string | null
  categoryColor: string | null
  statusType: StatusType
  /** Default span when dropped (from the remaining-estimate rule). */
  spanDays: number
}

export type PlannerPanelDragState = {
  task: PlannerPanelTask
  /** Snapped grid target; null while the card floats over the panel. */
  target: PlannerDragTarget | null
  /** Fly-back animation after an outside drop is in progress. */
  settling: boolean
}

type PendingPanelPress = {
  pointerId: number
  startClientX: number
  startClientY: number
  task: PlannerPanelTask
  /** Where the card was grabbed, relative to its top-left corner. */
  grabOffsetX: number
  grabOffsetY: number
  /** The card's on-screen origin — the fly animates back here on cancel. */
  originLeft: number
  originTop: number
}

type PendingDrawPress = {
  pointerId: number
  startClientX: number
  startClientY: number
  /** Draw-to-create never leaves the row it started on (mockup rule). */
  userId: Id<"users">
  /** The pressed day anchors one end; the pointer sketches the other. */
  anchorDate: string
}

/** Fly-back duration on an outside drop (mockup: 140ms settle). */
const SETTLE_MS = 150

/**
 * The Planner drag engine (move / reassign / resize / ⌥-split). Deep module:
 * the entire pointer state machine lives here — 4px click threshold, day
 * snapping via the pure placement reducers, row hit-testing against
 * registered row elements, Escape/pointercancel cancel, live Alt toggling,
 * commit callbacks on drop. Components only render the returned state.
 *
 * Geometry contract (continuous timeline): day columns are `dayPx` wide,
 * starting `railPx` into the scroll container's content. Targets are
 * expressed as DATES (not indexes) so window extension mid-drag can't
 * shift the proposal.
 */
export function usePlannerDrag({
  enabled,
  days,
  dayPx,
  railPx,
  scrollRef,
  onCommitMove,
  onCommitCopy,
  onCommitCreate,
  onDrawComplete,
}: {
  enabled: boolean
  days: string[]
  dayPx: number
  railPx: number
  scrollRef: React.RefObject<HTMLDivElement | null>
  onCommitMove: (
    segmentId: Id<"planSegments">,
    target: PlannerDragTarget,
  ) => void
  /** ⌥-split drop: create a new segment of `seg`'s task at the target. */
  onCommitCopy: (seg: PlannerSegmentBar, target: PlannerDragTarget) => void
  /** Panel drop: schedule a (new) sitting of the dragged panel task. */
  onCommitCreate: (task: PlannerPanelTask, target: PlannerDragTarget) => void
  /** Draw-to-create release: the drawn range awaits its title popover. */
  onDrawComplete: (target: PlannerDragTarget) => void
}) {
  const [drag, setDrag] = useState<PlannerDragState | null>(null)
  const [panelDrag, setPanelDrag] = useState<PlannerPanelDragState | null>(null)
  /** Live draw-to-create sketch (admin pressing across empty cells). */
  const [drawDrag, setDrawDrag] = useState<PlannerDragTarget | null>(null)

  // Latest values for window-level listeners (avoid stale closures).
  const dragRef = useRef(drag)
  dragRef.current = drag
  const daysRef = useRef(days)
  daysRef.current = days
  const dayPxRef = useRef(dayPx)
  dayPxRef.current = dayPx

  const pendingRef = useRef<PendingPress | null>(null)
  const suppressClickRef = useRef(false)
  const rowElsRef = useRef(new Map<string, HTMLElement>())
  const listenersRef = useRef<(() => void) | null>(null)

  const panelDragRef = useRef(panelDrag)
  panelDragRef.current = panelDrag
  const pendingPanelRef = useRef<PendingPanelPress | null>(null)
  const drawDragRef = useRef(drawDrag)
  drawDragRef.current = drawDrag
  const pendingDrawRef = useRef<PendingDrawPress | null>(null)
  /** The floating card element — positioned imperatively so pointer moves
   *  don't re-render the whole board. */
  const flyElRef = useRef<HTMLElement | null>(null)
  const lastPanelPointerRef = useRef({ x: 0, y: 0 })
  const settleTimerRef = useRef<number | null>(null)

  /** Row components register their root element for vertical hit-testing. */
  const registerRowEl = useCallback(
    (userId: string) => (el: HTMLElement | null) => {
      if (el) rowElsRef.current.set(userId, el)
      else rowElsRef.current.delete(userId)
    },
    [],
  )

  const pointerDayIdx = useCallback(
    (clientX: number): number => {
      const el = scrollRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left + el.scrollLeft - railPx
      return Math.max(
        0,
        Math.min(
          daysRef.current.length - 1,
          Math.floor(x / dayPxRef.current),
        ),
      )
    },
    [scrollRef, railPx],
  )

  const rowUserIdFromY = useCallback(
    (clientY: number): Id<"users"> | null => {
      let best: { userId: string; dist: number } | null = null
      for (const [userId, el] of rowElsRef.current) {
        const rect = el.getBoundingClientRect()
        if (clientY >= rect.top && clientY <= rect.bottom) {
          return userId as Id<"users">
        }
        const dist =
          clientY < rect.top ? rect.top - clientY : clientY - rect.bottom
        if (!best || dist < best.dist) best = { userId, dist }
      }
      // Above the first / below the last row: snap to the nearest one.
      return best ? (best.userId as Id<"users">) : null
    },
    [],
  )

  /** Visual lane index under the pointer within a row — the vertical half
   *  of a move drag: same row + different lane = manual restack. */
  const laneFromY = useCallback(
    (userId: Id<"users">, clientY: number): number => {
      const el = rowElsRef.current.get(userId.toString())
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      return Math.max(
        0,
        Math.floor((clientY - rect.top - PLANNER_ROW_PAD_PX) / PLANNER_LANE_PX),
      )
    },
    [],
  )

  const teardown = useCallback(() => {
    listenersRef.current?.()
    listenersRef.current = null
    pendingRef.current = null
    setDrag(null)
  }, [])

  const startPress = useCallback(
    (
      mode: PlannerDragMode,
      seg: PlannerSegmentBar,
      sourceUserId: Id<"users">,
      e: React.PointerEvent,
    ) => {
      if (!enabled || e.button !== 0) return
      // A bar press must never bubble to the row canvas underneath — the
      // canvas pointer-down starts draw-to-create on empty cells only.
      e.stopPropagation()
      // A fresh press starts a fresh click cycle. Without this reset a drag
      // whose drop produced no click event (the dragged bar unmounts under
      // the pointer, so the browser has nothing to dispatch `click` on)
      // would leave the suppression flag armed and silently swallow the
      // NEXT legitimate click.
      suppressClickRef.current = false
      // Defensive: if the previous press never saw its pointerup (window
      // lost focus mid-drag), drop its listeners before adding new ones.
      listenersRef.current?.()
      listenersRef.current = null
      // Date-based grab offset: invariant under window extension.
      const grabDay = daysRef.current[pointerDayIdx(e.clientX)]
      pendingRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        mode,
        seg,
        sourceUserId,
        grabOffsetDays: dayDiff(seg.startDate, grabDay),
        pressLane: laneFromY(sourceUserId, e.clientY),
        alt: e.altKey,
      }

      // Both edges snapped as day indexes relative to the CURRENT window
      // start; may fall outside [0, dayCount) for clipped segments — the
      // reducers handle that, and dates come back via addDaysYmd.
      const windowStart = () => daysRef.current[0]

      const proposeTarget = (
        clientX: number,
        clientY: number,
      ): PlannerDragTarget => {
        const pending = pendingRef.current!
        const dayList = daysRef.current
        const pIdx = pointerDayIdx(clientX)
        if (pending.mode === "move") {
          const span = spanDays(pending.seg)
          const { startIdx } = proposeMovePlacement({
            pointerDayIdx: pIdx,
            grabOffsetDays: pending.grabOffsetDays,
            spanDays: span,
            dayCount: dayList.length,
          })
          const startDate = dayList[startIdx]
          const userId =
            rowUserIdFromY(clientY) ??
            dragRef.current?.target.userId ??
            pending.sourceUserId
          return {
            userId,
            startDate,
            endDate: addDaysYmd(startDate, span - 1),
            lane: laneFromY(userId, clientY),
          }
        }
        // Resize: the opposite edge stays anchored, the row never changes.
        const anchorDate =
          pending.mode === "resize-start"
            ? pending.seg.endDate
            : pending.seg.startDate
        const { startIdx, endIdx } = proposeResizePlacement({
          pointerDayIdx: pIdx,
          anchorIdx: dayDiff(windowStart(), anchorDate),
          edge: pending.mode === "resize-start" ? "start" : "end",
        })
        return {
          userId: pending.sourceUserId,
          startDate: addDaysYmd(windowStart(), startIdx),
          endDate: addDaysYmd(windowStart(), endIdx),
        }
      }

      const applyProposal = (target: PlannerDragTarget) => {
        const pending = pendingRef.current
        if (!pending) return
        const copy = pending.mode === "move" && pending.alt
        setDrag((prev) => {
          if (
            prev &&
            prev.copy === copy &&
            prev.target.userId === target.userId &&
            prev.target.startDate === target.startDate &&
            prev.target.endDate === target.endDate &&
            prev.target.lane === target.lane
          ) {
            return prev
          }
          return {
            mode: pending.mode,
            segmentId: pending.seg._id,
            taskId: pending.seg.taskId,
            sourceUserId: pending.sourceUserId,
            seg: pending.seg,
            target,
            copy,
          }
        })
      }

      const lastPointer = { x: e.clientX, y: e.clientY }

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pendingRef.current?.pointerId && !dragRef.current) return
        const pending = pendingRef.current
        if (!pending) return
        lastPointer.x = ev.clientX
        lastPointer.y = ev.clientY
        pending.alt = ev.altKey

        if (!dragRef.current) {
          const dx = ev.clientX - pending.startClientX
          const dy = ev.clientY - pending.startClientY
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          suppressClickRef.current = true
        }

        ev.preventDefault()
        applyProposal(proposeTarget(ev.clientX, ev.clientY))
      }

      const onUp = (ev: PointerEvent) => {
        const active = dragRef.current
        const pending = pendingRef.current
        if (active && pending) {
          // A vertical-only drop (same row/dates, different lane) is a
          // manual restack — still a real change to commit.
          const unchanged =
            active.target.userId === pending.sourceUserId &&
            active.target.startDate === pending.seg.startDate &&
            active.target.endDate === pending.seg.endDate &&
            (active.target.lane ?? pending.pressLane) === pending.pressLane
          if (active.copy) {
            onCommitCopy(pending.seg, active.target)
          } else if (!unchanged) {
            onCommitMove(active.segmentId, active.target)
          }
          // Only a real drag hijacks the default click behaviour — a plain
          // press-and-release must stay an untouched native click.
          ev.preventDefault()
        }
        teardown()
      }

      const onCancel = () => teardown()

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && dragRef.current) {
          ev.stopPropagation()
          teardown()
          return
        }
        // ⌥ pressed mid-drag without pointer movement: switch to copy live.
        if (ev.key === "Alt" && pendingRef.current && dragRef.current) {
          pendingRef.current.alt = true
          applyProposal(proposeTarget(lastPointer.x, lastPointer.y))
        }
      }

      const onKeyUp = (ev: KeyboardEvent) => {
        if (ev.key === "Alt" && pendingRef.current && dragRef.current) {
          pendingRef.current.alt = false
          applyProposal(proposeTarget(lastPointer.x, lastPointer.y))
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
      // Alt-tab / focus loss mid-drag: the pointerup may never arrive —
      // cancel cleanly instead of leaving a ghost drag behind.
      window.addEventListener("blur", onCancel)
      window.addEventListener("keydown", onKeyDown, true)
      window.addEventListener("keyup", onKeyUp, true)
      listenersRef.current = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("blur", onCancel)
        window.removeEventListener("keydown", onKeyDown, true)
        window.removeEventListener("keyup", onKeyUp, true)
      }
    },
    [enabled, pointerDayIdx, rowUserIdFromY, laneFromY, onCommitMove, onCommitCopy, teardown],
  )

  const onBarPointerDown = useCallback(
    (seg: PlannerSegmentBar, sourceUserId: Id<"users">) =>
      (e: React.PointerEvent) =>
        startPress("move", seg, sourceUserId, e),
    [startPress],
  )

  /** Edge handles call this with which edge was grabbed. */
  const onResizePointerDown = useCallback(
    (seg: PlannerSegmentBar, sourceUserId: Id<"users">) =>
      (edge: "start" | "end", e: React.PointerEvent) =>
        startPress(edge === "start" ? "resize-start" : "resize-end", seg, sourceUserId, e),
    [startPress],
  )

  // ── Panel drag-to-schedule (slice 6) ─────────────────────────────────────

  const positionFly = useCallback((x: number, y: number) => {
    const pending = pendingPanelRef.current
    const el = flyElRef.current
    if (!pending || !el) return
    el.style.transform = `translate3d(${x - pending.grabOffsetX}px, ${
      y - pending.grabOffsetY
    }px, 0)`
  }, [])

  /** The fly card mounts only during a panel drag; position it immediately
   *  so it never flashes at the viewport origin. */
  const registerFlyEl = useCallback(
    (el: HTMLElement | null) => {
      flyElRef.current = el
      if (el) {
        const p = lastPanelPointerRef.current
        positionFly(p.x, p.y)
      }
    },
    [positionFly],
  )

  /** True when the pointer is over the day canvas (rail and panel excluded). */
  const overGrid = useCallback(
    (x: number, y: number): boolean => {
      const el = scrollRef.current
      if (!el) return false
      const r = el.getBoundingClientRect()
      return x >= r.left + railPx && x <= r.right && y >= r.top && y <= r.bottom
    },
    [scrollRef, railPx],
  )

  const teardownPanel = useCallback(() => {
    listenersRef.current?.()
    listenersRef.current = null
    pendingPanelRef.current = null
    setPanelDrag(null)
  }, [])

  const onCardPointerDown = useCallback(
    (task: PlannerPanelTask) => (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return
      // Same click-cycle rules as bar presses (see startPress).
      suppressClickRef.current = false
      listenersRef.current?.()
      listenersRef.current = null
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
        setPanelDrag(null)
      }

      const originRect = e.currentTarget.getBoundingClientRect()
      pendingPanelRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        task,
        grabOffsetX: e.clientX - originRect.left,
        grabOffsetY: e.clientY - originRect.top,
        originLeft: originRect.left,
        originTop: originRect.top,
      }
      lastPanelPointerRef.current = { x: e.clientX, y: e.clientY }

      const proposePanelTarget = (
        clientX: number,
        clientY: number,
      ): PlannerDragTarget | null => {
        if (!overGrid(clientX, clientY)) return null
        const userId = rowUserIdFromY(clientY)
        if (!userId) return null
        const pending = pendingPanelRef.current!
        const dayList = daysRef.current
        // The card has no grab-day: the pointer day is the start day
        // (mockup), clamped so the whole span stays inside the window.
        const { startIdx } = proposeMovePlacement({
          pointerDayIdx: pointerDayIdx(clientX),
          grabOffsetDays: 0,
          spanDays: pending.task.spanDays,
          dayCount: dayList.length,
        })
        const startDate = dayList[startIdx]
        return {
          userId,
          startDate,
          endDate: addDaysYmd(startDate, pending.task.spanDays - 1),
        }
      }

      const applyPanelProposal = (target: PlannerDragTarget | null) => {
        const pending = pendingPanelRef.current
        if (!pending) return
        // Over the grid the snapped ghost represents the drop — hide the fly.
        const el = flyElRef.current
        if (el) el.style.opacity = target ? "0" : "1"
        setPanelDrag((prev) => {
          if (
            prev &&
            !prev.settling &&
            prev.target?.userId === target?.userId &&
            prev.target?.startDate === target?.startDate &&
            prev.target?.endDate === target?.endDate
          ) {
            return prev
          }
          return { task: pending.task, target, settling: false }
        })
      }

      const onMove = (ev: PointerEvent) => {
        const pending = pendingPanelRef.current
        if (!pending) return
        if (ev.pointerId !== pending.pointerId && !panelDragRef.current) return
        lastPanelPointerRef.current = { x: ev.clientX, y: ev.clientY }

        if (!panelDragRef.current) {
          const dx = ev.clientX - pending.startClientX
          const dy = ev.clientY - pending.startClientY
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          suppressClickRef.current = true
        }

        ev.preventDefault()
        positionFly(ev.clientX, ev.clientY)
        applyPanelProposal(proposePanelTarget(ev.clientX, ev.clientY))
      }

      const settleBack = () => {
        const pending = pendingPanelRef.current
        const el = flyElRef.current
        // Stop tracking the pointer immediately; keep the fly mounted for
        // the return animation, then drop the whole drag state.
        listenersRef.current?.()
        listenersRef.current = null
        setPanelDrag((prev) => (prev ? { ...prev, settling: true } : prev))
        if (pending && el) {
          el.style.transition =
            "transform 140ms cubic-bezier(.2,.8,.3,1), opacity 140ms ease"
          el.style.transform = `translate3d(${pending.originLeft}px, ${pending.originTop}px, 0)`
          el.style.opacity = "0.35"
        }
        pendingPanelRef.current = null
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null
          setPanelDrag(null)
        }, SETTLE_MS)
      }

      const onUp = (ev: PointerEvent) => {
        const active = panelDragRef.current
        const pending = pendingPanelRef.current
        if (active && pending) {
          ev.preventDefault()
          if (active.target) {
            onCommitCreate(pending.task, active.target)
            teardownPanel()
          } else {
            settleBack()
          }
          return
        }
        teardownPanel()
      }

      const onCancel = () => {
        if (panelDragRef.current && !panelDragRef.current.target) settleBack()
        else teardownPanel()
      }

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && panelDragRef.current) {
          ev.stopPropagation()
          onCancel()
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
      window.addEventListener("blur", onCancel)
      window.addEventListener("keydown", onKeyDown, true)
      listenersRef.current = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("blur", onCancel)
        window.removeEventListener("keydown", onKeyDown, true)
      }
    },
    [
      enabled,
      overGrid,
      pointerDayIdx,
      rowUserIdFromY,
      positionFly,
      onCommitCreate,
      teardownPanel,
    ],
  )

  // ── Draw-to-create (slice 8) ─────────────────────────────────────────────

  const teardownDraw = useCallback(() => {
    listenersRef.current?.()
    listenersRef.current = null
    pendingDrawRef.current = null
    setDrawDrag(null)
  }, [])

  /** Rows attach this to their day canvas; bar presses stop propagation, so
   *  only presses on empty cells arrive here. The sketch never leaves the
   *  row it started on (mockup rule) — vertical movement is ignored. */
  const onCanvasPointerDown = useCallback(
    (userId: Id<"users">) => (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return
      // Same click-cycle rules as bar presses (see startPress).
      suppressClickRef.current = false
      listenersRef.current?.()
      listenersRef.current = null

      pendingDrawRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        userId,
        anchorDate: daysRef.current[pointerDayIdx(e.clientX)],
      }

      const proposeDrawTarget = (clientX: number): PlannerDragTarget => {
        const pending = pendingDrawRef.current!
        const dayList = daysRef.current
        // Anchor as a DATE keeps the sketch stable when the loaded window
        // extends mid-drag (same invariant as move targets).
        const { startIdx, endIdx } = proposeDrawPlacement({
          anchorIdx: dayDiff(dayList[0], pending.anchorDate),
          pointerDayIdx: pointerDayIdx(clientX),
        })
        return {
          userId: pending.userId,
          startDate: dayList[startIdx],
          endDate: dayList[endIdx],
        }
      }

      const applyDraw = (target: PlannerDragTarget) => {
        setDrawDrag((prev) =>
          prev &&
          prev.userId === target.userId &&
          prev.startDate === target.startDate &&
          prev.endDate === target.endDate
            ? prev
            : target,
        )
      }

      const onMove = (ev: PointerEvent) => {
        const pending = pendingDrawRef.current
        if (!pending) return
        if (ev.pointerId !== pending.pointerId && !drawDragRef.current) return

        if (!drawDragRef.current) {
          const dx = ev.clientX - pending.startClientX
          const dy = ev.clientY - pending.startClientY
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
          suppressClickRef.current = true
        }

        ev.preventDefault()
        applyDraw(proposeDrawTarget(ev.clientX))
      }

      const onUp = (ev: PointerEvent) => {
        const active = drawDragRef.current
        if (active) {
          ev.preventDefault()
          // The ghost's fate is the caller's: it re-renders the drawn bar as
          // the pending-create preview and anchors the title popover to it.
          onDrawComplete(active)
        }
        teardownDraw()
      }

      const onCancel = () => teardownDraw()

      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === "Escape" && drawDragRef.current) {
          ev.stopPropagation()
          teardownDraw()
        }
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      window.addEventListener("pointercancel", onCancel)
      window.addEventListener("blur", onCancel)
      window.addEventListener("keydown", onKeyDown, true)
      listenersRef.current = () => {
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onCancel)
        window.removeEventListener("blur", onCancel)
        window.removeEventListener("keydown", onKeyDown, true)
      }
    },
    [enabled, pointerDayIdx, onDrawComplete, teardownDraw],
  )

  /** Bars call this from onClick: true = the click ended a drag, ignore it. */
  const consumeClickSuppression = useCallback((): boolean => {
    const suppressed = suppressClickRef.current
    suppressClickRef.current = false
    return suppressed
  }, [])

  // Global drag affordances: mode-appropriate cursor + no text selection.
  useEffect(() => {
    const panelActive = panelDrag !== null && !panelDrag.settling
    if (!drag && !panelActive && !drawDrag) return
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    // Draw keeps the plain arrow (owner ruling: no crosshair — Notion-like
    // affordances); locking it on <body> stops bar grab-cursor flicker
    // while the sketch sweeps under other bars.
    document.body.style.cursor = drag
      ? drag.mode === "move"
        ? drag.copy
          ? "copy"
          : "grabbing"
        : "ew-resize"
      : drawDrag
        ? "default"
        : "grabbing"
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
    }
  }, [drag, panelDrag, drawDrag])

  // Unmount safety: never leave window listeners or timers behind.
  useEffect(
    () => () => {
      listenersRef.current?.()
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current)
      }
    },
    [],
  )

  return {
    drag,
    panelDrag,
    drawDrag,
    onBarPointerDown,
    onResizePointerDown,
    onCardPointerDown,
    onCanvasPointerDown,
    registerRowEl,
    registerFlyEl,
    consumeClickSuppression,
  }
}

export type PlannerDragEngine = ReturnType<typeof usePlannerDrag>

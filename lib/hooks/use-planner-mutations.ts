"use client"

import { useCallback, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { PlannerGridData, PlannerSegmentBar } from "@/convex/planner"
import type { PlannerQueryArgs } from "@/lib/hooks/use-planner-query-args"
import type {
  PlannerDragTarget,
  PlannerPanelTask,
} from "@/lib/hooks/use-planner-drag"
import { proposeLaneOrder } from "@/lib/planner"
import { toastError } from "@/lib/toast-helpers"

/**
 * The Planner's plan mutations, wrapped per app convention: optimistic
 * apply against the weekGrid cache, automatic rollback + error toast on
 * rejection. Extracted from the page so it stays a thin orchestrator.
 *
 * `context` (the displayed grid + loaded day window) feeds the manual
 * restack math: a move drop's pointer lane resolves to a numeric
 * `laneOrder` against the target row's bars. Read through a ref so the
 * commit callbacks stay referentially stable for the drag engine.
 */
export function usePlannerMutations(
  queryArgs: PlannerQueryArgs,
  context: { grid: PlannerGridData | undefined; days: string[] },
) {
  const contextRef = useRef(context)
  contextRef.current = context
  const updateSegment = useMutation(
    api.planner.updateSegment,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.planner.weekGrid, queryArgs)
    if (!current) return
    let moved: PlannerSegmentBar | undefined
    let sourceUserId: Id<"users"> | undefined
    for (const row of current.rows) {
      const hit = row.segments.find((s) => s._id === args.id)
      if (hit) {
        moved = hit
        sourceUserId = row.user._id
        break
      }
    }
    if (!moved || !sourceUserId) return
    const targetUserId = args.userId ?? sourceUserId
    const updated = {
      ...moved,
      startDate: args.startDate ?? moved.startDate,
      endDate: args.endDate ?? moved.endDate,
      laneOrder: args.laneOrder ?? moved.laneOrder,
    }
    const rows = current.rows.map((row) => {
      const without = row.segments.filter((s) => s._id !== args.id)
      if (row.user._id !== targetUserId) {
        return without.length === row.segments.length
          ? row
          : { ...row, segments: without }
      }
      const segments = [...without, updated].sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.endDate.localeCompare(b.endDate),
      )
      return { ...row, segments }
    })
    localStore.setQuery(api.planner.weekGrid, queryArgs, { rows })
  })

  // Display fields for the optimistic segment of a PANEL drop: an
  // unscheduled task has no cached sitting to clone from, so the drop
  // handler stashes the card's data here right before mutating.
  const pendingPanelTaskRef = useRef<PlannerPanelTask | null>(null)

  const createSegment = useMutation(
    api.planner.createSegment,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.planner.weekGrid, queryArgs)
    if (!current) return
    // Clone display fields from any cached sitting of the task (⌥-split and
    // add-another-sitting drops); fall back to the stashed panel card.
    let template: PlannerSegmentBar | undefined
    for (const row of current.rows) {
      const hit = row.segments.find((s) => s.taskId === args.taskId)
      if (hit) {
        template = hit
        break
      }
    }
    const panelTask =
      pendingPanelTaskRef.current?.taskId === args.taskId
        ? pendingPanelTaskRef.current
        : null
    if (!template && !panelTask) return

    const newCount = (template?.partCount ?? 0) + 1
    const optimistic: PlannerSegmentBar = {
      // Temporary id — replaced by the server row when the mutation lands.
      _id: crypto.randomUUID() as Id<"planSegments">,
      taskId: args.taskId,
      startDate: args.startDate,
      endDate: args.endDate,
      taskTitle: template?.taskTitle ?? panelTask!.title,
      projectName: template?.projectName ?? panelTask!.projectName,
      categoryColor: template?.categoryColor ?? panelTask!.categoryColor,
      statusType: template?.statusType ?? panelTask!.statusType,
      // Provisional rank (server re-ranks all sittings by start date).
      partIndex: newCount,
      partCount: newCount,
      // Real creation time: the optimistic bar packs below existing bars
      // and keeps that lane when the server row replaces it.
      laneOrder: Date.now(),
    }
    const rows = current.rows.map((row) => {
      const segments = row.segments.map((s) =>
        s.taskId === args.taskId ? { ...s, partCount: newCount } : s,
      )
      if (row.user._id !== args.userId) {
        return { ...row, segments }
      }
      const withNew = [...segments, optimistic].sort(
        (a, b) =>
          a.startDate.localeCompare(b.startDate) ||
          a.endDate.localeCompare(b.endDate),
      )
      return { ...row, segments: withNew }
    })
    localStore.setQuery(api.planner.weekGrid, queryArgs, { rows })
  })

  const removeSegment = useMutation(
    api.planner.removeSegment,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.planner.weekGrid, queryArgs)
    if (!current) return
    localStore.setQuery(api.planner.weekGrid, queryArgs, {
      rows: current.rows.map((row) =>
        row.segments.some((s) => s._id === args.id)
          ? { ...row, segments: row.segments.filter((s) => s._id !== args.id) }
          : row,
      ),
    })
  })

  const handleMoveSegment = useCallback(
    (segmentId: Id<"planSegments">, target: PlannerDragTarget) => {
      // Resolve the drop's pointer lane to a manual stacking order against
      // the target row's bars. null = the current order already fits (or
      // nothing collides) — no restack write needed.
      const { grid, days } = contextRef.current
      let current: PlannerSegmentBar | undefined
      let sourceUserId: Id<"users"> | undefined
      for (const row of grid?.rows ?? []) {
        const hit = row.segments.find((s) => s._id === segmentId)
        if (hit) {
          current = hit
          sourceUserId = row.user._id
          break
        }
      }
      const targetRow = grid?.rows.find((r) => r.user._id === target.userId)
      const laneOrder =
        target.lane != null && targetRow && days.length > 0
          ? proposeLaneOrder({
              segments: targetRow.segments,
              excludeId: segmentId,
              target: { startDate: target.startDate, endDate: target.endDate },
              pointerLane: target.lane,
              rangeStart: days[0],
              rangeEnd: days[days.length - 1],
              currentOrder: current?.laneOrder,
            })
          : null

      // A drop that changed neither row, dates, nor effective stacking is
      // a no-op — don't touch the database.
      const datesUnchanged =
        current !== undefined &&
        sourceUserId === target.userId &&
        current.startDate === target.startDate &&
        current.endDate === target.endDate
      if (datesUnchanged && laneOrder === null) return

      void updateSegment({
        id: segmentId,
        userId: target.userId,
        startDate: target.startDate,
        endDate: target.endDate,
        ...(laneOrder !== null ? { laneOrder } : {}),
      }).catch((err) => toastError(err, "Couldn't move the plan segment"))
    },
    [updateSegment],
  )

  const handleRemoveSegment = useCallback(
    (segmentId: Id<"planSegments">) => {
      void removeSegment({ id: segmentId }).catch((err) =>
        toastError(err, "Couldn't unschedule the segment"),
      )
    },
    [removeSegment],
  )

  const handleSplitSegment = useCallback(
    (seg: PlannerSegmentBar, target: PlannerDragTarget) => {
      void createSegment({
        taskId: seg.taskId,
        userId: target.userId,
        startDate: target.startDate,
        endDate: target.endDate,
      }).catch((err) => toastError(err, "Couldn't schedule the new sitting"))
    },
    [createSegment],
  )

  const handleCreateFromPanel = useCallback(
    (task: PlannerPanelTask, target: PlannerDragTarget) => {
      pendingPanelTaskRef.current = task
      void createSegment({
        taskId: task.taskId,
        userId: target.userId,
        startDate: target.startDate,
        endDate: target.endDate,
      }).catch((err) => toastError(err, "Couldn't schedule the task"))
    },
    [createSegment],
  )

  // Draw-to-create commits pessimistically — no optimistic update. The
  // drawn ghost + title popover stay on screen until the server confirms
  // (an optimistic bar would double-render next to the pending ghost), and
  // Convex applies the mutation's query updates before resolving the
  // promise, so dismissing the ghost on success can't flash a gap. The
  // rejection propagates so the popover keeps the typed title (PRD 35).
  const createTaskWithSegment = useMutation(api.planner.createTaskWithSegment)
  const handleCreateTaskWithSegment = useCallback(
    async (args: {
      title: string
      projectId?: Id<"projects">
      userId: Id<"users">
      startDate: string
      endDate: string
    }) => {
      try {
        await createTaskWithSegment(args)
      } catch (err) {
        toastError(err, "Couldn't create the task")
        throw err
      }
    },
    [createTaskWithSegment],
  )

  return {
    handleMoveSegment,
    handleRemoveSegment,
    handleSplitSegment,
    handleCreateFromPanel,
    handleCreateTaskWithSegment,
  }
}

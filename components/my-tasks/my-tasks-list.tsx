"use client"

import { useMemo, useCallback, useState, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { toastError } from "@/lib/toast-helpers"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { PointerSensor, PointerActivationConstraints } from "@dnd-kit/dom"

const DRAG_SENSORS = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 5 }),
    ],
  }),
]
import { SunIcon } from "lucide-react"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { MyTasksSortableRow } from "./my-tasks-sortable-row"
import { MyTasksGroup } from "./my-tasks-group"
import { MyTaskRow } from "./my-task-row"
import { MyTasksInlineAdd } from "./my-tasks-inline-add"
import { MyTasksEmptyState, TodayAllDoneState, TodayEmptyState } from "./my-tasks-empty-state"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { MyTasksGroup as MyTasksGroupType } from "@/convex/lib/myTaskHelpers"
import { findNeighborKeys } from "@/lib/reorder"
import { getStatusColor } from "@/lib/status-colors"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { Id } from "@/convex/_generated/dataModel"

export function MyTasksList({
  groups,
  timeMap,
  activityMap,
  detailId,
  currentUserId,
  onOpenDetail,
  onComplete,
  defaultStatusId,
}: {
  groups: MyTasksGroupType<TaskWithJoins>[]
  timeMap?: Record<string, number>
  activityMap?: Record<string, ActivityIndicator>
  detailId: string | null
  currentUserId: Id<"users">
  onOpenDetail: (taskId: string) => void
  onComplete: (taskId: string, statusId: Id<"statuses">, coords?: { x: number; y: number }) => void
  defaultStatusId?: Id<"statuses">
}) {
  const { statuses } = useTaskReferenceData()
  const reorderTask = useMutation(api.tasks.reorderTask)
  const hasAnyTasks = groups.some((g) => g.tasks.length > 0)

  // Status color lookup for group headers (resolve semantic names to hex)
  const statusColorMap = useMemo(() => {
    if (!statuses) return new Map<string, string>()
    return new Map(statuses.map((s) => [s._id as string, getStatusColor(s.color).dot]))
  }, [statuses])

  // Optimistic reorder: per-group order held until server catches up
  const [optimisticOrders, setOptimisticOrders] = useState<Record<string, string[]>>({})
  const pendingGroupRef = useRef<string | null>(null)

  // Apply optimistic order to groups, auto-clearing when server catches up
  const displayGroups = useMemo(() => {
    return groups.map((group) => {
      const optimistic = optimisticOrders[group.key]
      if (!optimistic) return group

      // Check if server already matches — skip optimistic overlay
      const serverIds = group.tasks.map((t) => t._id as string)
      if (serverIds.join(",") === optimistic.join(",")) return group

      const taskMap = new Map(group.tasks.map((t) => [t._id as string, t]))
      const reordered = optimistic
        .map((id) => taskMap.get(id))
        .filter(Boolean) as TaskWithJoins[]
      const seen = new Set(optimistic)
      const extras = group.tasks.filter((t) => !seen.has(t._id as string))

      return { ...group, tasks: [...reordered, ...extras] }
    })
  }, [groups, optimisticOrders])

  // Lazily clear stale optimistic state after render when server has caught up
  const prevGroupsRef = useRef(groups)
  if (prevGroupsRef.current !== groups && pendingGroupRef.current) {
    const groupKey = pendingGroupRef.current
    const optimistic = optimisticOrders[groupKey]
    const serverGroup = groups.find((g) => g.key === groupKey)
    if (optimistic && serverGroup) {
      const serverIds = serverGroup.tasks.map((t) => t._id as string)
      if (serverIds.join(",") === optimistic.join(",")) {
        // Schedule cleanup for next tick (can't setState during render)
        queueMicrotask(() => {
          setOptimisticOrders((prev) => {
            const next = { ...prev }
            delete next[groupKey]
            return next
          })
          pendingGroupRef.current = null
        })
      }
    }
    prevGroupsRef.current = groups
  }

  // Map group key → statusId for inline creation
  const groupStatusMap = useMemo(() => {
    if (!statuses) return {}
    const map: Record<string, Id<"statuses">> = {}
    for (const group of groups) {
      if (group.statusId) {
        map[group.key] = group.statusId as Id<"statuses">
      } else {
        const first = statuses.find((s) => s.type === group.statusType)
        if (first) map[group.key] = first._id
      }
    }
    return map
  }, [groups, statuses])

  const handleReorder = useCallback(
    (groupKey: string, taskId: string, fromIndex: number, toIndex: number) => {
      const group = displayGroups.find((g) => g.key === groupKey)
      if (!group) return

      const tasks = group.tasks
      const reordered = [...tasks]
      const [moved] = reordered.splice(fromIndex, 1)
      reordered.splice(toIndex, 0, moved)

      setOptimisticOrders((prev) => ({
        ...prev,
        [groupKey]: reordered.map((t) => t._id as string),
      }))
      pendingGroupRef.current = groupKey

      const { beforeKey, afterKey } = findNeighborKeys(reordered, toIndex)

      reorderTask({
        taskId: taskId as Id<"tasks">,
        beforeKey,
        afterKey,
      }).catch((err: unknown) => toastError(err, "Failed to reorder task"))
    },
    [displayGroups, reorderTask],
  )

  if (!hasAnyTasks) {
    return <MyTasksEmptyState />
  }

  return (
    <>
      {displayGroups.map((group) => {
        const isCompleted = group.key === "completed_today"
        const isToday = group.key === "today"
        const completedGroup = groups.find((g) => g.key === "completed_today")

        // Derived Today group: sun header + hint, rows with status badge and
        // assignment-mismatch indicator, no inline add / reorder yet (slices
        // 02–03 add the gestures). Arrival order comes from the server.
        if (isToday) {
          const completedCount = completedGroup?.count ?? 0
          return (
            <MyTasksGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              count={group.count}
              statusType="in_progress"
              statusColor="gray"
              icon={<SunIcon className="size-4 text-amber-500" />}
              hint="the Planner's plan for today"
            >
              {group.tasks.length === 0 &&
                (completedCount > 0 ? (
                  <TodayAllDoneState completedCount={completedCount} />
                ) : (
                  <TodayEmptyState />
                ))}
              {group.tasks.map((task) => (
                // Mirrors MyTasksSortableRow geometry (size-6 handle slot)
                // without drag — within-Today reorder arrives in slice 03.
                <li key={task._id} className="flex w-full list-none items-start rounded-lg transition-colors hover:bg-muted/70">
                  <span className="size-6 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <MyTaskRow
                      task={task}
                      totalMinutes={timeMap?.[task._id]}
                      activity={activityMap?.[task._id]}
                      isTodayRow
                      currentUserId={currentUserId}
                      onOpenDetail={onOpenDetail}
                      onComplete={onComplete}
                      defaultStatusId={defaultStatusId}
                      isDetailOpen={detailId === task._id}
                    />
                  </div>
                </li>
              ))}
            </MyTasksGroup>
          )
        }

        return (
          <MyTasksGroup
            key={group.key}
            groupKey={group.key}
            label={group.label}
            count={group.count}
            statusType={(group.statusType as import("@/convex/lib/constants").StatusType) ?? "backlog"}
            statusColor={
              group.statusId
                ? (statusColorMap.get(group.statusId as string) ?? "gray")
                : group.key === "completed_today" ? "teal" : "gray"
            }
            inTodayCount={group.inTodayCount}
            defaultOpen={!isCompleted || group.count <= 10}
          >
            <DragDropProvider
              sensors={DRAG_SENSORS}
              onDragEnd={(event) => {
                if (event.canceled) return
                const { source } = event.operation
                if (!isSortable(source)) return
                const { initialIndex, index } = source
                if (initialIndex === index) return
                handleReorder(group.key, String(source.id), initialIndex, index)
              }}
            >
              {group.tasks.map((task, idx) => (
                <MyTasksSortableRow
                  key={task._id}
                  id={task._id}
                  index={idx}
                >
                  <MyTaskRow
                    task={task}
                    totalMinutes={timeMap?.[task._id]}
                    activity={activityMap?.[task._id]}
                    isCompletedToday={isCompleted}
                    onOpenDetail={onOpenDetail}
                    onComplete={onComplete}
                    defaultStatusId={defaultStatusId}
                    isDetailOpen={detailId === task._id}
                  />
                </MyTasksSortableRow>
              ))}
            </DragDropProvider>
            {/* Inline add per group (not for completed) */}
            {!isCompleted && (
              <MyTasksInlineAdd
                statusId={groupStatusMap[group.key]}
                currentUserId={currentUserId}
              />
            )}
          </MyTasksGroup>
        )
      })}

    </>
  )
}

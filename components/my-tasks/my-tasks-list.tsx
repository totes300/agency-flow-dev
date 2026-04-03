"use client"

import { useMemo, useCallback, useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { DragDropProvider } from "@dnd-kit/react"
import { isSortable } from "@dnd-kit/react/sortable"
import { PointerSensor, PointerActivationConstraints } from "@dnd-kit/dom"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { MyTasksSortableRow } from "./my-tasks-sortable-row"
import { MyTasksGroup, HiddenTasksFooter } from "./my-tasks-group"
import { MyTaskRow } from "./my-task-row"
import { MyTasksInlineAdd } from "./my-tasks-inline-add"
import { MyTasksEmptyState, TodayAllDoneState } from "./my-tasks-empty-state"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { MyTasksGroup as MyTasksGroupType } from "@/convex/lib/myTaskHelpers"
import { findNeighborKeys } from "@/lib/reorder"
import type { ActivityIndicator } from "@/components/tasks/task-row"
import type { Id } from "@/convex/_generated/dataModel"

export function MyTasksList({
  groups,
  hiddenCount,
  timeMap,
  activityMap,
  detailId,
  currentUserId,
  onOpenDetail,
  onComplete,
}: {
  groups: MyTasksGroupType<TaskWithJoins>[]
  hiddenCount: number
  timeMap?: Record<string, number>
  activityMap?: Record<string, ActivityIndicator>
  detailId: string | null
  currentUserId: Id<"users">
  onOpenDetail: (taskId: string) => void
  onComplete: (taskId: string, statusId: Id<"statuses">) => void
}) {
  const { statuses } = useTaskReferenceData()
  const reorderTask = useMutation(api.tasks.reorderTask)
  const hasAnyTasks = groups.some((g) => g.tasks.length > 0)

  // Optimistic reorder: per-group order held until server catches up
  const [optimisticOrders, setOptimisticOrders] = useState<Record<string, string[]>>({})
  const pendingGroupRef = useRef<string | null>(null)

  // Clear optimistic state when server data matches
  useEffect(() => {
    if (!pendingGroupRef.current) return
    const groupKey = pendingGroupRef.current
    const optimistic = optimisticOrders[groupKey]
    if (!optimistic) return

    const serverGroup = groups.find((g) => g.key === groupKey)
    if (!serverGroup) return

    const serverIds = serverGroup.tasks.map((t) => t._id as string)
    if (serverIds.join(",") === optimistic.join(",")) {
      setOptimisticOrders((prev) => {
        const next = { ...prev }
        delete next[groupKey]
        return next
      })
      pendingGroupRef.current = null
    }
  }, [groups, optimisticOrders])

  // Apply optimistic order to groups
  const displayGroups = useMemo(() => {
    return groups.map((group) => {
      const optimistic = optimisticOrders[group.key]
      if (!optimistic) return group

      const taskMap = new Map(group.tasks.map((t) => [t._id as string, t]))
      const reordered = optimistic
        .map((id) => taskMap.get(id))
        .filter(Boolean) as TaskWithJoins[]
      const seen = new Set(optimistic)
      const extras = group.tasks.filter((t) => !seen.has(t._id as string))

      return { ...group, tasks: [...reordered, ...extras] }
    })
  }, [groups, optimisticOrders])

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

      void reorderTask({
        taskId: taskId as Id<"tasks">,
        beforeKey,
        afterKey,
      })
    },
    [displayGroups, reorderTask],
  )

  if (!hasAnyTasks) {
    return (
      <>
        <MyTasksEmptyState hiddenCount={hiddenCount} />
        <HiddenTasksFooter count={hiddenCount} />
      </>
    )
  }

  return (
    <>
      {displayGroups.map((group) => {
        const isCompleted = group.key === "completed_today"
        const isToday = group.key === "today"
        const completedGroup = groups.find((g) => g.key === "completed_today")
        return (
          <MyTasksGroup
            key={group.key}
            groupKey={group.key}
            label={group.label}
            count={group.count}
            defaultOpen={!isCompleted || group.count <= 10}
          >
            {/* Celebration when Today group is empty and there are completed tasks */}
            {isToday && group.tasks.length === 0 && (completedGroup?.count ?? 0) > 0 && (
              <TodayAllDoneState completedCount={completedGroup?.count ?? 0} />
            )}
            <DragDropProvider
              sensors={[
                PointerSensor.configure({
                  activationConstraints: [
                    new PointerActivationConstraints.Distance({ value: 5 }),
                  ],
                }),
              ]}
              onDragEnd={(event) => {
                if (isCompleted || event.canceled) return
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
                  disabled={isCompleted}
                >
                  <MyTaskRow
                    task={task}
                    totalMinutes={timeMap?.[task._id]}
                    activity={activityMap?.[task._id]}
                    isCompletedToday={isCompleted}
                    onOpenDetail={onOpenDetail}
                    onComplete={onComplete}
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

      <HiddenTasksFooter count={hiddenCount} />
    </>
  )
}

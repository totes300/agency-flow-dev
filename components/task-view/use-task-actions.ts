"use client"

import { useCallback, useMemo } from "react"
import { useMutation } from "convex/react"
import { generateKeyBetween } from "fractional-indexing"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskPriority } from "@/convex/tasks/model"
import { toastArchiveSuccess, toastError } from "@/lib/toast-helpers"
import type { TaskRowDTO } from "@/components/task-view/row-model"
import type { ReorderNeighbours } from "@/components/task-view/row-editing"

/** `tasks.bulkUpdate` accepts at most this many ids per call. */
const BULK_LIMIT = 50

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/**
 * Row and selection-bar writes, all through the slice-1 mutations
 * (`tasks.update` → write.ts per task, `tasks.bulkUpdate` for the bulk
 * actions it has, `tasks.reorderTask` for drag reorder). The server enforces the access policy (§5.3); a refused
 * change surfaces as a toast, partial bulk results report the skips.
 */
export function useTaskActions() {
  const update = useMutation(api.tasks.update)
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)
  // The server computes the same key from the same neighbours, so the
  // optimistic row lands exactly where the drop put it (no snap-back).
  const reorderTask = useMutation(api.tasks.reorderTask).withOptimisticUpdate((store, { taskId, beforeKey, afterKey }) => {
    let sortKey: string
    try {
      sortKey = generateKeyBetween(beforeKey ?? null, afterKey ?? null)
    } catch {
      return
    }
    for (const { args, value } of store.getAllQueries(api.tasks.queries.listView)) {
      if (!value || !value.rows.some((r) => r._id === taskId)) continue
      store.setQuery(api.tasks.queries.listView, args, {
        ...value,
        rows: value.rows.map((r) => (r._id === taskId ? { ...r, sortKey } : r)),
      })
    }
  })

  /** Runs one `tasks.update` per task; reports failures without hiding successes. */
  const updateEach = useCallback(
    async (
      tasks: readonly TaskRowDTO[],
      patch: (task: TaskRowDTO) => Parameters<typeof update>[0] | null,
      failure: string,
    ) => {
      const calls = tasks.flatMap((t) => {
        const args = patch(t)
        return args ? [update(args)] : []
      })
      const results = await Promise.allSettled(calls)
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected")
      if (failed.length === 0) {
        if (tasks.length > 1) toast.success(`${plural(calls.length, "task")} updated`)
        return
      }
      if (failed.length === results.length) {
        toastError(failed[0].reason, failure)
        return
      }
      toast.info(`${plural(results.length - failed.length, "task")} updated · ${failed.length} skipped`)
    },
    [update],
  )

  const setStatus = useCallback(
    async (tasks: readonly TaskRowDTO[], statusId: Id<"statuses">) => {
      const targets = tasks.filter((t) => t.statusId !== statusId)
      if (targets.length === 0) return
      if (targets.length === 1) {
        try {
          await update({ id: targets[0]._id, statusId })
        } catch (err) {
          toastError(err, "Failed to change status")
        }
        return
      }
      try {
        let updated = 0
        let skipped = 0
        for (const ids of chunk(targets.map((t) => t._id), BULK_LIMIT)) {
          const result = await bulkUpdate({ taskIds: ids, action: { type: "status", statusId } })
          updated += result.updated
          skipped += result.skipped.length
        }
        toast.success(`${plural(updated, "task")} updated${skipped > 0 ? ` · ${skipped} skipped` : ""}`)
      } catch (err) {
        toastError(err, "Failed to change status")
      }
    },
    [bulkUpdate, update],
  )

  const setPriority = useCallback(
    (tasks: readonly TaskRowDTO[], priority: TaskPriority) =>
      updateEach(
        tasks,
        (t) => (t.priority === priority ? null : { id: t._id, priority }),
        "Failed to change priority",
      ),
    [updateEach],
  )

  /**
   * Toggles one assignee on the tasks: removes them when every task already
   * has them, otherwise adds them where missing. `null` clears all assignees.
   */
  const toggleAssignee = useCallback(
    (tasks: readonly TaskRowDTO[], userId: Id<"users"> | null) => {
      if (userId === null) {
        return updateEach(
          tasks,
          (t) => (t.assigneeIds.length === 0 ? null : { id: t._id, assigneeIds: [] }),
          "Failed to change assignees",
        )
      }
      const removing = tasks.every((t) => t.assigneeIds.includes(userId))
      return updateEach(
        tasks,
        (t) => {
          const has = t.assigneeIds.includes(userId)
          if (removing) return { id: t._id, assigneeIds: t.assigneeIds.filter((id) => id !== userId) }
          return has ? null : { id: t._id, assigneeIds: [...t.assigneeIds, userId] }
        },
        "Failed to change assignees",
      )
    },
    [updateEach],
  )

  /** Same toggle rule as assignees, for one label. */
  const toggleLabel = useCallback(
    (tasks: readonly TaskRowDTO[], labelId: Id<"labels">) => {
      const removing = tasks.every((t) => t.labelIds.includes(labelId))
      return updateEach(
        tasks,
        (t) => {
          const has = t.labelIds.includes(labelId)
          if (removing) return { id: t._id, labelIds: t.labelIds.filter((id) => id !== labelId) }
          return has ? null : { id: t._id, labelIds: [...t.labelIds, labelId] }
        },
        "Failed to change labels",
      )
    },
    [updateEach],
  )

  /** One task, one patch (board drag between columns); the server enforces the field policy. */
  const patchTask = useCallback(
    async (task: TaskRowDTO, patch: Omit<Parameters<typeof update>[0], "id">, failure: string) => {
      try {
        await update({ id: task._id, ...patch })
      } catch (err) {
        toastError(err, failure)
      }
    },
    [update],
  )

  const setWorkCategory = useCallback(
    (tasks: readonly TaskRowDTO[], workCategoryId: Id<"workCategories"> | null) =>
      updateEach(
        tasks,
        (t) => ((t.workCategoryId ?? null) === workCategoryId ? null : { id: t._id, workCategoryId }),
        "Failed to change the category",
      ),
    [updateEach],
  )

  const setProject = useCallback(
    (tasks: readonly TaskRowDTO[], projectId: Id<"projects"> | null) =>
      updateEach(
        tasks,
        (t) => ((t.projectId ?? null) === projectId ? null : { id: t._id, projectId }),
        "Failed to move the task",
      ),
    [updateEach],
  )

  const setDueDate = useCallback(
    (tasks: readonly TaskRowDTO[], dueDate: string | null) =>
      updateEach(
        tasks,
        (t) => ((t.dueDate ?? null) === dueDate ? null : { id: t._id, dueDate }),
        "Failed to change the due date",
      ),
    [updateEach],
  )

  /** Drag reorder in the global manual order (write path `reorderTask`). */
  const reorder = useCallback(
    async (taskId: Id<"tasks">, neighbours: ReorderNeighbours) => {
      try {
        await reorderTask({ taskId, ...neighbours })
      } catch (err) {
        toastError(err, "Failed to reorder")
      }
    },
    [reorderTask],
  )

  const archive = useCallback(
    async (taskIds: readonly Id<"tasks">[]) => {
      try {
        let updated = 0
        let skipped = 0
        const autoSavedTimers: { userName: string; minutes: number }[] = []
        const timerSaveFailures: { userName: string; reason: string }[] = []
        for (const ids of chunk(taskIds, BULK_LIMIT)) {
          const result = await bulkUpdate({ taskIds: ids, action: { type: "archive" } })
          updated += result.updated
          skipped += result.skipped.length
          autoSavedTimers.push(...result.autoSavedTimers)
          timerSaveFailures.push(...result.timerSaveFailures)
        }
        toastArchiveSuccess(
          { autoSavedTimers, timerSaveFailures },
          `${plural(updated, "task")} archived${skipped > 0 ? ` · ${skipped} skipped` : ""}`,
        )
      } catch (err) {
        toastError(err, "Failed to archive")
      }
    },
    [bulkUpdate],
  )

  return useMemo(
    () => ({
      setStatus,
      setPriority,
      toggleAssignee,
      toggleLabel,
      setWorkCategory,
      setProject,
      setDueDate,
      patchTask,
      reorder,
      archive,
    }),
    [setStatus, setPriority, toggleAssignee, toggleLabel, setWorkCategory, setProject, setDueDate, patchTask, reorder, archive],
  )
}

export type TaskActions = ReturnType<typeof useTaskActions>

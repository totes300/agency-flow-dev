"use client"

import { useCallback, useMemo, useRef } from "react"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"
import type { MemberRef } from "@/components/task-view/row-model"
import { addedToTodayMessage, bulkAddedMessage, type SunState } from "@/components/task-view/sun"

const REMOVAL_MESSAGES: Record<"deleted" | "trimmed" | "split", string> = {
  deleted: "Removed from today",
  trimmed: "Removed from today · the other planned days stay",
  split: "Removed from today · the other planned days stay",
}

/**
 * Today writes (`api.tasks.today.*`, §5.6): the sun on rows/cards/T, the
 * selection bar's bulk add, and the Today tab's keep / remove / reorder.
 * `today` is the client's calendar day (the server accepts it within a day
 * of the org's). The sun state flips optimistically on `plannedToday`, and
 * a Today reorder lands optimistically on `listToday`.
 */
export function useTodayActions({
  today,
  me,
  memberById,
}: {
  today: string
  me: Id<"users"> | null
  memberById: ReadonlyMap<Id<"users">, MemberRef>
}) {
  // The sun's targets per task while its add is in flight (the optimistic update only sees the args).
  const pendingTargets = useRef(new Map<Id<"tasks">, readonly Id<"users">[]>())
  const addToToday = useMutation(api.tasks.today.addToToday).withOptimisticUpdate((store, { taskId }) => {
    const targets = pendingTargets.current.get(taskId) ?? []
    for (const { args, value } of store.getAllQueries(api.tasks.today.plannedToday)) {
      if (!value) continue
      const current = value[taskId] ?? []
      store.setQuery(api.tasks.today.plannedToday, args, { ...value, [taskId]: [...new Set([...current, ...targets])] })
    }
  })
  const removeFromToday = useMutation(api.tasks.today.removeFromToday).withOptimisticUpdate((store, { taskId }) => {
    for (const { args, value } of store.getAllQueries(api.tasks.today.plannedToday)) {
      if (!value?.[taskId]) continue
      const next = { ...value }
      delete next[taskId]
      store.setQuery(api.tasks.today.plannedToday, args, next)
    }
  })
  const bulkAdd = useMutation(api.tasks.today.bulkAddToToday)
  const keepCarried = useMutation(api.tasks.today.keepCarried)
  const removeCarried = useMutation(api.tasks.today.removeCarried)
  const reorderToday = useMutation(api.tasks.today.reorderToday).withOptimisticUpdate((store, { taskIds }) => {
    for (const { args, value } of store.getAllQueries(api.tasks.today.listToday)) {
      if (!value) continue
      const rank = new Map(taskIds.map((id, i) => [id, i]))
      const reordered = [...value.today].sort(
        (a, b) => (rank.get(a.taskId) ?? Infinity) - (rank.get(b.taskId) ?? Infinity),
      )
      store.setQuery(api.tasks.today.listToday, args, { ...value, today: reordered })
    }
  })

  /** The sun: off → plan for the targets (D9); on → take it out of their today. */
  const toggleSun = useCallback(
    async (taskId: Id<"tasks">, state: SunState) => {
      if (state.kind === "hidden") return
      if (state.kind === "disabled") {
        toast.info(state.label)
        return
      }
      try {
        if (state.kind === "on") {
          const result = await removeFromToday({ taskId, today })
          if (result.kind) toast.success(REMOVAL_MESSAGES[result.kind])
        } else {
          pendingTargets.current.set(taskId, state.targets)
          const result = await addToToday({ taskId, today })
          if (me) toast.success(addedToTodayMessage(result, me, memberById))
        }
      } catch (err) {
        toastError(err, state.kind === "on" ? "Failed to remove from today" : "Failed to add to today")
      } finally {
        pendingTargets.current.delete(taskId)
      }
    },
    [addToToday, me, memberById, removeFromToday, today],
  )

  /** Selection bar "Add to today" (D9 bulk): reports added · skipped (no assignee). */
  const addManyToToday = useCallback(
    async (taskIds: readonly Id<"tasks">[]) => {
      if (taskIds.length === 0) return
      try {
        const result = await bulkAdd({ taskIds: [...taskIds], today })
        if (result.added === 0 && result.alreadyPlanned === 0) toast.info(bulkAddedMessage(result))
        else toast.success(bulkAddedMessage(result))
      } catch (err) {
        toastError(err, "Failed to add to today")
      }
    },
    [bulkAdd, today],
  )

  /** Plans tasks for the caller's own day (Keep for today, Keep all, the picker). */
  const planMyDay = useCallback(
    async (taskIds: readonly Id<"tasks">[], message?: (added: number) => string) => {
      if (taskIds.length === 0) return
      try {
        const result = await keepCarried({ taskIds: [...taskIds], today })
        const text = message?.(result.added) ?? `Added ${result.added} to today`
        toast.success(result.skipped > 0 ? `${text} · ${result.skipped} skipped` : text)
      } catch (err) {
        toastError(err, "Failed to add to today")
      }
    },
    [keepCarried, today],
  )

  /** Out of the caller's own day only (rows of the Today list). */
  const removeFromMyToday = useCallback(
    async (taskId: Id<"tasks">) => {
      try {
        const result = await removeFromToday({ taskId, mine: true, today })
        if (result.kind) toast.success(REMOVAL_MESSAGES[result.kind])
      } catch (err) {
        toastError(err, "Failed to remove from today")
      }
    },
    [removeFromToday, today],
  )

  /** "Remove" on a carried-over row: drops the stale plan. */
  const dropCarried = useCallback(
    async (taskId: Id<"tasks">) => {
      try {
        await removeCarried({ taskId, today })
      } catch (err) {
        toastError(err, "Failed to remove the plan")
      }
    },
    [removeCarried, today],
  )

  const reorder = useCallback(
    async (taskIds: readonly Id<"tasks">[]) => {
      try {
        await reorderToday({ taskIds: [...taskIds], today })
      } catch (err) {
        toastError(err, "Failed to reorder")
      }
    },
    [reorderToday, today],
  )

  return useMemo(
    () => ({ toggleSun, addManyToToday, planMyDay, removeFromMyToday, dropCarried, reorder }),
    [addManyToToday, dropCarried, planMyDay, removeFromMyToday, reorder, toggleSun],
  )
}

export type TodayActions = ReturnType<typeof useTodayActions>

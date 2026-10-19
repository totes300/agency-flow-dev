"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDateToYMD } from "@/lib/format"
import { useOptionalQuery } from "@/lib/hooks/use-optional-query"
import { buildRowModels, indexRefs, type MemberRef, type TaskRowModel } from "@/components/task-view/row-model"
import type { PropertyMenuKind, PropertyMenuRequest } from "@/components/task-view/property-menus"
import { sunStateFor, whoseToday, type SunState } from "@/components/task-view/sun"
import { useTaskActions } from "@/components/task-view/use-task-actions"
import { useTodayActions } from "@/components/task-view/use-today-actions"
import { useToggleTaskTimer } from "@/components/task-view/use-toggle-task-timer"

/** `tasks.queries.getDetail` / `getByIdentifier` (§5.4): the row DTO + description, parent, permissions, per-user state. */
export type TaskDetailDTO = NonNullable<FunctionReturnType<typeof api.tasks.queries.getDetail>>

const NO_MEMBERS: ReadonlyMap<Id<"users">, MemberRef> = new Map()

/** The Today property row (D9): the sun's state on the open task and whose day it means. */
export type DetailSun = {
  state: SunState
  /** "your", "Bob's", … for the targets (empty when hidden/disabled). */
  whose: string
  toggle: () => void
}

/**
 * Everything the drawer and the full page share for one open task
 * (docs/prd-tasks-refactor.md §6.2): the resolved row model (names from
 * `workspaceRefs`), its sub-tasks as row models, one `PropertyMenu` request
 * for the property panel and the sub-task cells, the sun (D9) and the timer
 * (T / Y inside an open task), and `markViewed` on open (§4.3).
 */
export function useTaskDetailController(task: TaskDetailDTO | null | undefined, { isAdmin }: { isAdmin: boolean }) {
  const { isAuthenticated } = useConvexAuth()
  const [today] = useState(() => formatDateToYMD(new Date()))
  const refs = useQuery(api.workspaceRefs.get, isAuthenticated ? {} : "skip")
  const index = useMemo(() => (refs ? indexRefs(refs) : null), [refs])
  const memberById = index?.memberById ?? NO_MEMBERS

  const row: TaskRowModel | null = useMemo(
    () => (task && index ? buildRowModels([task], { [task._id]: task.perUser }, index)[0] : null),
    [task, index],
  )

  // Sub-tasks are one level deep (D6): a sub-task has none.
  const subtasks = useQuery(
    api.tasks.queries.subtasks,
    isAuthenticated && task && !task.parentTaskId ? { parentTaskId: task._id, today } : "skip",
  )
  const subtaskRows: TaskRowModel[] | undefined = useMemo(
    () => (subtasks && index ? buildRowModels(subtasks.rows, subtasks.perUser, index) : undefined),
    [subtasks, index],
  )

  // ─── Property menu (priority, labels, start date + sub-task cells) ─────────
  const actions = useTaskActions()
  const taskId = task?._id
  // The menu belongs to the task it was opened on: stepping to another task closes it.
  const [menuState, setMenuState] = useState<{ forTask: Id<"tasks"> | undefined; request: PropertyMenuRequest } | null>(null)
  const menu = menuState && menuState.forTask === taskId ? menuState.request : null
  const openMenu = useCallback(
    (kind: PropertyMenuKind, menuTaskId: Id<"tasks">, anchor: HTMLElement) => {
      setMenuState((current) =>
        current && current.forTask === taskId && current.request.anchor === anchor && current.request.kind === kind
          ? null
          : { forTask: taskId, request: { kind, taskIds: [menuTaskId], anchor } },
      )
    },
    [taskId],
  )
  const closeMenu = useCallback(() => setMenuState(null), [])
  const menuTasks = useMemo(() => {
    if (!menu) return []
    return menu.taskIds.flatMap((id) => {
      if (task && id === task._id) return [task]
      return subtaskRows?.find((r) => r.task._id === id)?.task ?? []
    })
  }, [menu, subtaskRows, task])

  // ─── Today (D9) and the timer ──────────────────────────────────────────────
  const { data: planned } = useOptionalQuery(api.tasks.today.plannedToday, isAuthenticated && task ? { today } : "skip")
  const todayActions = useTodayActions({ today, me: refs?.me ?? null, memberById })
  const sun: DetailSun = useMemo(() => {
    const state: SunState = row && refs ? sunStateFor(row, { me: refs.me, isAdmin }, planned, memberById) : { kind: "hidden" }
    const whose = (state.kind === "on" || state.kind === "off") && refs ? whoseToday(state.targets, refs.me, memberById) : ""
    return {
      state,
      whose,
      toggle: () => {
        if (row) void todayActions.toggleSun(row.task._id, state)
      },
    }
  }, [isAdmin, memberById, planned, refs, row, todayActions])

  const toggleTaskTimer = useToggleTaskTimer()
  const toggleTimer = useCallback(() => {
    if (row) void toggleTaskTimer(row.task._id, row.isClosed)
  }, [row, toggleTaskTimer])

  // ─── markViewed on open (§4.3): resets unread comments + the unseen dot ────
  const markViewed = useMutation(api.tasks.userState.markViewed)
  useEffect(() => {
    if (!taskId) return
    const timer = setTimeout(() => {
      markViewed({ taskId }).catch(() => {
        // Best effort: a failed stamp only leaves the row's unread state.
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [taskId, markViewed])

  return {
    today,
    refs,
    index,
    memberById,
    row,
    subtaskRows,
    subtasksTruncated: subtasks?.truncated ?? false,
    actions,
    menu,
    menuTasks,
    openMenu,
    closeMenu,
    sun,
    toggleTimer,
  }
}

export type TaskDetailController = ReturnType<typeof useTaskDetailController>

/**
 * Keys inside an open task (U10): J/K step through the list it was opened
 * from, T plans it for today (D9), Y starts/stops its timer. Ignored while
 * typing, with a modifier held, or while a dialog/menu is open.
 */
export function useTaskDetailKeys(handlers: {
  enabled: boolean
  onStep: (direction: "next" | "prev") => void
  onToday: () => void
  onTimer: () => void
}) {
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const h = ref.current
      if (!h.enabled || e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return
      }
      if (document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open']")) return
      switch (e.key.toLowerCase()) {
        case "j":
          e.preventDefault()
          return h.onStep("next")
        case "k":
          e.preventDefault()
          return h.onStep("prev")
        case "t":
          e.preventDefault()
          return h.onToday()
        case "y":
          e.preventDefault()
          return h.onTimer()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])
}

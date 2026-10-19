"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { formatDateToYMD } from "@/lib/format"
import {
  buildTaskUrl,
  getAdjacentTaskId,
  parseCommentParam,
  parseTaskRef,
  taskPagePath,
  type TaskRef,
} from "@/lib/task-detail"
import type { TaskDetailDTO } from "@/components/task-detail/use-task-detail"
import type { TaskDetailMode } from "@/components/task-detail/task-detail-actions"
import { navLabelFor, setDetailNavList } from "@/components/task-detail/detail-nav"

/** The loaded task is the one the URL points at (same id, or same identifier ignoring case). */
export function taskMatchesRef(task: Pick<TaskDetailDTO, "_id" | "identifier">, ref: TaskRef): boolean {
  if (ref.kind === "id") return task._id === ref.id
  return task.identifier !== null && task.identifier.toUpperCase() === ref.identifier.toUpperCase()
}

/**
 * The drawer's URL state (docs/prd-tasks-refactor.md §6.1): `?task=<identifier>`
 * on any route, plus old `?detail=<taskId>` links. Resolves the task through
 * `getByIdentifier` (aliases too) or `getDetail`, then rewrites the URL to the
 * canonical `?task=<current identifier>` (keeping a comment deep-link).
 *
 * With the per-user mode set to "page", a task opened by an old `?detail=`
 * link (Planner, Workday, inbox, project pages…) goes to its full page
 * instead; `?task=` always means the drawer (a list's peek, a drawer link).
 * J/K step through `taskIds` (the list the drawer was opened from).
 */
export function useDrawerTask({
  taskIds,
  identifierOf,
  mode,
  modeReady,
}: {
  taskIds: readonly string[]
  identifierOf?: (taskId: string) => string | null
  mode: TaskDetailMode
  modeReady: boolean
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useConvexAuth()
  const [today] = useState(() => formatDateToYMD(new Date()))

  const ref = parseTaskRef(searchParams)
  const refKey = ref ? `${ref.kind}:${ref.kind === "id" ? ref.id : ref.identifier}` : null

  const byIdentifier = useQuery(
    api.tasks.queries.getByIdentifier,
    isAuthenticated && ref?.kind === "identifier" ? { identifier: ref.identifier, today } : "skip",
  )
  const byId = useQuery(
    api.tasks.queries.getDetail,
    isAuthenticated && ref?.kind === "id" ? { taskId: ref.id as Id<"tasks">, today } : "skip",
  )
  const live: TaskDetailDTO | null | undefined =
    ref?.kind === "identifier" ? byIdentifier : ref?.kind === "id" ? byId : undefined

  // While the canonical query loads after a URL rewrite, keep the task that
  // was just resolved (same task) instead of flashing the skeleton.
  const [sticky, setSticky] = useState<TaskDetailDTO | null>(null)
  if (live && live !== sticky) setSticky(live)
  const task: TaskDetailDTO | null | undefined =
    live !== undefined ? live : ref && sticky && taskMatchesRef(sticky, ref) ? sticky : undefined

  // A drawer opened (closed → open) by an old `?detail=` link follows the page mode.
  const isOpen = ref !== null
  const [wasOpen, setWasOpen] = useState(false)
  const [legacyOpen, setLegacyOpen] = useState(false)
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen)
    setLegacyOpen(isOpen && ref?.kind === "id")
  }
  const toPage = legacyOpen && modeReady && mode === "page"

  // The list for the page's J/K, read when redirecting (not a reason to re-run it).
  const listRef = useRef({ taskIds, identifierOf })
  useEffect(() => {
    listRef.current = { taskIds, identifierOf }
  })

  const liveId = live?._id
  const liveIdentifier = live?.identifier ?? null
  useEffect(() => {
    if (!refKey || !liveId || !liveIdentifier || !modeReady) return
    const current = new URLSearchParams(window.location.search)
    const currentRef = parseTaskRef(current)
    if (!currentRef) return
    if (toPage) {
      const back = buildTaskUrl(current, null)
      setDetailNavList({
        from: { label: navLabelFor(pathname), href: `${pathname}${back}` },
        entries: listRef.current.taskIds.map((id) => ({
          id: id as Id<"tasks">,
          identifier: listRef.current.identifierOf?.(id) ?? null,
        })),
      })
      router.replace(taskPagePath(liveIdentifier, parseCommentParam(current)), { scroll: false })
      return
    }
    if (currentRef.kind === "identifier" && currentRef.identifier === liveIdentifier) return
    router.replace(`${pathname}${buildTaskUrl(current, { id: liveId, identifier: liveIdentifier }, { keepComment: true })}`, {
      scroll: false,
    })
  }, [liveId, liveIdentifier, modeReady, pathname, refKey, router, toPage])

  const navigateTo = useCallback(
    (taskId: string | null) => {
      const current = new URLSearchParams(window.location.search)
      const target = taskId ? { id: taskId, identifier: identifierOf?.(taskId) ?? null } : null
      router.replace(`${pathname}${buildTaskUrl(current, target)}`, { scroll: false })
    },
    [identifierOf, pathname, router],
  )
  const close = useCallback(() => navigateTo(null), [navigateTo])

  const currentId = task?._id ?? null
  const { index, prevId, nextId } = useMemo(() => {
    if (!currentId) return { index: null, prevId: null, nextId: null }
    const i = taskIds.indexOf(currentId)
    return {
      index: i === -1 ? null : i,
      prevId: i === -1 ? null : getAdjacentTaskId(currentId, taskIds as string[], "prev"),
      nextId: i === -1 ? null : getAdjacentTaskId(currentId, taskIds as string[], "next"),
    }
  }, [currentId, taskIds])
  const step = useCallback(
    (direction: "next" | "prev") => {
      const target = direction === "next" ? nextId : prevId
      if (target) navigateTo(target)
    },
    [navigateTo, nextId, prevId],
  )

  return {
    isOpen: isOpen && !toPage,
    task,
    notFound: ref !== null && live === null,
    navigateTo,
    close,
    step,
    index,
    total: taskIds.length,
  }
}

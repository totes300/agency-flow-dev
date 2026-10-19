"use client"

import { useCallback } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { Id } from "@/convex/_generated/dataModel"
import { buildTaskUrl, taskPagePath } from "@/lib/task-detail"
import { useTaskDetailMode } from "@/components/task-detail/task-detail-actions"
import { setDetailNavList } from "@/components/task-detail/detail-nav"

/**
 * Opening a task from a list or board (U9, §6.1 "Slice 6 details"): `open`
 * (click, Enter) shows the drawer (`?task=<identifier>`) or the full page per
 * the user's setting, recording the list for the page's J/K and back link;
 * `peek` (Space) always uses the drawer. `onOpened` lets the caller focus
 * the row. Shared by the task view and the dashboard board.
 */
export function useTaskOpener({
  identifierOf,
  orderedIds,
  fromLabel,
  onOpened,
}: {
  identifierOf: (taskId: Id<"tasks">) => string | null
  /** The tasks in screen order (J/K on the full page). */
  orderedIds: readonly Id<"tasks">[]
  /** The full page's back link label ("Tasks", "My Tasks", "Dashboard"). */
  fromLabel: string
  onOpened?: (taskId: Id<"tasks">) => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { mode } = useTaskDetailMode()

  const peek = useCallback(
    (taskId: Id<"tasks">) => {
      onOpened?.(taskId)
      const target = { id: taskId, identifier: identifierOf(taskId) }
      router.push(`${pathname}${buildTaskUrl(new URLSearchParams(searchParams.toString()), target)}`, { scroll: false })
    },
    [identifierOf, onOpened, pathname, router, searchParams],
  )

  const open = useCallback(
    (taskId: Id<"tasks">) => {
      const identifier = identifierOf(taskId)
      if (mode !== "page" || !identifier) return peek(taskId)
      onOpened?.(taskId)
      const back = buildTaskUrl(new URLSearchParams(searchParams.toString()), null)
      setDetailNavList({
        from: { label: fromLabel, href: `${pathname}${back}` },
        entries: orderedIds.map((id) => ({ id, identifier: identifierOf(id) })),
      })
      router.push(taskPagePath(identifier))
    },
    [fromLabel, identifierOf, mode, onOpened, orderedIds, pathname, peek, router, searchParams],
  )

  return { open, peek }
}

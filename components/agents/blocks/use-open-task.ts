"use client"

import { createContext, useCallback, useContext } from "react"
import { useRouter } from "next/navigation"
import { buildTaskDeepLink, taskPagePath } from "@/lib/task-detail"

/** A task a widget links to (the task card, a request checklist row). */
export type WidgetTaskRef = { id: string; identifier: string | null }

/**
 * How a conversation surface opens a task from a widget (B8a). A surface
 * that mounts the task drawer (Triage, Reviews — `TaskDetailDrawer`) provides
 * an in-place opener (`?task=`); without one the widget goes to the task's
 * page, which works on every route (the Agents workspace has no task drawer).
 */
export const WidgetTaskOpenerContext = createContext<((task: WidgetTaskRef) => void) | null>(null)

export function useOpenWidgetTask(): (task: WidgetTaskRef) => void {
  const provided = useContext(WidgetTaskOpenerContext)
  const router = useRouter()
  return useCallback(
    (task: WidgetTaskRef) => {
      if (provided) return provided(task)
      router.push(task.identifier ? taskPagePath(task.identifier) : buildTaskDeepLink(task.id))
    },
    [provided, router],
  )
}

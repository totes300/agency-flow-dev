"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { parseDetailParam, buildDetailUrl, getAdjacentTaskId } from "@/lib/task-detail"
import type { Id } from "@/convex/_generated/dataModel"

export function useTaskDetail(taskIds: string[]) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { isAuthenticated } = useConvexAuth()

  const detailId = parseDetailParam(searchParams)
  const isOpen = !!detailId

  // ─── Query task detail ──────────────────────────────────────────────────────
  const task = useQuery(
    api.tasks.getDetail,
    isAuthenticated && detailId
      ? { id: detailId as Id<"tasks"> }
      : "skip",
  )

  // ─── Navigation helpers ─────────────────────────────────────────────────────
  const navigateToTask = useCallback(
    (taskId: string | null) => {
      const url = buildDetailUrl(searchParams, taskId as Id<"tasks"> | null)
      router.replace(`${pathname}${url}`, { scroll: false })
    },
    [searchParams, router, pathname],
  )

  const handleClose = useCallback(() => {
    navigateToTask(null)
  }, [navigateToTask])

  const handleNavigate = useCallback(
    (direction: "next" | "prev") => {
      if (!detailId) return
      const adjacent = getAdjacentTaskId(detailId, taskIds, direction)
      if (adjacent) navigateToTask(adjacent)
    },
    [detailId, taskIds, navigateToTask],
  )

  // Memoize nav state to avoid O(n) indexOf on every render
  const { hasNext, hasPrev } = useMemo(() => ({
    hasNext: !!detailId && !!getAdjacentTaskId(detailId, taskIds, "next"),
    hasPrev: !!detailId && !!getAdjacentTaskId(detailId, taskIds, "prev"),
  }), [detailId, taskIds])

  // ─── Keyboard: J/K navigation ──────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return

      if (e.key === "j" || e.key === "J") {
        e.preventDefault()
        handleNavigate("next")
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault()
        handleNavigate("prev")
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleNavigate])

  // ─── Mark task as viewed after 500ms (only after data loads) ─────────────
  const markViewed = useMutation(api.taskViewReceipts.markViewed)
  const loadedTaskId = task?._id
  useEffect(() => {
    if (!loadedTaskId) return
    const timer = setTimeout(() => {
      void markViewed({ taskId: loadedTaskId })
    }, 500)
    return () => clearTimeout(timer)
  }, [loadedTaskId, markViewed])

  return {
    task,
    detailId,
    isOpen,
    handleClose,
    handleNavigate,
    navigateToTask,
    hasNext,
    hasPrev,
  }
}

"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { TaskDetailHeader } from "@/components/tasks/task-detail-header"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import { TaskDetailMetadata } from "@/components/tasks/task-detail-metadata"
import { TaskDetailTabs } from "@/components/tasks/task-detail-tabs"
import { TaskDetailSidebar } from "@/components/tasks/task-detail-sidebar"
import { parseDetailParam, buildDetailUrl, getAdjacentTaskId } from "@/lib/task-detail"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailModal({
  taskIds,
  isAdmin,
}: {
  taskIds: string[]
  isAdmin: boolean
}) {
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

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 flex h-full max-h-none w-full max-w-none -translate-x-0 -translate-y-0 items-center justify-center rounded-none border-0 bg-transparent p-4 ring-0 shadow-none sm:max-w-none sm:p-8 data-open:zoom-in-100 data-closed:zoom-out-100"
        onPointerDownOutside={handleClose}
      >
        <div
          className="flex h-full max-h-[calc(100vh-4rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-xl"
        >
          <DialogTitle className="sr-only">Task detail</DialogTitle>
          <DialogDescription className="sr-only">View and edit task details, subtasks, time entries, and activity</DialogDescription>

          {/* Top bar */}
          <TaskDetailHeader
            task={task ?? null}
            isAdmin={isAdmin}
            onClose={handleClose}
            onNavigate={handleNavigate}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />

          {/* Body: left content + right sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: main content */}
            <div className="flex flex-1 flex-col overflow-hidden">
              {task ? (
                <>
                  <TaskDetailTitle taskId={task._id} title={task.title} />
                  <TaskDetailMetadata task={task} isAdmin={isAdmin} />
                  <TaskDetailTabs task={task} isAdmin={isAdmin} onOpenDetail={navigateToTask} />
                </>
              ) : (
                <TaskDetailSkeleton />
              )}
            </div>

            {/* Right: activity sidebar */}
            {detailId && (
              <TaskDetailSidebar taskId={detailId as Id<"tasks">} />
            )}
          </div>
          </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Content-aware skeleton ─────────────────────────────────────────────────────

function TaskDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col p-7 gap-5">
      {/* Title */}
      <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
      {/* Metadata grid — 2 columns × 4 rows */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 h-9">
            <div className="size-3.5 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
      {/* Tab bar */}
      <div className="flex gap-4 border-b border-border/40 pb-2">
        {["w-16", "w-10", "w-20", "w-12"].map((w, i) => (
          <div key={i} className={`h-3.5 ${w} animate-pulse rounded bg-muted`} />
        ))}
      </div>
      {/* Content area */}
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

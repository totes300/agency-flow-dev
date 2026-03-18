"use client"

import { useCallback, useEffect } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog"
import { Dialog as DialogPrimitive } from "radix-ui"
import { TaskDetailHeader } from "@/components/tasks/task-detail-header"
import { TaskDetailMetadata } from "@/components/tasks/task-detail-metadata"
import { TaskDetailTabs } from "@/components/tasks/task-detail-tabs"
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

  // ─── Keyboard: J/K navigation, Escape ───────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      // Don't intercept when typing in inputs
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
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-8 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          onPointerDownOutside={handleClose}
        >
          <div
            className="flex h-full max-h-[calc(100vh-4rem)] w-full max-w-[1300px] flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <DialogTitle className="sr-only">Task detail</DialogTitle>

            {/* Top bar */}
            <TaskDetailHeader
              task={task ?? null}
              isAdmin={isAdmin}
              onClose={handleClose}
              onNavigate={handleNavigate}
              hasNext={!!detailId && !!getAdjacentTaskId(detailId, taskIds, "next")}
              hasPrev={!!detailId && !!getAdjacentTaskId(detailId, taskIds, "prev")}
            />

            {/* Body: left content + right sidebar */}
            <div className="flex flex-1 overflow-hidden">
              {/* Left: main content */}
              <div className="flex flex-1 flex-col overflow-hidden">
                {task ? (
                  <>
                    {/* Title */}
                    <TaskDetailTitle taskId={task._id} title={task.title} />

                    {/* Metadata grid */}
                    <TaskDetailMetadata task={task} isAdmin={isAdmin} />

                    {/* Tabs */}
                    <TaskDetailTabs task={task} isAdmin={isAdmin} />
                  </>
                ) : (
                  <TaskDetailSkeleton />
                )}
              </div>

              {/* Right: activity sidebar */}
              <div className="flex w-[340px] shrink-0 flex-col border-l border-border/40 bg-sidebar">
                <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                  <span className="text-sm font-semibold">Activity</span>
                </div>
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  Coming in PR3
                </div>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}

// ─── Title (inline editable) ────────────────────────────────────────────────

import { useState, useRef } from "react"
import { useMutation } from "convex/react"

function TaskDetailTitle({
  taskId,
  title,
}: {
  taskId: Id<"tasks">
  title: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const updateTask = useMutation(api.tasks.update)

  // Sync with prop when not editing
  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === title) {
      setValue(title)
      setEditing(false)
      return
    }
    try {
      await updateTask({ id: taskId, title: trimmed })
    } catch {
      setValue(title)
    }
    setEditing(false)
  }

  return (
    <div className="shrink-0 px-7 pt-6 pb-2">
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave()
            if (e.key === "Escape") { setValue(title); setEditing(false) }
          }}
          className="w-full text-[22px] font-semibold tracking-tight text-foreground outline-none"
          autoFocus
        />
      ) : (
        <h1
          onClick={() => {
            setEditing(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className="cursor-text text-[22px] font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>
      )}
    </div>
  )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function TaskDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      <div className="h-7 w-2/3 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/4 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-32 w-full animate-pulse rounded bg-muted" />
    </div>
  )
}

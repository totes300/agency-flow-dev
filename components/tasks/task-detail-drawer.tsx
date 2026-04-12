"use client"

import { useEffect, useState } from "react"
import { FocusScope } from "@radix-ui/react-focus-scope"
import { ErrorBoundary } from "@/components/error-boundary"
import { TaskDetailDrawerHeader } from "@/components/tasks/task-detail-drawer-header"
import { TaskDetailDrawerContent } from "@/components/tasks/task-detail-drawer-content"
import { TaskDetailMetadata } from "@/components/tasks/task-detail-metadata"
import { useTaskDetail } from "@/components/tasks/use-task-detail"
import { cn } from "@/lib/utils"

export function TaskDetailDrawer({
  taskIds,
  isAdmin,
}: {
  taskIds: string[]
  isAdmin: boolean
}) {
  const {
    task,
    detailId,
    isOpen,
    handleClose,
    handleNavigate,
    navigateToTask,
    hasNext,
    hasPrev,
  } = useTaskDetail(taskIds)

  // Properties panel — visible by default on wide screens
  const [showProperties, setShowProperties] = useState(true)

  // Auto-collapse properties below 1440px
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1440px)")
    setShowProperties(mq.matches)
    function handleChange(e: MediaQueryListEvent) {
      setShowProperties(e.matches)
    }
    mq.addEventListener("change", handleChange)
    return () => mq.removeEventListener("change", handleChange)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        handleClose()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleClose])

  // Lock body scroll when open
  useEffect(() => {
    if (!isOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [isOpen])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Task detail"
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 w-[54vw] border-l border-border bg-background shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)] flex flex-col",
        "transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      {isOpen ? (
        <FocusScope trapped className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <ErrorBoundary>
            <TaskDetailDrawerHeader
              task={task ?? null}
              isAdmin={isAdmin}
              onClose={handleClose}
              onOpenDetail={navigateToTask}
              onToggleProperties={() => setShowProperties((p) => !p)}
              showProperties={showProperties}
            />

            <div className="flex flex-1 overflow-hidden">
              {/* Main content */}
              {task ? (
                <TaskDetailDrawerContent
                  task={task}
                  isAdmin={isAdmin}
                  onOpenDetail={navigateToTask}
                />
              ) : (
                <div className="flex-1 p-6">
                  <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
                </div>
              )}

              {/* Properties sidebar — collapsible */}
              {task && showProperties ? (
                <div className="w-[240px] shrink-0 overflow-y-auto scrollbar-thin border-l border-border/70">
                  <TaskDetailMetadata task={task} isAdmin={isAdmin} layout="stack" />
                </div>
              ) : null}
            </div>
          </ErrorBoundary>
        </FocusScope>
      ) : null}
    </div>
  )
}

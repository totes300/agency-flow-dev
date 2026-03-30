"use client"

import { Dialog, DialogFullscreenContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { ErrorBoundary } from "@/components/error-boundary"
import { TaskDetailHeader } from "@/components/tasks/task-detail-header"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import { TaskDetailMetadata } from "@/components/tasks/task-detail-metadata"
import { TaskDetailTabs } from "@/components/tasks/task-detail-tabs"
import { TaskDetailSidebar } from "@/components/tasks/task-detail-sidebar"
import { useTaskDetail } from "@/components/tasks/use-task-detail"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailModal({
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

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogFullscreenContent
        onPointerDownOutside={handleClose}
      >
        <div
          className="flex h-full max-h-[calc(100vh-4rem)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-background ring-1 ring-border shadow-xl"
        >
          <DialogTitle className="sr-only">Task detail</DialogTitle>
          <DialogDescription className="sr-only">View and edit task details, subtasks, time entries, and activity</DialogDescription>

          <ErrorBoundary>
          {/* Top bar */}
          <TaskDetailHeader
            task={task ?? null}
            isAdmin={isAdmin}
            onClose={handleClose}
            onNavigate={handleNavigate}
            onOpenDetail={navigateToTask}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />

          {/* Body: left content + right sidebar */}
          <div className="flex flex-1 overflow-hidden">
            {/* Left: main content */}
            <div className="flex min-w-0 flex-1 justify-center overflow-hidden">
              <div className="flex min-w-0 w-full max-w-[900px] flex-1 flex-col overflow-hidden">
                {task ? (
                  <>
                    <div className="px-7 pt-6">
                      <TaskDetailTitle taskId={task._id} title={task.title} />
                    </div>
                    <TaskDetailMetadata task={task} isAdmin={isAdmin} />
                    <TaskDetailTabs task={task} isAdmin={isAdmin} onOpenDetail={navigateToTask} />
                  </>
                ) : (
                  <TaskDetailSkeleton />
                )}
              </div>
            </div>

            {/* Right: activity sidebar */}
            {detailId && (
              <TaskDetailSidebar taskId={detailId as Id<"tasks">} isAdmin={isAdmin} />
            )}
          </div>
          </ErrorBoundary>
          </div>
      </DialogFullscreenContent>
    </Dialog>
  )
}

// ─── Content-aware skeleton ─────────────────────────────────────────────────────

function TaskDetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col p-7 gap-5">
      {/* Title */}
      <div className="h-7 w-2/3 animate-pulse rounded-md bg-muted" />
      {/* Metadata grid */}
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

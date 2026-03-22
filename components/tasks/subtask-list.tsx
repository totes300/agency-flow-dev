"use client"

import { useState, useCallback } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { DragDropProvider } from "@dnd-kit/react"
import { move } from "@dnd-kit/helpers"
import { api } from "@/convex/_generated/api"
import { SubtaskRow } from "@/components/tasks/subtask-row"
import { SubtaskInlineCreate } from "@/components/tasks/subtask-inline-create"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { computeSubtaskProgress } from "@/lib/task-detail"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { SUBTASK_GRID_COLS } from "@/components/tasks/subtask-constants"
import type { Id } from "@/convex/_generated/dataModel"

export function SubtaskList({
  parentTaskId,
  parentProjectId,
  parentBillable,
  parentCategoryId,
  parentAssigneeIds,
  isAdmin,
  onOpenDetail,
}: {
  parentTaskId: Id<"tasks">
  parentProjectId?: Id<"projects">
  parentBillable: boolean
  parentCategoryId?: Id<"workCategories">
  parentAssigneeIds: Id<"users">[]
  isAdmin: boolean
  onOpenDetail: (taskId: string) => void
}) {
  const { isAuthenticated } = useConvexAuth()
  const subtasks = useQuery(
    api.tasks.getSubtasks,
    isAuthenticated ? { parentTaskId } : "skip",
  )
  const reorderSubtasks = useMutation(api.tasks.reorderSubtasks)
  const archiveTask = useMutation(api.tasks.archive)
  const removeTask = useMutation(api.tasks.remove)
  const [deleteTargetId, setDeleteTargetId] = useState<Id<"tasks"> | null>(null)

  const handleDragEnd = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (event: any) => {
      if (!subtasks) return

      // Map subtasks to items with `id` field for dnd-kit's move helper
      const items = subtasks.map((s) => ({ ...s, id: s._id }))
      const reordered = move(items, event)
      const orderedIds = (reordered as typeof items).map((s) => s._id)

      try {
        await reorderSubtasks({
          parentTaskId,
          orderedIds,
        })
      } catch (err) {
        toastError(err, "Failed to reorder")
      }
    },
    [subtasks, parentTaskId, reorderSubtasks],
  )

  async function handleArchive(taskId: string) {
    try {
      await archiveTask({ id: taskId as Id<"tasks"> })
    } catch (err) {
      toastError(err, "Failed to archive subtask")
    }
  }

  async function handleDelete() {
    if (!deleteTargetId) return
    try {
      await removeTask({ id: deleteTargetId })
      setDeleteTargetId(null)
      toast.success("Subtask deleted")
    } catch (err) {
      toastError(err, "Failed to delete subtask")
    }
  }

  if (!subtasks) return null

  const progress = computeSubtaskProgress(subtasks)
  const hasSubtasks = subtasks.length > 0

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold">Subtasks</span>
          {hasSubtasks && (
            <>
              <span className="text-xs text-muted-foreground">{progress.done}/{progress.total} done</span>
              <div className="h-1 w-10 overflow-hidden rounded-full bg-border/60">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Subtask table */}
      {hasSubtasks && (
        <div className="overflow-hidden rounded-lg border border-border/40">
          {/* Column headers */}
          <div className={`grid ${SUBTASK_GRID_COLS} items-center gap-x-3 border-b border-border/40 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground [&>*]:min-w-0 [&>*]:overflow-hidden`}>
            <div />
            <div>Task</div>
            <div>Status</div>
            <div>Category</div>
            <div>Assignee</div>
            <div>Due</div>
            <div>Time</div>
            <div />
          </div>

          {/* Sortable rows */}
          <DragDropProvider onDragEnd={handleDragEnd}>
            {subtasks.map((subtask, index) => (
              <SubtaskRow
                key={subtask._id}
                subtask={subtask}
                index={index}
                isAdmin={isAdmin}
                onOpenDetail={onOpenDetail}
                onArchive={handleArchive}
                onDelete={(taskId) => setDeleteTargetId(taskId as Id<"tasks">)}
              />
            ))}
          </DragDropProvider>
        </div>
      )}

      {/* Inline create */}
      <SubtaskInlineCreate
        parentTaskId={parentTaskId}
        parentProjectId={parentProjectId}
        parentBillable={parentBillable}
        parentCategoryId={parentCategoryId}
        parentAssigneeIds={parentAssigneeIds}
      />

      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
        title="Delete subtask"
        description="This will permanently delete this subtask. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

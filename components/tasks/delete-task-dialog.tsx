"use client"

import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatDuration } from "@/lib/duration"
import { toastArchiveSuccess, toastError } from "@/lib/toast-helpers"

type DeleteTaskDialogProps = {
  taskId: Id<"tasks"> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Copy variant — "subtask" adjusts the title and descriptions. */
  entityLabel?: "task" | "subtask"
  /** Called after a successful delete (e.g. close the detail view). */
  onDeleted?: () => void
  /** Called after a successful archive from within the dialog. */
  onArchived?: () => void
}

/**
 * Delete confirmation that inspects what the delete would destroy and offers
 * the resolution in place:
 * - no logged time → plain destructive confirm
 * - unlocked logged time → "Archive instead" (recommended) or explicit
 *   "Delete task + time"
 * - invoiced/settled time → delete impossible; one-click "Archive task"
 */
export function DeleteTaskDialog({
  taskId,
  open,
  onOpenChange,
  entityLabel = "task",
  onDeleted,
  onArchived,
}: DeleteTaskDialogProps) {
  const impact = useQuery(
    api.tasks.deleteImpact,
    open && taskId ? { id: taskId } : "skip",
  )
  const removeTask = useMutation(api.tasks.remove)
  const archiveTask = useMutation(api.tasks.archive)

  async function handleDelete() {
    if (!taskId) return
    try {
      await removeTask({
        id: taskId,
        deleteEntries: impact && impact.entryCount > 0 ? true : undefined,
      })
      onOpenChange(false)
      toast.success(entityLabel === "subtask" ? "Subtask deleted" : "Task deleted")
      onDeleted?.()
    } catch (err) {
      toastError(err, "Failed to delete")
    }
  }

  async function handleArchive() {
    if (!taskId) return
    try {
      const result = await archiveTask({ id: taskId })
      onOpenChange(false)
      toastArchiveSuccess(result, entityLabel === "subtask" ? "Subtask archived" : "Task archived")
      onArchived?.()
    } catch (err) {
      toastError(err, "Failed to archive")
    }
  }

  const loading = open && taskId !== null && impact === undefined
  const hasLocked = !!impact && impact.lockedCount > 0
  const hasEntries = !!impact && impact.entryCount > 0
  const hasTimers = !!impact && impact.runningTimerCount > 0

  const timerWarning =
    impact && hasTimers
      ? ` ${impact.runningTimerCount === 1 ? "A running timer" : `${impact.runningTimerCount} running timers`} (${formatDuration(Math.max(1, impact.runningTimerMinutes))}) on this ${entityLabel} will be discarded.`
      : ""

  const title = hasLocked
    ? `This ${entityLabel} can't be deleted`
    : `Delete ${entityLabel}`

  const description = loading
    ? "Checking logged time…"
    : hasLocked
      ? `It has ${formatDuration(impact.lockedMinutes)} of invoiced or settled time, which is part of your billing records. Archive it instead — everything stays intact and it disappears from active views.`
      : hasEntries
        ? `It has ${formatDuration(impact.totalMinutes)} of logged time (${impact.entryCount} ${impact.entryCount === 1 ? "entry" : "entries"}). Deleting the ${entityLabel} permanently deletes that time too. Archiving keeps it.${timerWarning}`
        : (entityLabel === "subtask"
            ? "This will permanently delete this subtask. This cannot be undone."
            : "Permanently delete this task and all subtasks? This cannot be undone.") + timerWarning

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={hasEntries && !hasLocked ? "sm:flex-col-reverse" : undefined}>
          <AlertDialogCancel className={hasEntries && !hasLocked ? "w-full" : undefined}>
            Cancel
          </AlertDialogCancel>
          {hasLocked ? (
            <AlertDialogAction onClick={handleArchive}>
              Archive {entityLabel}
            </AlertDialogAction>
          ) : hasEntries ? (
            <>
              <AlertDialogAction
                onClick={handleDelete}
                variant="destructive"
                className="w-full"
              >
                Delete {entityLabel} + logged time
              </AlertDialogAction>
              <AlertDialogAction onClick={handleArchive} className="w-full">
                Archive instead
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction
              onClick={handleDelete}
              variant="destructive"
              disabled={loading}
            >
              Delete
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

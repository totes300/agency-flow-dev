"use client"

import { useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import {
  ArchiveIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CopyIcon,
  LinkIcon,
  MoreVerticalIcon,
  Trash2Icon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { taskPagePath } from "@/lib/task-detail"
import { toastArchiveSuccess, toastError } from "@/lib/toast-helpers"

export type TaskDetailMode = "drawer" | "page"

/**
 * The caller's task detail mode (`users.taskDetailMode`, §4.4): unset =
 * drawer. Phones always use the drawer (it is full width there).
 */
export function useTaskDetailMode(): {
  mode: TaskDetailMode
  /** The user's setting has loaded (before that, `mode` is the default). */
  ready: boolean
  setMode: (mode: TaskDetailMode) => Promise<void>
} {
  const { isAuthenticated } = useConvexAuth()
  const isMobile = useIsMobile()
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const update = useMutation(api.users.updateTaskDetailMode)
  const mode: TaskDetailMode = !isMobile && user?.taskDetailMode === "page" ? "page" : "drawer"
  return {
    mode,
    ready: user !== undefined,
    setMode: async (next) => {
      try {
        await update({ mode: next })
        toast.success(next === "page" ? "Tasks now open as a full page" : "Tasks now open in the drawer")
      } catch (err) {
        toastError(err, "Failed to change the setting")
      }
    },
  }
}

/** "3 / 12" + previous/next (K / J) through the list the task was opened from. */
export function TaskStepper({
  index,
  total,
  onStep,
  label,
}: {
  index: number | null
  total: number
  onStep: (direction: "next" | "prev") => void
  /** Replaces the "3 / 12" position (e.g. "Task 2 of 3" for a split plan). */
  label?: string
}) {
  if (index === null || total === 0) return null
  return (
    <div className="flex items-center gap-0.5">
      <span className="mr-1 text-xs text-muted-foreground tabular-nums">
        {label ?? `${index + 1} / ${total}`}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onStep("prev")}
        disabled={index === 0}
        aria-label="Previous task (K)"
        title="Previous (K)"
      >
        <ChevronUpIcon className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onStep("next")}
        disabled={index >= total - 1}
        aria-label="Next task (J)"
        title="Next (J)"
      >
        <ChevronDownIcon className="size-4" />
      </Button>
    </div>
  )
}

/**
 * The detail's "…" menu, shared by the drawer and the full page: copy link
 * (the full-page URL), duplicate, archive, delete (admins), and where tasks
 * open (the per-user drawer/page setting).
 */
export function TaskActionsMenu({
  taskId,
  identifier,
  isAdmin,
  canDelete,
  onGone,
}: {
  taskId: Id<"tasks">
  identifier: string | null
  isAdmin: boolean
  canDelete: boolean
  /** The task was archived or deleted: leave the detail. */
  onGone: () => void
}) {
  const duplicateTask = useMutation(api.tasks.duplicate)
  const archiveTask = useMutation(api.tasks.archive)
  const { mode, setMode } = useTaskDetailMode()
  const isMobile = useIsMobile()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function handleCopyLink() {
    const path = identifier ? taskPagePath(identifier) : `/tasks?detail=${taskId}`
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`)
      toast.success("Link copied")
    } catch {
      toastError(new Error("Clipboard access denied"), "Failed to copy link")
    }
  }

  async function handleDuplicate() {
    try {
      await duplicateTask({ id: taskId })
      toast.success("Task duplicated")
    } catch (err) {
      toastError(err, "Failed to duplicate")
    }
  }

  async function handleArchive() {
    try {
      const result = await archiveTask({ id: taskId })
      onGone()
      toastArchiveSuccess(result, "Task archived")
    } catch (err) {
      toastError(err, "Failed to archive")
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Task actions">
            <MoreVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          <DropdownMenuItem onClick={handleCopyLink}>
            <LinkIcon className="size-4" />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate}>
            <CopyIcon className="size-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleArchive}>
            <ArchiveIcon className="size-4" />
            Archive
          </DropdownMenuItem>
          {isAdmin && canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2Icon className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
          {isMobile ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Open tasks in</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={mode} onValueChange={(v) => void setMode(v as TaskDetailMode)}>
                <DropdownMenuRadioItem value="drawer">Drawer</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="page">Full page</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteTaskDialog taskId={taskId} open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm} onDeleted={onGone} />
    </>
  )
}

"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  XIcon,
  CopyIcon,
  ArchiveIcon,
  Trash2Icon,
  LinkIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

type TaskHeaderData = {
  _id: Id<"tasks">
  title: string
  projectName?: string
  clientName?: string
  createdAt: number
  projectId?: Id<"projects">
  billable: boolean
  statusType: string
  totalMinutes?: number
} | null

export function TaskDetailHeader({
  task,
  isAdmin,
  onClose,
  onNavigate,
  hasNext,
  hasPrev,
}: {
  task: TaskHeaderData
  isAdmin: boolean
  onClose: () => void
  onNavigate: (direction: "next" | "prev") => void
  hasNext: boolean
  hasPrev: boolean
}) {
  const duplicateTask = useMutation(api.tasks.duplicate)
  const archiveTask = useMutation(api.tasks.archive)
  const removeTask = useMutation(api.tasks.remove)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function handleCopyLink() {
    if (!task) return
    const url = `${window.location.origin}${window.location.pathname}?detail=${task._id}`
    await navigator.clipboard.writeText(url)
    toast.success("Link copied")
  }

  async function handleDuplicate() {
    if (!task) return
    try {
      await duplicateTask({ id: task._id })
      toast.success("Task duplicated")
    } catch (err) {
      toastError(err, "Failed to duplicate")
    }
  }

  async function handleArchive() {
    if (!task) return
    try {
      await archiveTask({ id: task._id })
      onClose()
      toast.success("Task archived")
    } catch (err) {
      toastError(err, "Failed to archive")
    }
  }

  const createdLabel = task
    ? `Created ${new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : ""

  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-4 h-11">
      {/* Left: nav + breadcrumb */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onNavigate("prev")}
            disabled={!hasPrev}
            aria-label="Previous task (K)"
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onNavigate("next")}
            disabled={!hasNext}
            aria-label="Next task (J)"
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>

        <div className="h-4 w-px bg-border/40" />

        {/* Breadcrumb */}
        {task && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {task.clientName && (
              <>
                <span>{task.clientName}</span>
                <span className="text-muted-foreground/40">/</span>
              </>
            )}
            {task.projectName && (
              <span className="font-medium text-foreground/70">{task.projectName}</span>
            )}
          </div>
        )}
      </div>

      {/* Right: timer + meta + actions */}
      <div className="flex items-center gap-1">
        {/* Timer — same InlineTimeCell as task rows, wrapped in group/row so play button shows */}
        {task && (
          <div className="group/row">
            <InlineTimeCell
              taskId={task._id}
              totalMinutes={task.totalMinutes ?? 0}
              isDone={task.statusType === "done"}
              isBillable={task.billable}
            />
          </div>
        )}

        <div className="h-4 w-px bg-border/40 mx-1" />

        <span className="text-[11px] text-muted-foreground mr-1">{createdLabel}</span>

        {/* More menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Task actions">
              <MoreVerticalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
            {isAdmin && task && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2Icon className="size-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Close */}
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close (Esc)">
          <XIcon className="size-4" />
        </Button>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete task"
        description="Permanently delete this task and all subtasks? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!task) return
          try {
            await removeTask({ id: task._id })
            onClose()
            toast.success("Task deleted")
          } catch (err) {
            toastError(err, "Failed to delete")
          }
        }}
      />
    </div>
  )
}

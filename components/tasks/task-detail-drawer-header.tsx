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
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  XIcon,
  CopyIcon,
  ArchiveIcon,
  Trash2Icon,
  LinkIcon,
  Maximize2Icon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

type TaskHeaderData = {
  _id: Id<"tasks">
  title: string
  projectName?: string
  clientName?: string
  parentTaskId?: Id<"tasks">
  parentTaskTitle?: string
  createdAt: number
  updatedAt?: number
  projectId?: Id<"projects">
  billable: boolean
  statusType: string
  totalMinutes?: number
} | null

export function TaskDetailDrawerHeader({
  task,
  isAdmin,
  onClose,
  onNavigate,
  onOpenDetail,
  onToggleProperties,
  hasNext,
  hasPrev,
  showProperties,
}: {
  task: TaskHeaderData
  isAdmin: boolean
  onClose: () => void
  onNavigate: (direction: "next" | "prev") => void
  onOpenDetail?: (taskId: string) => void
  onToggleProperties?: () => void
  hasNext: boolean
  hasPrev: boolean
  showProperties?: boolean
}) {
  const updateView = useMutation(api.users.updateTaskDetailView)
  const duplicateTask = useMutation(api.tasks.duplicate)
  const archiveTask = useMutation(api.tasks.archive)
  const removeTask = useMutation(api.tasks.remove)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  async function handleCopyLink() {
    if (!task) return
    const url = `${window.location.origin}${window.location.pathname}?detail=${task._id}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Link copied")
    } catch {
      toastError(new Error("Clipboard access denied"), "Failed to copy link")
    }
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

  async function handleSwitchToModal() {
    try {
      await updateView({ view: "modal" })
    } catch (err) {
      toastError(err, "Failed to switch view")
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 h-11">
      {/* Left: nav + breadcrumb */}
      <div className="flex items-center gap-2 min-w-0">
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

        {task && (
          <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            {task.parentTaskId && task.parentTaskTitle && (
              <>
                <button
                  type="button"
                  onClick={() => onOpenDetail?.(task.parentTaskId!)}
                  className="max-w-[180px] truncate text-primary/80 hover:text-primary hover:underline"
                >
                  Subtask of: {task.parentTaskTitle}
                </button>
                <span className="text-muted-foreground/40">/</span>
              </>
            )}
            {task.clientName && (
              <>
                <span className="truncate">{task.clientName}</span>
                <span className="text-muted-foreground/40">/</span>
              </>
            )}
            {task.projectName && (
              <span className="truncate font-medium text-foreground/70">{task.projectName}</span>
            )}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Timer — compact, always visible in top bar */}
      {task && (
        <div className="group/row shrink-0">
          <InlineTimeCell
            taskId={task._id}
            totalMinutes={task.totalMinutes ?? 0}
            isDone={task.statusType === "done"}
            isBillable={task.billable}
            variant="header"
          />
        </div>
      )}

      <div className="h-4 w-px bg-border/40" />

      {/* Right: properties toggle + view toggle + menu + close */}
      <div className="flex items-center gap-0.5">
        {/* Properties toggle */}
        {onToggleProperties && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onToggleProperties}
            aria-label={showProperties ? "Hide properties" : "Show properties"}
          >
            {showProperties ? (
              <PanelRightCloseIcon className="size-4" />
            ) : (
              <PanelRightOpenIcon className="size-4" />
            )}
          </Button>
        )}

        {/* View toggle: switch to modal */}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleSwitchToModal}
          aria-label="Switch to modal view"
        >
          <Maximize2Icon className="size-4" />
        </Button>

        <div className="h-4 w-px bg-border/40 mx-0.5" />

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

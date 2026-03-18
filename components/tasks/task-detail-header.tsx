"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"
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
  PlayIcon,
  SquareIcon,
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
  const { timerState, startTimer, stopTimer, isRunningOn } = useTimerActions()
  const duplicateTask = useMutation(api.tasks.duplicate)
  const archiveTask = useMutation(api.tasks.archive)

  const isTimerOnThis = task ? isRunningOn(task._id) : false

  async function handleTimerToggle() {
    if (!task) return
    if (isTimerOnThis) {
      try {
        await stopTimer()
      } catch (err) {
        toastError(err, "Failed to stop timer")
      }
    } else {
      if (!task.projectId) {
        toast.error("Assign a project to start tracking time")
        return
      }
      try {
        await startTimer(task._id)
      } catch (err) {
        toastError(err, "Failed to start timer")
      }
    }
  }

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
        {/* Timer button */}
        {task && (
          <Button
            variant={isTimerOnThis ? "destructive" : "ghost"}
            size="xs"
            onClick={handleTimerToggle}
            disabled={!task.projectId && !isTimerOnThis}
            className="gap-1.5"
          >
            {isTimerOnThis ? (
              <>
                <SquareIcon className="size-3 fill-current" />
                <span className="font-mono text-xs">Stop</span>
              </>
            ) : (
              <>
                <PlayIcon className="size-3 fill-current" />
                <span className="text-xs">Timer</span>
              </>
            )}
          </Button>
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
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive">
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
    </div>
  )
}

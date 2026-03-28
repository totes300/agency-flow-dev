"use client"

import { useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import { formatDuration, formatTimerDisplay, formatMinutesDisplay } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TimeLogPopover } from "@/components/tasks/time-log-popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { PlayIcon, SquareIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

/** Convert minutes to HH:MM display */
function minutesToDisplay(minutes: number): string {
  return formatMinutesDisplay(minutes)
}

export function InlineTimeCell({
  taskId,
  totalMinutes,
  isDone,
  isBillable = true,
  variant = "inline",
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isDone: boolean
  isBillable?: boolean
  variant?: "inline" | "sidebar"
}) {
  const { timerState, isRunningOn } = useTimerActions()
  const isRunning = isRunningOn(taskId)

  if (isDone) {
    return (
      <div className={cn("flex items-center gap-[5px] opacity-35", variant === "sidebar" && "gap-2 opacity-60")}>
        {totalMinutes > 0 && (
          <span className={cn("text-xs text-muted-foreground", variant === "sidebar" && "text-sm font-medium text-foreground/70")}>
            {minutesToDisplay(totalMinutes)}
          </span>
        )}
      </div>
    )
  }

  if (isRunning) {
    return <RunningTimeCell variant={variant} />
  }

  return (
    <IdleTimeCell
      taskId={taskId}
      totalMinutes={totalMinutes}
      isBillable={isBillable}
      isTimerOnAnotherTask={timerState !== null}
      variant={variant}
    />
  )
}

/** Only this component subscribes to the tick context (re-renders every second) */
function RunningTimeCell({ variant = "inline" }: { variant?: "inline" | "sidebar" }) {
  const { stopTimer } = useTimerActions()
  const { formattedTime } = useTimerTick()

  async function handleStopClick(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await stopTimer()
    } catch (err) {
      toastError(err, "Failed to stop timer")
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-[5px]",
        variant === "sidebar" && "gap-2",
      )}
    >
      {variant === "sidebar" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleStopClick}
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-red-500 hover:bg-accent"
              aria-label="Stop timer"
            >
              <span className="block size-2.5 rounded-[2px] bg-red-500" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Stop timer</TooltipContent>
        </Tooltip>
      ) : (
        <button
          onClick={handleStopClick}
          className="flex size-3.5 shrink-0 items-center justify-center"
          aria-label="Stop timer"
        >
          <span className="block size-[10px] rounded-[2px] bg-red-500" />
        </button>
      )}
      <span
        className={cn(
          "text-xs text-red-500",
          variant === "sidebar" && "px-0 text-[13px] font-medium text-red-500",
        )}
      >
        {formattedTime}
      </span>
    </div>
  )
}

/** Idle cell — uses actions-only, never re-renders from tick */
function IdleTimeCell({
  taskId,
  totalMinutes,
  isBillable,
  isTimerOnAnotherTask,
  variant = "inline",
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isBillable: boolean
  isTimerOnAnotherTask: boolean
  variant?: "inline" | "sidebar"
}) {
  const { startTimer, stopTimer, setPendingStopResult } = useTimerActions()
  const hasTime = totalMinutes > 0

  async function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()

    if (isTimerOnAnotherTask) {
      try {
        const result = await stopTimer()
        if (result && result.roundedMinutes > 0) {
          // Store result so floating widget can show commit form
          setPendingStopResult(result)
          toast.info(`Timer stopped on "${result.taskName}" — ${formatDuration(result.roundedMinutes)}`, {
            description: "Review and save in the floating widget",
          })
        }
      } catch (err) {
        toastError(err, "Failed to stop previous timer")
        return
      }
    }

    try {
      await startTimer(taskId)
    } catch (err) {
      toastError(err, "Failed to start timer")
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-[5px]",
        variant === "sidebar" && "gap-2",
      )}
    >
      {variant === "sidebar" ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handlePlayClick}
              className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-emerald-600 hover:bg-accent"
              aria-label="Start timer"
            >
              <PlayIcon className="size-3.5 fill-current" strokeWidth={2.2} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={4}>Start timer</TooltipContent>
        </Tooltip>
      ) : (
        <button
          onClick={handlePlayClick}
          className="flex size-4 shrink-0 items-center justify-center opacity-40 transition-opacity duration-150 hover:opacity-70"
          aria-label="Start timer"
        >
          <PlayIcon className="size-3.5 fill-current" strokeWidth={2.2} />
        </button>
      )}
      <TimeLogPopover taskId={taskId} isBillable={isBillable}>
        {variant === "sidebar" ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "h-7 cursor-pointer rounded-md px-0 text-[13px] font-medium text-foreground transition-colors duration-150 hover:text-foreground/80",
                  hasTime
                    ? "text-muted-foreground hover:text-foreground"
                    : "font-sans text-muted-foreground/50 group-hover/row:text-muted-foreground",
                  !hasTime && "text-foreground/55",
                )}
              >
                {hasTime ? minutesToDisplay(totalMinutes) : "Add time"}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>Add time</TooltipContent>
          </Tooltip>
        ) : (
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "cursor-pointer text-sm transition-colors duration-150",
              hasTime
                ? "text-muted-foreground hover:text-foreground"
                : "font-sans text-muted-foreground/50 group-hover/row:text-muted-foreground",
            )}
          >
            {hasTime ? minutesToDisplay(totalMinutes) : "Add time"}
          </button>
        )}
      </TimeLogPopover>
    </div>
  )
}

"use client"

import { useTimer } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TimeLogPopover } from "@/components/tasks/time-log-popover"
import type { Id } from "@/convex/_generated/dataModel"

export function InlineTimeCell({
  taskId,
  totalMinutes,
  isDone,
  isBillable = true,
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isDone: boolean
  isBillable?: boolean
}) {
  const { timerState, formattedTime, startTimer, stopTimer, isRunningOn } = useTimer()
  const isRunning = isRunningOn(taskId)
  const isTimerOnAnotherTask = timerState !== null && !isRunning
  const hasTime = totalMinutes > 0

  async function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isDone) return

    if (isTimerOnAnotherTask) {
      try {
        const result = await stopTimer()
        if (result && result.roundedMinutes > 0 && !result.isStale) {
          toast.info(`Timer stopped on "${result.taskName}" — ${formatDuration(result.roundedMinutes)}`, {
            description: "Open the widget to commit your time",
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

  async function handleStopClick(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      await stopTimer()
    } catch (err) {
      toastError(err, "Failed to stop timer")
    }
  }

  // Done state — just faded text, no icon
  if (isDone) {
    return (
      <div className="flex items-center gap-[5px] opacity-35">
        {hasTime && (
          <span className="font-mono text-xs text-stone-500">
            {formatDuration(totalMinutes)}
          </span>
        )}
      </div>
    )
  }

  // Running state
  if (isRunning) {
    return (
      <div
        className="flex cursor-pointer items-center gap-[5px]"
        onClick={handleStopClick}
      >
        <button
          onClick={handleStopClick}
          className="flex size-3.5 shrink-0 items-center justify-center"
          aria-label="Stop timer"
        >
          <span className="block size-[10px] rounded-[2px] bg-red-500" />
        </button>
        <span className="font-mono text-xs text-red-500">
          {formattedTime.replace(/^00:/, "")}
        </span>
      </div>
    )
  }

  // Idle state — text wrapped in popover trigger
  return (
    <div className="flex items-center gap-[5px]">
      <button
        onClick={handlePlayClick}
        className="flex size-3.5 shrink-0 items-center justify-center opacity-40 transition-opacity duration-150 hover:opacity-70"
        aria-label="Start timer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="fill-stone-500">
          <polygon points="1,0 10,5 1,10" />
        </svg>
      </button>
      <TimeLogPopover taskId={taskId} isBillable={isBillable}>
        <span
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "cursor-pointer text-xs transition-colors duration-150",
            hasTime
              ? "font-mono text-stone-500 hover:text-stone-600"
              : "font-sans text-stone-400",
          )}
        >
          {hasTime ? formatDuration(totalMinutes) : "Add time"}
        </span>
      </TimeLogPopover>
    </div>
  )
}

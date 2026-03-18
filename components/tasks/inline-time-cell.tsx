"use client"

import { useTimer } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

export function InlineTimeCell({
  taskId,
  totalMinutes,
  isDone,
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isDone: boolean
}) {
  const { timerState, formattedTime, startTimer, stopTimer, isRunningOn } = useTimer()
  const isRunning = isRunningOn(taskId)
  const isTimerOnAnotherTask = timerState !== null && !isRunning
  const hasTime = totalMinutes > 0

  async function handlePlayClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isDone) return

    if (isTimerOnAnotherTask) {
      // Client-side auto-stop: stop previous, then start new
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

  function handleTextClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (isDone) return
    if (isRunning) {
      // When running, clicking anywhere stops
      handleStopClick(e)
      return
    }
    // TODO(7.4): open log popover
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
        {/* Stop icon — filled red rounded rect, 10px */}
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

  // Idle state (with or without logged time)
  return (
    <div className="flex items-center gap-[5px]">
      {/* Play icon — filled triangle, 10px, 40% opacity */}
      <button
        onClick={handlePlayClick}
        className="flex size-3.5 shrink-0 items-center justify-center opacity-40 transition-opacity duration-150 hover:opacity-70"
        aria-label="Start timer"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="fill-stone-500">
          <polygon points="1,0 10,5 1,10" />
        </svg>
      </button>
      <span
        onClick={handleTextClick}
        className={cn(
          "cursor-pointer text-xs transition-colors duration-150",
          hasTime
            ? "font-mono text-stone-500 hover:text-stone-600"
            : "font-sans text-stone-400",
        )}
      >
        {hasTime ? formatDuration(totalMinutes) : "Add time"}
      </span>
    </div>
  )
}

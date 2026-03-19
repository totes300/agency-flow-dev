"use client"

import { useTimerActions, useTimerTick } from "@/lib/hooks/use-timer"
import { formatDuration, formatTimerDisplay, formatMinutesDisplay } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TimeLogPopover } from "@/components/tasks/time-log-popover"
import type { Id } from "@/convex/_generated/dataModel"

const PlayIcon = (
  <svg width="10" height="10" viewBox="0 0 10 10" className="fill-muted-foreground">
    <polygon points="1,0 10,5 1,10" />
  </svg>
)

/** Convert minutes to HH:MM display */
function minutesToDisplay(minutes: number): string {
  return formatMinutesDisplay(minutes)
}

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
  const { timerState, isRunningOn } = useTimerActions()
  const isRunning = isRunningOn(taskId)

  if (isDone) {
    return (
      <div className="flex items-center gap-[5px] opacity-35">
        {totalMinutes > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            {minutesToDisplay(totalMinutes)}
          </span>
        )}
      </div>
    )
  }

  if (isRunning) {
    return <RunningTimeCell />
  }

  return (
    <IdleTimeCell
      taskId={taskId}
      totalMinutes={totalMinutes}
      isBillable={isBillable}
      isTimerOnAnotherTask={timerState !== null}
    />
  )
}

/** Only this component subscribes to the tick context (re-renders every second) */
function RunningTimeCell() {
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
    <div className="flex items-center gap-[5px]">
      <button
        onClick={handleStopClick}
        className="flex size-3.5 shrink-0 items-center justify-center"
        aria-label="Stop timer"
      >
        <span className="block size-[10px] rounded-[2px] bg-red-500" />
      </button>
      <span className="font-mono text-xs text-red-500">
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
}: {
  taskId: Id<"tasks">
  totalMinutes: number
  isBillable: boolean
  isTimerOnAnotherTask: boolean
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
    <div className="flex items-center gap-[5px]">
      <button
        onClick={handlePlayClick}
        className="flex size-3.5 shrink-0 items-center justify-center opacity-40 transition-opacity duration-150 hover:opacity-70"
        aria-label="Start timer"
      >
        {PlayIcon}
      </button>
      <TimeLogPopover taskId={taskId} isBillable={isBillable}>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "cursor-pointer text-xs transition-colors duration-150",
            hasTime
              ? "font-mono text-muted-foreground hover:text-foreground"
              : "font-sans text-muted-foreground/50 group-hover/row:text-muted-foreground",
          )}
        >
          {hasTime ? minutesToDisplay(totalMinutes) : "Add time"}
        </button>
      </TimeLogPopover>
    </div>
  )
}

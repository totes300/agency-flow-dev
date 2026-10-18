"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import type { Id } from "@/convex/_generated/dataModel"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"
import { toastError } from "@/lib/toast-helpers"

/**
 * Y — start/stop the timer on a task, with the same rules as the row's time
 * cell: a running timer elsewhere is stopped (and its entry reported) first;
 * closed tasks don't start a timer.
 */
export function useToggleTaskTimer() {
  const { timerState, isRunningOn, startTimer, stopTimer, setPendingStopResult } = useTimerActions()

  return useCallback(
    async (taskId: Id<"tasks">, isClosed: boolean) => {
      const running = isRunningOn(taskId)
      if (!running && isClosed) return
      try {
        if (timerState !== null) {
          const stopped = await stopTimer()
          if (stopped && !stopped.discarded && stopped.entryId) {
            setPendingStopResult(stopped)
            toast.info(`${formatDuration(stopped.roundedMinutes)} saved on "${stopped.taskName}"`, {
              description: "Adjust it in the floating widget if needed",
            })
          } else if (stopped?.discarded) {
            toast.info("Timer was under 30 seconds — nothing saved")
          }
        }
        if (!running) await startTimer(taskId)
      } catch (err) {
        toastError(err, running ? "Failed to stop timer" : "Failed to start timer")
      }
    },
    [isRunningOn, setPendingStopResult, startTimer, stopTimer, timerState],
  )
}

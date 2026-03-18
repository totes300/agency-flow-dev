"use client"

import { useState } from "react"
import { useTimer } from "@/lib/hooks/use-timer"
import { TimerDisplay } from "@/components/timer/timer-display"
import { TimerCommitForm } from "@/components/timer/timer-commit-form"
import { TimerTodaySection } from "@/components/timer/timer-today-section"
import { toastError } from "@/lib/toast-helpers"
import { PauseIcon, PlayIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StopResult } from "@/components/timer-provider"

export function FloatingTimerWidget() {
  const {
    timerState,
    formattedTime,
    stopTimer,
    pauseTimer,
    resumeTimer,
    discardTimer,
  } = useTimer()

  const [commitData, setCommitData] = useState<StopResult | null>(null)

  // Not visible when no timer and no pending commit
  if (!timerState && !commitData) return null

  // ─── Committing state ──────────────────────────────────────────────────────
  if (commitData) {
    return (
      <WidgetShell>
        <TimerCommitForm
          stopResult={commitData}
          onDone={() => setCommitData(null)}
        />
      </WidgetShell>
    )
  }

  // ─── Running or Paused ─────────────────────────────────────────────────────
  if (!timerState) return null

  const isRunning = timerState.status === "running"

  async function handleCommit() {
    try {
      const result = await stopTimer()
      if (result) {
        if (result.roundedMinutes <= 0) {
          // Under 30 seconds — nothing to commit
          return
        }
        setCommitData(result)
      }
    } catch (err) {
      toastError(err, "Failed to stop timer")
    }
  }

  async function handlePauseResume() {
    try {
      if (isRunning) {
        await pauseTimer()
      } else {
        await resumeTimer()
      }
    } catch (err) {
      toastError(err, isRunning ? "Failed to pause" : "Failed to resume")
    }
  }

  async function handleDiscard() {
    try {
      await discardTimer()
    } catch (err) {
      toastError(err, "Failed to discard timer")
    }
  }

  return (
    <WidgetShell>
      <div className="flex flex-col gap-3 p-5">
        {/* Timer + pause/resume pill */}
        <div className="flex items-center justify-between">
          <TimerDisplay time={formattedTime} status={isRunning ? "running" : "paused"} />
          <button
            onClick={handlePauseResume}
            className="flex items-center gap-1.5 rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
          >
            {isRunning ? (
              <>
                <PauseIcon className="size-3" fill="currentColor" strokeWidth={0} />
                Pause
              </>
            ) : (
              <>
                <PlayIcon className="size-3" fill="currentColor" strokeWidth={0} />
                Resume
              </>
            )}
          </button>
        </div>

        {/* Task context */}
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium text-stone-900">{timerState.taskName}</div>
          <div className="text-xs text-stone-400">
            {[timerState.clientName, timerState.projectName].filter(Boolean).join(" / ")}
          </div>
        </div>

        {/* Buttons */}
        <div className="mt-1 flex flex-col gap-1.5">
          <button
            onClick={handleCommit}
            className="flex h-9 items-center justify-center rounded-lg bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800"
          >
            Commit time
          </button>
          <button
            onClick={handleDiscard}
            className="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-50"
          >
            Discard
          </button>
        </div>
      </div>

      {/* Today section */}
      <TimerTodaySection />
    </WidgetShell>
  )
}

function WidgetShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 w-80 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
      )}
    >
      {children}
    </div>
  )
}

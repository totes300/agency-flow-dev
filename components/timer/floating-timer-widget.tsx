"use client"

import { useState } from "react"
import { useTimer } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"
import { TimerDisplay } from "@/components/timer/timer-display"
import { TimerCommitForm } from "@/components/timer/timer-commit-form"
import { TimerTodaySection } from "@/components/timer/timer-today-section"
import { Button } from "@/components/ui/button"
import { toastError } from "@/lib/toast-helpers"
import { toast } from "sonner"
import { PauseIcon, PlayIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { StopResult } from "@/components/timer-provider"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export function FloatingTimerWidget() {
  const {
    timerState,
    formattedTime,
    stopTimer,
    pauseTimer,
    resumeTimer,
    discardTimer,
    pendingStopResult,
    setPendingStopResult,
  } = useTimer()

  const [commitData, setCommitData] = useState<StopResult | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  // Show commit form for pending stop result (from task-switch)
  const activeCommitData = commitData ?? pendingStopResult

  if (!timerState && !activeCommitData) return null

  // Committing state
  if (activeCommitData) {
    return (
      <WidgetShell>
        <TimerCommitForm
          stopResult={activeCommitData}
          onDone={() => {
            setCommitData(null)
            setPendingStopResult(null)
          }}
        />
      </WidgetShell>
    )
  }

  if (!timerState) return null

  const isRunning = timerState.status === "running"

  async function handleCommit() {
    try {
      const result = await stopTimer()
      if (result) {
        if (result.roundedMinutes <= 0) {
          toast.info("Timer was under 30 seconds", {
            action: {
              label: "Save as 1m",
              onClick: () => setCommitData({ ...result, roundedMinutes: 1 }),
            },
          })
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

  async function handleDiscardConfirmed() {
    try {
      await discardTimer()
      setConfirmDiscard(false)
    } catch (err) {
      toastError(err, "Failed to discard timer")
    }
  }

  return (
    <>
      <WidgetShell>
        <div className="flex flex-col gap-3 p-5">
          {/* Timer + pause/resume pill */}
          <div className="flex items-center justify-between">
            <TimerDisplay time={formattedTime} status={isRunning ? "running" : "paused"} />
            <Button
              variant="secondary"
              size="sm"
              onClick={handlePauseResume}
              className="rounded-full"
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
            </Button>
          </div>

          {/* Task context */}
          <div className="flex flex-col gap-0.5">
            <div className="truncate text-sm font-medium text-foreground">{timerState.taskName}</div>
            <div className="text-xs text-muted-foreground">
              {[timerState.clientName, timerState.projectName].filter(Boolean).join(" / ")}
            </div>
          </div>

          {/* Buttons */}
          <div className="mt-1 flex flex-col gap-1.5">
            <Button size="lg" onClick={handleCommit} className="w-full">
              Stop timer
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => setConfirmDiscard(true)}
              className="w-full"
            >
              Discard
            </Button>
          </div>
        </div>

        <TimerTodaySection />
      </WidgetShell>

      {/* Discard confirmation */}
      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard timer?</AlertDialogTitle>
            <AlertDialogDescription>
              {formatDuration(Math.floor((timerState?.accumulatedMs ?? 0) / 60000) || 1)} of tracked time on &ldquo;{timerState?.taskName}&rdquo; will be permanently lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep timer</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDiscardConfirmed}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function WidgetShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "fixed bottom-20 right-6 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-background shadow-lg md:bottom-6",
        "animate-in slide-in-from-bottom-4 fade-in duration-300",
      )}
    >
      {children}
    </div>
  )
}

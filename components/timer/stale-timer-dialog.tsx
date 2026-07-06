"use client"

import { useState, useRef } from "react"
import { useTimer } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration } from "@/lib/duration"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TriangleAlertIcon, ClockIcon, AlignLeftIcon } from "lucide-react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"

const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000 // 8 hours
const MAX_TIMER_MS = 16 * 60 * 60 * 1000 // mirror of server cap (convex/lib/timer.ts)

export function StaleTimerDialog() {
  const { timerState, elapsedMs, stopTimer, discardTimer } = useTimer()
  const [dismissed, setDismissed] = useState(false)
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const lastTaskIdRef = useRef<string | null>(null)
  const wasOpenRef = useRef(false)

  // Reset dismissed flag when timer changes to a different task
  if (timerState?.taskId !== lastTaskIdRef.current) {
    lastTaskIdRef.current = timerState?.taskId ?? null
    if (dismissed) setDismissed(false)
  }

  // Derive open state during render — no effect needed
  const isStale = !!(timerState && elapsedMs >= STALE_THRESHOLD_MS)
  const open = isStale && !dismissed

  // Prefill the duration with the measured elapsed on open — an editable
  // anchor beats an empty field the user has to guess into (Harvest does
  // the same). Render-time sync, same idiom as the task-change reset above.
  if (open && !wasOpenRef.current) {
    wasOpenRef.current = true
    // Prefill the CAPPED measurement — the plain stop path would refuse to
    // record more than 16h, so the dialog's default must not exceed it either.
    setDurationStr(formatDuration(Math.floor(Math.min(elapsedMs, MAX_TIMER_MS) / 60000)))
  } else if (!open && wasOpenRef.current) {
    wasOpenRef.current = false
  }

  if (!open || !timerState) return null

  const elapsedMinutes = Math.floor(elapsedMs / 60000)

  async function handleSave(e?: React.MouseEvent) {
    e?.preventDefault() // Prevent AlertDialogAction from auto-closing
    if (saving) return // Guard against double-click
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    // Capture before async calls to avoid stale closure
    const taskName = timerState!.taskName
    setSaving(true)
    try {
      // Single atomic stop-with-override: the server stops the timer AND
      // writes the entry with the user-supplied duration in one mutation —
      // no window where the measured time exists only in this dialog.
      await stopTimer({ overrideMinutes: minutes, note: note.trim() || undefined })
      toast.success(`${formatDuration(minutes)} logged on "${taskName}"`)
      setDismissed(true)
    } catch (err) {
      toastError(err, "Failed to save time entry")
    } finally {
      setSaving(false)
    }
  }

  async function handleDiscard(e: React.MouseEvent) {
    e.preventDefault() // Prevent AlertDialogCancel from auto-closing
    try {
      await discardTimer()
      setDismissed(true)
    } catch (err) {
      toastError(err, "Failed to discard timer")
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) setDismissed(true) }}>
      <AlertDialogContent className="max-w-md p-0 gap-0">
        {/* Warning bar */}
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-5 py-3 rounded-t-xl">
          <TriangleAlertIcon className="size-4 shrink-0 text-red-600" strokeWidth={2} />
          <span className="text-sm font-medium text-red-600">
            Timer ran for {formatDuration(elapsedMinutes)} — forgotten?
          </span>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <AlertDialogHeader className="text-left gap-0.5">
            <AlertDialogTitle className="text-base">{timerState.taskName}</AlertDialogTitle>
            <AlertDialogDescription>
              {[timerState.clientName, timerState.projectName].filter(Boolean).join(" / ")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Duration input */}
          <div className="flex items-center gap-2.5 border-b border-border py-2.5">
            <ClockIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="text"
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
              placeholder="0h 00m"
              aria-label="Duration"
              autoFocus
            />
          </div>

          {/* Note input */}
          <div className="flex items-center gap-2.5 border-b border-border py-2.5">
            <AlignLeftIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
              placeholder="What did you work on?"
              aria-label="Note"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            />
          </div>

          {/* Buttons */}
          <AlertDialogFooter className="flex-col gap-1.5 sm:flex-col">
            <AlertDialogAction onClick={handleSave} disabled={saving}>
              Save time entry
            </AlertDialogAction>
            <AlertDialogCancel onClick={handleDiscard}>
              Discard timer
            </AlertDialogCancel>
          </AlertDialogFooter>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}

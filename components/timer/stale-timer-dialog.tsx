"use client"

import { useState, useEffect } from "react"
import { useTimer } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration } from "@/lib/duration"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { TriangleAlertIcon, ClockIcon, AlignLeftIcon } from "lucide-react"

const STALE_THRESHOLD_MS = 8 * 60 * 60 * 1000 // 8 hours

export function StaleTimerDialog() {
  const { timerState, elapsedMs, stopTimer, commitEntry, discardTimer } = useTimer()
  const [open, setOpen] = useState(false)
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  // Check on mount and when timer state changes
  useEffect(() => {
    if (timerState && elapsedMs >= STALE_THRESHOLD_MS) {
      setOpen(true)
    }
  }, [timerState, elapsedMs])

  if (!open || !timerState) return null

  const elapsedMinutes = Math.floor(elapsedMs / 60000)

  async function handleSave() {
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    setSaving(true)
    try {
      // Stop first to clear timer state
      await stopTimer()
      // Then commit with user-entered duration
      await commitEntry({
        taskId: timerState!.taskId,
        durationMinutes: minutes,
        note: note.trim() || undefined,
        isBillable: timerState!.isBillable,
      })
      toast.success(`${formatDuration(minutes)} logged on "${timerState!.taskName}"`)
      setOpen(false)
    } catch (err) {
      toastError(err, "Failed to save time entry")
    } finally {
      setSaving(false)
    }
  }

  async function handleDiscard() {
    try {
      await discardTimer()
      setOpen(false)
    } catch (err) {
      toastError(err, "Failed to discard timer")
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-[420px] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_16px_48px_rgba(0,0,0,0.12)]">
        {/* Warning bar */}
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-5 py-3">
          <TriangleAlertIcon className="size-4 shrink-0 text-red-600" strokeWidth={2} />
          <span className="text-sm font-medium text-red-600">
            Timer ran for {formatDuration(elapsedMinutes)} — forgotten?
          </span>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Task context */}
          <div className="flex flex-col gap-0.5">
            <div className="text-[15px] font-semibold text-stone-900">{timerState.taskName}</div>
            <div className="text-sm text-stone-400">
              {[timerState.clientName, timerState.projectName].filter(Boolean).join(" / ")}
            </div>
          </div>

          {/* Duration input (EMPTY — user must enter) */}
          <div className="flex items-center gap-2.5 border-b border-stone-200 py-2.5">
            <ClockIcon className="size-4 shrink-0 text-stone-400" strokeWidth={1.5} />
            <input
              type="text"
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              className="flex-1 bg-transparent font-mono text-sm text-stone-900 outline-none placeholder:text-stone-300"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
              placeholder="0h 00m"
              autoFocus
            />
          </div>

          {/* Note input */}
          <div className="flex items-center gap-2.5 border-b border-stone-200 py-2.5">
            <AlignLeftIcon className="size-4 shrink-0 text-stone-400" strokeWidth={1.5} />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
              placeholder="What did you work on?"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            />
          </div>

          {/* Buttons */}
          <div className="mt-1 flex flex-col gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex h-10 items-center justify-center rounded-lg bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
            >
              Save time entry
            </button>
            <button
              onClick={handleDiscard}
              className="flex h-10 items-center justify-center rounded-lg border border-stone-200 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-50"
            >
              Discard timer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

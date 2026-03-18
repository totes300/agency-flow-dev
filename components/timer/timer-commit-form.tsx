"use client"

import { useState } from "react"
import { useTimer } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration } from "@/lib/duration"
import { TimerDisplay } from "@/components/timer/timer-display"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { ClockIcon, AlignLeftIcon } from "lucide-react"
import type { StopResult } from "@/components/timer-provider"

export function TimerCommitForm({
  stopResult,
  onDone,
}: {
  stopResult: StopResult
  onDone: () => void
}) {
  const { commitEntry } = useTimer()
  const [durationStr, setDurationStr] = useState(formatDuration(stopResult.roundedMinutes))
  const [note, setNote] = useState("")
  const [isBillable, setIsBillable] = useState(stopResult.isBillable)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    setSaving(true)
    try {
      await commitEntry({
        taskId: stopResult.taskId,
        durationMinutes: minutes,
        note: note.trim() || undefined,
        isBillable,
      })
      toast.success(`${formatDuration(minutes)} logged on "${stopResult.taskName}"`)
      onDone()
    } catch (err) {
      toastError(err, "Failed to save time entry")
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    onDone()
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <TimerDisplay
        time={formatTimerFromMs(stopResult.elapsedMs)}
        status="committing"
      />
      {/* Task context */}
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium text-stone-900">{stopResult.taskName}</div>
        <div className="text-xs text-stone-400">
          {[stopResult.clientName, stopResult.projectName].filter(Boolean).join(" / ")}
        </div>
      </div>
      {/* Duration input row */}
      <div className="flex items-center gap-2.5 border-b border-stone-100 py-2">
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
        <span className="text-[11px] text-stone-400">rounded</span>
      </div>
      {/* Note input row */}
      <div className="flex items-center gap-2.5 border-b border-stone-100 py-2">
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
      {/* Billable toggle */}
      {stopResult.isBillable && (
        <div className="flex items-center gap-2.5 py-1">
          <Switch checked={isBillable} onCheckedChange={setIsBillable} />
          <span className="text-sm text-stone-600">Billable</span>
        </div>
      )}
      {/* Buttons */}
      <div className="mt-0.5 flex flex-col gap-1.5">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex h-9 items-center justify-center rounded-lg bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={handleDiscard}
          className="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-sm font-medium text-stone-500 transition-colors hover:bg-stone-50"
        >
          Discard
        </button>
      </div>
    </div>
  )
}

function formatTimerFromMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

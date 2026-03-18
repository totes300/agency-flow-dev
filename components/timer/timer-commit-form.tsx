"use client"

import { useState } from "react"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration, formatTimerDisplay } from "@/lib/duration"
import { TimerDisplay } from "@/components/timer/timer-display"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
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
  const { commitEntry } = useTimerActions()
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

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <TimerDisplay
        time={formatTimerDisplay(stopResult.elapsedMs)}
        status="committing"
      />
      {/* Task context */}
      <div className="flex flex-col gap-0.5">
        <div className="truncate text-sm font-medium text-foreground">{stopResult.taskName}</div>
        <div className="text-xs text-muted-foreground">
          {[stopResult.clientName, stopResult.projectName].filter(Boolean).join(" / ")}
        </div>
      </div>
      {/* Duration input row */}
      <div className="flex items-center gap-2.5 border-b border-border/40 py-2">
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
        <span className="text-[11px] text-muted-foreground">rounded</span>
      </div>
      {/* Note input row */}
      <div className="flex items-center gap-2.5 border-b border-border/40 py-2">
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
      {/* Billable toggle */}
      {stopResult.isBillable && (
        <div className="flex items-center gap-2.5 py-1">
          <Switch checked={isBillable} onCheckedChange={setIsBillable} />
          <span className="text-sm text-muted-foreground">Billable</span>
        </div>
      )}
      {/* Buttons */}
      <div className="mt-0.5 flex flex-col gap-1.5">
        <Button size="lg" onClick={handleSave} disabled={saving} className="w-full">
          Save
        </Button>
        <Button variant="outline" size="lg" onClick={onDone} className="w-full">
          Discard
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { parseDuration, formatDuration, formatTimerDisplay } from "@/lib/duration"
import { TimerDisplay } from "@/components/timer/timer-display"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { ClockIcon, AlignLeftIcon } from "lucide-react"
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

/**
 * Post-stop adjust form. The entry ALREADY EXISTS (create-at-stop) — this
 * form edits it (duration/note/billable) or deletes it. Closing the widget
 * without saving keeps the entry with the measured values; nothing is ever
 * lost between stop and save.
 */
export function TimerCommitForm({
  stopResult,
  onDone,
}: {
  stopResult: StopResult
  onDone: () => void
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const removeEntry = useMutation(api.timeEntries.remove)
  const [durationStr, setDurationStr] = useState(formatDuration(stopResult.roundedMinutes))
  const [note, setNote] = useState("")
  const [isBillable, setIsBillable] = useState(stopResult.isBillable)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleSave() {
    if (!stopResult.entryId) return
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    setSaving(true)
    try {
      const changedBillable = isBillable !== stopResult.isBillable
      const changedDuration = minutes !== stopResult.roundedMinutes
      const trimmedNote = note.trim()
      if (changedBillable || changedDuration || trimmedNote) {
        await updateEntry({
          id: stopResult.entryId,
          ...(changedDuration ? { durationMinutes: minutes } : {}),
          ...(trimmedNote ? { note: trimmedNote } : {}),
          ...(changedBillable ? { isBillable } : {}),
        })
      }
      toast.success(`${formatDuration(minutes)} logged on "${stopResult.taskName}"`)
      onDone()
    } catch (err) {
      toastError(err, "Failed to save time entry")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!stopResult.entryId) return
    setSaving(true)
    try {
      await removeEntry({ id: stopResult.entryId })
      toast.success("Time entry deleted")
      onDone()
    } catch (err) {
      toastError(err, "Failed to delete time entry")
    } finally {
      setSaving(false)
      setConfirmDelete(false)
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
      {/* Saved reassurance */}
      <p className="text-xs text-muted-foreground">
        {formatDuration(stopResult.roundedMinutes)} saved — adjust below if needed.
      </p>
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
        <span className="text-[11px] text-muted-foreground">exact</span>
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
        <Button
          variant="outline"
          size="lg"
          onClick={() => setConfirmDelete(true)}
          disabled={saving}
          className="w-full"
        >
          Delete entry
        </Button>
      </div>

      {/* Delete confirmation — the entry is already persisted */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
            <AlertDialogDescription>
              The saved {formatDuration(stopResult.roundedMinutes)} on &ldquo;{stopResult.taskName}&rdquo; will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep entry</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTimer } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration } from "@/lib/duration"
import { formatShortDate } from "@/lib/format"
import { TimeEntriesList } from "@/components/time/time-entries-list"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ClockIcon, AlignLeftIcon, ChevronDownIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

const QUICK_BUTTONS = [
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 120 },
  { label: "4h", minutes: 240 },
  { label: "8h", minutes: 480 },
]

export function TimeLogPopover({
  taskId,
  isBillable,
  children,
}: {
  taskId: Id<"tasks">
  isBillable: boolean
  children: React.ReactNode
}) {
  const { isAuthenticated } = useConvexAuth()
  const { startTimer } = useTimer()
  const createEntry = useMutation(api.timeEntries.create)

  const [open, setOpen] = useState(false)
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [billable, setBillable] = useState(isBillable)
  const [saving, setSaving] = useState(false)

  // Entries for this task
  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated && open ? { taskId } : "skip",
  )
  const [entriesExpanded, setEntriesExpanded] = useState(false)
  const totalMinutes = entries?.reduce((sum, e) => sum + e.durationMinutes, 0) ?? 0

  function resetForm() {
    setDurationStr("")
    setNote("")
    setBillable(isBillable)
  }

  async function handleSave() {
    const minutes = parseDuration(durationStr)
    if (!minutes) {
      toast.error("Enter a valid duration")
      return
    }
    setSaving(true)
    try {
      await createEntry({
        taskId,
        durationMinutes: minutes,
        note: note.trim() || undefined,
        isBillable: billable,
      })
      toast.success(`${formatDuration(minutes)} logged`)
      resetForm()
    } catch (err) {
      toastError(err, "Failed to log time")
    } finally {
      setSaving(false)
    }
  }

  async function handlePlayClick() {
    try {
      await startTimer(taskId)
      setOpen(false)
    } catch (err) {
      toastError(err, "Failed to start timer")
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
      <PopoverTrigger asChild>
        {children}
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0"
        align="start"
        sideOffset={4}
      >
        {/* Duration input + play button */}
        <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2.5">
          <input
            type="text"
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            className="flex-1 bg-transparent font-mono text-sm text-stone-900 outline-none placeholder:text-stone-300"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
            placeholder="0h 00m"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
          />
          <button
            onClick={handlePlayClick}
            className="flex size-8 items-center justify-center rounded-full bg-stone-100 text-stone-500 transition-colors hover:bg-stone-200"
            aria-label="Start timer"
          >
            <PlayIcon className="size-3.5" fill="currentColor" strokeWidth={0} />
          </button>
        </div>

        {/* Quick buttons */}
        <div className="flex flex-wrap gap-1.5 border-b border-stone-100 px-4 py-2.5">
          {QUICK_BUTTONS.map((btn) => (
            <button
              key={btn.label}
              onClick={() => setDurationStr(btn.label)}
              className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
            >
              {btn.label}
            </button>
          ))}
        </div>

        {/* Icon rows: date + note */}
        <div className="flex flex-col px-4 py-1.5">
          <div className="flex items-center gap-2.5 border-b border-stone-100 py-2">
            <ClockIcon className="size-3.5 shrink-0 text-stone-400" strokeWidth={1.5} />
            <span className="text-sm text-stone-600">
              Today, {formatShortDate(new Date().toISOString().slice(0, 10))}
            </span>
          </div>
          <div className="flex items-center gap-2.5 py-2">
            <AlignLeftIcon className="size-3.5 shrink-0 text-stone-400" strokeWidth={1.5} />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 bg-transparent text-sm text-stone-900 outline-none placeholder:text-stone-400"
              placeholder="Add a note"
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            />
          </div>
        </div>

        {/* Billable + Save */}
        <div className="flex items-center justify-between border-t border-stone-100 px-4 py-2.5">
          {isBillable ? (
            <div className="flex items-center gap-2">
              <Switch checked={billable} onCheckedChange={setBillable} />
              <span className="text-sm text-stone-600">Billable</span>
            </div>
          ) : (
            <div />
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-stone-900 px-5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50"
          >
            Save
          </button>
        </div>

        {/* Time entries section */}
        {entries && entries.length > 0 && (
          <>
            <div className="h-px bg-stone-200" />
            <div className="flex flex-col px-4 py-2.5">
              <button
                onClick={() => setEntriesExpanded(!entriesExpanded)}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-1.5">
                  <ChevronDownIcon
                    className={`size-3 text-stone-400 transition-transform duration-150 ${entriesExpanded ? "" : "-rotate-90"}`}
                    strokeWidth={2}
                  />
                  <span className="text-xs font-medium text-stone-600">Time entries</span>
                </div>
                <span
                  className="font-mono text-xs text-stone-500"
                  style={{ fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {formatDuration(totalMinutes)}
                </span>
              </button>
              {entriesExpanded && (
                <div className="mt-2.5">
                  <TimeEntriesList
                    entries={entries}
                    isAdmin={false}
                    currentUserId={"" as Id<"users">}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

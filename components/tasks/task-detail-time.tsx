"use client"

import { useState, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { TimeEntriesTable } from "@/components/tasks/time-entries-table"
import { UserAvatar } from "@/components/user-avatar"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

import { parseDuration, formatDuration, QUICK_DURATIONS } from "@/lib/duration"
import { formatTimerDisplay, formatMinutesDisplay } from "@/lib/duration"
import { formatDateToYMD, getWeekBounds } from "@/lib/format"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { CalendarIcon, AlignLeftIcon, ChevronDownIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Types ──────────────────────────────────────────────────────────────────────

type TimeRange = "this_week" | "last_week" | "all"

const INITIAL_VISIBLE = 10

const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "all", label: "All" },
]

// ─── Component ──────────────────────────────────────────────────────────────────

export function TaskDetailTime({
  taskId,
  isBillable,
  isDone,
  totalMinutes,
}: {
  taskId: Id<"tasks">
  isBillable: boolean
  isDone: boolean
  totalMinutes: number
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated ? { taskId } : "skip",
  )

  const createEntry = useMutation(api.timeEntries.create)

  // ─── Form state ─────────────────────────────────────────────────────────────
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [billable, setBillable] = useState(isBillable)
  const [saving, setSaving] = useState(false)

  // ─── Filter + pagination ────────────────────────────────────────────────────
  const [range, setRange] = useState<TimeRange>("this_week")
  const [showAll, setShowAll] = useState(false)

  const filteredEntries = useMemo(() => {
    if (!entries) return []
    if (range === "all") return entries
    const bounds = range === "this_week" ? getWeekBounds(0) : getWeekBounds(-1)
    return entries.filter((e) => e.date >= bounds.start && e.date <= bounds.end)
  }, [entries, range])

  const visibleEntries = showAll ? filteredEntries : filteredEntries.slice(0, INITIAL_VISIBLE)
  const hasMore = filteredEntries.length > INITIAL_VISIBLE && !showAll
  const filteredTotal = filteredEntries.reduce((sum, e) => sum + e.durationMinutes, 0)

  // ─── Handlers ───────────────────────────────────────────────────────────────

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
      setDurationStr("")
      setNote("")
      setBillable(isBillable)
    } catch (err) {
      toastError(err, "Failed to log time")
    } finally {
      setSaving(false)
    }
  }

  function handleQuickDuration(label: string) {
    setDurationStr(label)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5">

      {/* ── Manual entry form (matches popover layout) ─────────────────────── */}
      <div className="flex flex-col gap-0 overflow-hidden rounded-lg border border-border/40">

        {/* User row (admin only in future, for now shows current user) */}
        {currentUser && (
          <div className="flex items-center gap-2 border-b border-border/20 px-4 py-2.5">
            <UserAvatar name={currentUser.name} imageUrl={currentUser.imageUrl} className="size-7 text-[10px]" />
            <span className="text-sm font-medium text-foreground">{currentUser.name}</span>
            {isAdmin && <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
          </div>
        )}

        {/* Duration input — no timer here, timer is in the modal header */}
        <div className="flex items-center gap-2 border-b border-border/40 px-4 py-2.5">
          <input
            value={durationStr}
            onChange={(e) => setDurationStr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
            placeholder="0h 00m"
            className="flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
            autoComplete="off"
          />
        </div>

        {/* Quick duration buttons — matches popover */}
        <div className="flex flex-wrap gap-1.5 border-b border-border/40 px-4 py-2.5">
          {QUICK_DURATIONS.map(({ label }) => (
            <Button
              key={label}
              variant="secondary"
              size="xs"
              onClick={() => handleQuickDuration(label)}
              className={cn(durationStr === label && "ring-1 ring-foreground/20")}
            >
              {label}
            </Button>
          ))}
        </div>

        {/* Date + Note — icon rows matching popover */}
        <div className="flex flex-col px-4 py-1.5">
          <div className="flex items-center gap-2.5 border-b border-border/40 py-2">
            <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-sm text-muted-foreground">
              Today, {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          </div>
          <div className="flex items-center gap-2.5 py-2">
            <AlignLeftIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave() }}
              placeholder="Add a note"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        {/* Log time button + Billable */}
        <div className="flex items-center gap-3 border-t border-border/40 px-4 py-2.5">
          <Button className="px-6" onClick={handleSave} disabled={!durationStr.trim() || saving}>
            Log time
          </Button>
          <div className="flex items-center gap-2">
            <Switch checked={billable} onCheckedChange={setBillable} />
            <span className="text-sm text-muted-foreground">{billable ? "Billable" : "Non-billable"}</span>
          </div>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setRange(key); setShowAll(false) }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-all",
                range === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"} ·{" "}
          <span className="font-semibold text-foreground">
            {formatMinutesDisplay(filteredTotal)}
          </span>
        </span>
      </div>

      {/* ── Entries table ──────────────────────────────────────────────────── */}
      {visibleEntries.length > 0 ? (
        <TimeEntriesTable
          entries={visibleEntries}
          isAdmin={isAdmin ?? false}
          currentUserId={currentUser?._id}
        />
      ) : entries ? (
        <div className="flex items-center justify-center rounded-lg border border-border/40 py-10 text-sm text-muted-foreground/50">
          {range === "all" ? "No time entries yet" : "No entries this period"}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[38px] animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      )}

      {/* Show more */}
      {hasMore && (
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowAll(true)}
          className="w-full text-xs text-muted-foreground"
        >
          Show all {filteredEntries.length} entries
        </Button>
      )}
    </div>
  )
}

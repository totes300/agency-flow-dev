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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MiniCalendar, addDays } from "@/components/ui/mini-calendar"

import { parseDuration, formatDuration, QUICK_DURATIONS } from "@/lib/duration"
import { formatTimerDisplay, formatMinutesDisplay } from "@/lib/duration"
import { formatDateToYMD, formatShortDate, getWeekBounds } from "@/lib/format"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { CalendarIcon, AlignLeftIcon, ChevronDownIcon, ClockIcon, ArrowLeftIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Time Entry Date Presets ─────────────────────────────────────────────────

type TimePreset = { label: string; icon: "clock" | "arrow"; getDate: (today: Date) => Date }

function getPreviousFriday(today: Date): Date {
  const d = new Date(today)
  const day = d.getDay()
  // days since last Friday: Sun=2, Mon=3, Tue=4, Wed=5, Thu=6, Fri=7(same day→go back 7), Sat=1
  const diff = day === 5 ? 7 : ((day - 5 + 7) % 7) || 7
  d.setDate(d.getDate() - diff)
  return d
}

const TIME_PRESETS: TimePreset[] = [
  { label: "Today", icon: "clock", getDate: (d) => d },
  { label: "Yesterday", icon: "arrow", getDate: (d) => addDays(d, -1) },
  { label: "2 days ago", icon: "arrow", getDate: (d) => addDays(d, -2) },
  { label: "Last Friday", icon: "arrow", getDate: (d) => getPreviousFriday(d) },
]

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
  const [selectedDate, setSelectedDate] = useState(() => formatDateToYMD(new Date()))
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
    if (saving) return
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
        date: selectedDate,
      })
      toast.success(`${formatDuration(minutes)} logged`)
      setDurationStr("")
      setNote("")
      setSelectedDate(formatDateToYMD(new Date()))
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
            aria-label="Duration"
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
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <CalendarIcon className="size-3.5 shrink-0" strokeWidth={1.5} />
                  <span>{formatShortDate(selectedDate)}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="start">
                <div className="flex">
                  {/* Left: Presets */}
                  <div className="flex w-[140px] flex-col gap-0.5 border-r bg-muted/30 p-2">
                    <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Quick set
                    </div>
                    {TIME_PRESETS.map((preset) => {
                      const presetDate = formatDateToYMD(preset.getDate(new Date()))
                      const isActive = selectedDate === presetDate
                      return (
                        <button
                          key={preset.label}
                          onClick={() => setSelectedDate(presetDate)}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                            isActive
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-muted",
                          )}
                        >
                          {preset.icon === "clock" ? (
                            <ClockIcon className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                          ) : (
                            <ArrowLeftIcon className={cn("size-3.5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                          )}
                          {preset.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Right: Calendar */}
                  <div className="flex-1 p-3">
                    <MiniCalendar
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      disableFuture
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-2.5 py-2">
            <AlignLeftIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              aria-label="Note"
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

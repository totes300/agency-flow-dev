"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { parseDuration, formatDuration, QUICK_DURATIONS } from "@/lib/duration"
import { formatDateToYMD, formatShortDate, getInitials, parseYMDToLocalDate } from "@/lib/format"
import { TimeEntriesList } from "@/components/time/time-entries-list"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { MiniCalendar, addDays } from "@/components/ui/mini-calendar"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import {
  ClockIcon,
  AlignLeftIcon,
  ChevronDownIcon,
  PlayIcon,
  CheckIcon,
  CalendarIcon,
  ArrowLeftIcon,
  DollarSignIcon,
} from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import {
  anchorStartedAt,
  tzWallToEpoch,
  getHMSInTimezone,
  getYMDInTimezone,
} from "@/lib/workday"
import { useOrgTimezone } from "@/lib/hooks/use-org-timezone"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

type DatePreset = {
  label: string
  icon: "clock" | "arrow"
  getDate: (today: Date) => Date
}

function getPreviousFriday(today: Date): Date {
  const d = new Date(today)
  const day = d.getDay()
  const diff = day === 5 ? 7 : ((day - 5 + 7) % 7) || 7
  d.setDate(d.getDate() - diff)
  return d
}

const DATE_PRESETS: DatePreset[] = [
  { label: "Today", icon: "clock", getDate: (d) => d },
  { label: "Yesterday", icon: "arrow", getDate: (d) => addDays(d, -1) },
  { label: "2 days ago", icon: "arrow", getDate: (d) => addDays(d, -2) },
  { label: "Last Friday", icon: "arrow", getDate: (d) => getPreviousFriday(d) },
]

function formatDatePill(dateStr: string, timezone: string): string {
  // "Today" / "Yesterday" must compare against org-tz today, not browser
  // local — otherwise cross-tz users see the wrong relative label.
  const today = getYMDInTimezone(new Date(), timezone)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  const yesterday = m
    ? formatDateToYMD(addDays(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), -1))
    : ""
  if (dateStr === today) return `Today, ${formatShortDate(dateStr)}`
  if (dateStr === yesterday) return `Yesterday, ${formatShortDate(dateStr)}`
  return formatShortDate(dateStr)
}

type StartedAtMode = "default" | "15m" | "30m" | "1h" | "custom"

const STARTED_AT_PRESETS: { value: StartedAtMode; label: string }[] = [
  { value: "default", label: "Just now" },
  { value: "15m", label: "15 minutes ago" },
  { value: "30m", label: "30 minutes ago" },
  { value: "1h", label: "1 hour ago" },
  { value: "custom", label: "Pick a time…" },
]

function offsetMsForMode(mode: StartedAtMode): number {
  switch (mode) {
    case "default": return 0
    case "15m":     return 15 * 60_000
    case "30m":     return 30 * 60_000
    case "1h":      return 60 * 60_000
    case "custom":  return 0
  }
}

/** Combine a YYYY-MM-DD date string with HH:MM in the org timezone,
 *  returning an epoch ms. The HH:MM the user types is interpreted as
 *  wall-clock in org tz so the resulting startedAt's date matches
 *  `dateStr` in org tz (server invariant). */
function combineDateAndTime(
  dateStr: string,
  timeStr: string,
  timezone: string,
): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(timeStr)
  if (!m) return null
  const [yy, mm, dd] = dateStr.split("-").map(Number)
  return tzWallToEpoch(yy, mm, dd, Number(m[1]), Number(m[2]), 0, timezone)
}

function computeStartedAt(
  mode: StartedAtMode,
  durationMinutes: number,
  selectedDate: string,
  customTime: string,
  timezone: string,
): number {
  if (mode === "custom") {
    const fromCustom = combineDateAndTime(selectedDate, customTime, timezone)
    if (fromCustom !== null) return fromCustom
  }
  return anchorStartedAt(selectedDate, durationMinutes, timezone) - offsetMsForMode(mode)
}

function formatTimeHHMM(ms: number, timezone: string): string {
  const { hour, minute } = getHMSInTimezone(ms, timezone)
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export function TimeLogPopover({
  taskId,
  isBillable,
  children,
  align = "start",
  tooltipLabel,
  tooltipSide = "top",
}: {
  taskId: Id<"tasks">
  isBillable: boolean
  children: React.ReactNode
  align?: "start" | "center" | "end"
  tooltipLabel?: string
  tooltipSide?: "top" | "bottom" | "left" | "right"
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const { startTimer } = useTimerActions()
  const createEntry = useMutation(api.timeEntries.create)
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const { timezone, isReady: timezoneReady } = useOrgTimezone()

  const isAdmin = membership?.role === "org:admin"

  const [open, setOpen] = useState(false)
  const [durationStr, setDurationStr] = useState("")
  const [note, setNote] = useState("")
  const [billable, setBillable] = useState(isBillable)
  const [saving, setSaving] = useState(false)
  // selectedDate is derived: explicit user pick wins, otherwise org-tz today.
  // Computing during render keeps it correct across midnight rollover and
  // org-tz changes without a sync effect.
  const [userPickedDate, setUserPickedDate] = useState<string | null>(null)
  const orgToday = getYMDInTimezone(new Date(), timezone)
  const selectedDate = userPickedDate ?? orgToday
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState<Id<"users"> | null>(null)
  const [userPickerOpen, setUserPickerOpen] = useState(false)
  // Started-at chip (slice 6). Computed during render — no useEffect sync.
  const [startedAtMode, setStartedAtMode] = useState<
    "default" | "15m" | "30m" | "1h" | "custom"
  >("default")
  const [customTime, setCustomTime] = useState("") // "HH:MM"
  const [startedAtPickerOpen, setStartedAtPickerOpen] = useState(false)

  // Only load members when admin AND popover is open
  const orgMembers = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated && isAdmin && open ? {} : "skip",
  )

  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated && open ? { taskId } : "skip",
  )
  const [entriesExpanded, setEntriesExpanded] = useState(false)
  const totalMinutes = entries?.reduce((sum, e) => sum + e.durationMinutes, 0) ?? 0

  // Resolve selected user display info
  const effectiveUserId = selectedUserId ?? currentUser?._id
  const selectedMember = isAdmin && selectedUserId && orgMembers
    ? orgMembers.find((m) => m._id === selectedUserId)
    : null
  const displayName = selectedMember?.name ?? currentUser?.name ?? "You"

  // Derived: parsed duration drives validity, preview, and Save label
  const parsedMinutes = parseDuration(durationStr)
  const trimmed = durationStr.trim()
  const durationValid = parsedMinutes !== null && parsedMinutes > 0
  const canonicalForm = durationValid ? formatDuration(parsedMinutes) : ""
  const showPreview = trimmed.length > 0 && durationValid && canonicalForm.toLowerCase() !== trimmed.toLowerCase()
  const showError = trimmed.length > 0 && !durationValid

  const startedAtLabel = formatTimeHHMM(
    computeStartedAt(startedAtMode, parsedMinutes ?? 0, selectedDate, customTime, timezone),
    timezone,
  )

  function resetForm() {
    setDurationStr("")
    setNote("")
    setBillable(isBillable)
    setEntriesExpanded(false)
    setSelectedUserId(null)
    setUserPickerOpen(false)
    setUserPickedDate(null)
    setDatePickerOpen(false)
    setStartedAtMode("default")
    setCustomTime("")
    setStartedAtPickerOpen(false)
  }

  async function handleSave() {
    if (saving || !durationValid || !timezoneReady) return
    setSaving(true)
    try {
      await createEntry({
        taskId,
        durationMinutes: parsedMinutes,
        // Recompute at submit so we send the value as of click, not last render.
        startedAt: computeStartedAt(startedAtMode, parsedMinutes, selectedDate, customTime, timezone),
        note: note.trim() || undefined,
        isBillable: billable,
        date: selectedDate,
        ...(isAdmin && selectedUserId ? { userId: selectedUserId } : {}),
      })
      const forUser = selectedMember ? ` for ${selectedMember.name}` : ""
      toast.success(`${formatDuration(parsedMinutes)} logged${forUser}`)
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

  // Cmd/Ctrl+Enter from any field saves
  function handlePopoverKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      void handleSave()
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm() }}>
      {tooltipLabel ? (
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {children}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={4}>{tooltipLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        className="w-[340px] p-0"
        align={align}
        sideOffset={4}
        onKeyDown={handlePopoverKeyDown}
      >
        {/* User selector (admin only, compact) */}
        {isAdmin && orgMembers ? (
          <div className="border-b border-border/40">
            <button
              type="button"
              onClick={() => setUserPickerOpen(prev => !prev)}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                <span className="text-[8px] font-semibold text-muted-foreground">
                  {getInitials(displayName)}
                </span>
              </div>
              <span className="font-medium text-foreground">{displayName}</span>
              <ChevronDownIcon
                className={cn(
                  "size-3 text-muted-foreground transition-transform duration-150",
                  userPickerOpen && "rotate-180",
                )}
                strokeWidth={2}
              />
            </button>
            {userPickerOpen && (
              <div className="border-t border-border/40 py-1">
                {orgMembers.map((member) => {
                  const isSelected = member._id === effectiveUserId
                  return (
                    <button
                      key={member._id}
                      type="button"
                      onClick={() => {
                        setSelectedUserId(member._id === currentUser?._id ? null : member._id)
                        setUserPickerOpen(false)
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-muted",
                        isSelected && "bg-muted/50",
                      )}
                    >
                      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                        <span className="text-[8px] font-semibold text-muted-foreground">
                          {getInitials(member.name)}
                        </span>
                      </div>
                      <span className="flex-1 text-left">{member.name}</span>
                      {isSelected && (
                        <CheckIcon className="size-3.5 text-foreground" strokeWidth={2} />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ) : null}

        {/* Duration input + play button */}
        <div className="flex flex-col gap-1 px-4 pt-3.5 pb-2.5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={durationStr}
              onChange={(e) => setDurationStr(e.target.value)}
              className={cn(
                "flex-1 bg-transparent font-mono text-base tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40",
                showError && "text-destructive",
              )}
              placeholder="0h 00m"
              aria-label="Duration"
              aria-invalid={showError ? true : undefined}
              autoFocus
              autoComplete="off"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handlePlayClick}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="Start timer"
                >
                  <PlayIcon className="size-3.5" fill="currentColor" strokeWidth={0} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">Start timer instead</TooltipContent>
            </Tooltip>
          </div>
          {showPreview ? (
            <span className="font-mono text-xs text-muted-foreground">
              → {canonicalForm}
            </span>
          ) : showError ? (
            <span className="text-xs text-destructive">
              Try formats like 1h 30m, 90m, 1.5, or 1:30
            </span>
          ) : null}
        </div>

        {/* Quick presets — bigger hit targets, default-emphasized when selected */}
        <div className="flex flex-wrap gap-1.5 px-4 pb-2.5">
          {QUICK_DURATIONS.map((btn) => {
            const isActive = trimmed === btn.label
            return (
              <Button
                key={btn.label}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => setDurationStr(btn.label)}
              >
                {btn.label}
              </Button>
            )
          })}
        </div>

        {/* Metadata rows: date, note, billable */}
        <div className="flex flex-col px-2 pb-2">
          {/* Date — clickable popover with presets + calendar */}
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              {/* Disabled until org tz is loaded — picking a date with the
                  fallback tz could let a save proceed for a YMD that's
                  future in the real org tz once settings finally resolve. */}
              <button
                type="button"
                disabled={!timezoneReady}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <span className="flex-1 text-left">{formatDatePill(selectedDate, timezone)}</span>
                <ChevronDownIcon
                  className="size-3 text-muted-foreground"
                  strokeWidth={2}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[380px] p-0" align="start">
              <div className="flex">
                <div className="flex w-[140px] flex-col gap-0.5 border-r bg-muted/30 p-2">
                  <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Quick set
                  </div>
                  {DATE_PRESETS.map((preset) => {
                    // Build presets relative to org-tz "today" (a local-Date
                    // representation of the org-tz YMD), not browser-local.
                    const todayLocalProxy = parseYMDToLocalDate(orgToday) ?? new Date()
                    const presetDate = formatDateToYMD(preset.getDate(todayLocalProxy))
                    const isActive = selectedDate === presetDate
                    return (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setUserPickedDate(presetDate)
                          setDatePickerOpen(false)
                        }}
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
                <div className="flex-1 p-3">
                  <MiniCalendar
                    selected={selectedDate}
                    onSelect={(d) => {
                      setUserPickedDate(d)
                      setDatePickerOpen(false)
                    }}
                    disableFuture
                    timezone={timezone}
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Started at — chip with quick presets + free-form picker */}
          <Popover open={startedAtPickerOpen} onOpenChange={setStartedAtPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/60"
              >
                <ClockIcon
                  className="size-3.5 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                />
                <span className="flex-1 text-left">
                  Started at <span className="font-mono">{startedAtLabel}</span>
                </span>
                <ChevronDownIcon
                  className="size-3 text-muted-foreground"
                  strokeWidth={2}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[220px] p-1" align="start">
              {STARTED_AT_PRESETS.map((preset) => {
                const isActive = startedAtMode === preset.value
                return (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setStartedAtMode(preset.value)
                      if (preset.value !== "custom") {
                        setStartedAtPickerOpen(false)
                      }
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <span>{preset.label}</span>
                    {isActive ? (
                      <CheckIcon className="size-3.5" strokeWidth={2} />
                    ) : null}
                  </button>
                )
              })}
              {startedAtMode === "custom" ? (
                <div className="mt-1 border-t border-border/40 pt-2">
                  <label className="block px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Time on {formatDatePill(selectedDate, timezone)}
                  </label>
                  <input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-border bg-background px-2 py-1 font-mono text-sm text-foreground outline-none focus:border-primary"
                    aria-label="Custom start time"
                    autoFocus
                  />
                </div>
              ) : null}
            </PopoverContent>
          </Popover>

          {/* Note */}
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
            <AlignLeftIcon className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="Add a note"
              aria-label="Note"
            />
          </div>

          {/* Billable — full row clickable, mirrors Date row structure: icon + label + control */}
          {isBillable ? (
            <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
              <DollarSignIcon
                className={cn(
                  "size-3.5 shrink-0 transition-colors",
                  billable ? "text-foreground" : "text-muted-foreground",
                )}
                strokeWidth={1.5}
              />
              <span className={cn(
                "flex-1 text-sm transition-colors",
                billable ? "text-foreground" : "text-muted-foreground",
              )}>
                {billable ? "Billable" : "Non-billable"}
              </span>
              <Switch checked={billable} onCheckedChange={setBillable} />
            </label>
          ) : null}
        </div>

        {/* Footer: helper text balra, dynamic Save jobbra with inline shortcut hint */}
        <div className="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            {durationValid ? (
              <>
                Press <kbd className="rounded border border-border/60 bg-muted px-1 font-mono text-[10px] text-foreground">⌘</kbd>{" "}
                <kbd className="rounded border border-border/60 bg-muted px-1 font-mono text-[10px] text-foreground">↵</kbd> to save
              </>
            ) : (
              "Enter a duration to save"
            )}
          </span>
          <Button
            onClick={handleSave}
            disabled={saving || !durationValid || !timezoneReady}
          >
            {durationValid ? `Save ${canonicalForm}` : "Save"}
          </Button>
        </div>

        {/* Time entries section — same surface, hairline divider, refined density */}
        {entries && entries.length > 0 && (
          <div className="flex flex-col border-t border-border/40 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setEntriesExpanded(prev => !prev)}
              className="flex items-center justify-between"
              aria-expanded={entriesExpanded}
            >
              <div className="flex items-center gap-1.5">
                <ChevronDownIcon
                  className={cn(
                    "size-3 text-muted-foreground transition-transform duration-150",
                    !entriesExpanded && "-rotate-90",
                  )}
                  strokeWidth={2}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Time entries ({entries.length})
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDuration(totalMinutes)}
              </span>
            </button>
            {entriesExpanded && (
              <div className="mt-2.5">
                <TimeEntriesList
                  entries={entries}
                  isAdmin={isAdmin}
                  currentUserId={currentUser?._id}
                />
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

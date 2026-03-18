"use client"

import { useState, useMemo } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { CalendarIcon, ClockIcon, ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon, XIcon, RepeatIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateToYMD, formatShortDate } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Date helpers ────────────────────────────────────────────────────────────

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function nextDayOfWeek(date: Date, dayOfWeek: number): Date {
  const d = new Date(date)
  const diff = (dayOfWeek - d.getDay() + 7) % 7
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff))
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  // 0=Mon, 1=Tue, ... 6=Sun (ISO week)
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

// ─── Presets ─────────────────────────────────────────────────────────────────

type Preset = { label: string; icon: "clock" | "arrow" | "calendar" | "repeat"; getDate: (today: Date) => Date }

const PRESETS: Preset[] = [
  { label: "Today", icon: "clock", getDate: (d) => d },
  { label: "Tomorrow", icon: "arrow", getDate: (d) => addDays(d, 1) },
  { label: "In 3 days", icon: "calendar", getDate: (d) => addDays(d, 3) },
  { label: "This Friday", icon: "calendar", getDate: (d) => nextDayOfWeek(d, 5) },
  { label: "Next Monday", icon: "repeat", getDate: (d) => nextDayOfWeek(d, 1) },
  { label: "Next Friday", icon: "repeat", getDate: (d) => nextDayOfWeek(addDays(d, 7), 5) },
  { label: "In 2 weeks", icon: "calendar", getDate: (d) => addDays(d, 14) },
]

function PresetIcon({ type, className }: { type: Preset["icon"]; className?: string }) {
  const props = { className: cn("size-3.5 shrink-0", className) }
  switch (type) {
    case "clock": return <ClockIcon {...props} />
    case "arrow": return <ArrowRightIcon {...props} />
    case "calendar": return <CalendarIcon {...props} />
    case "repeat": return <RepeatIcon {...props} />
  }
}

// ─── Mini Calendar ──────────────────────────────────────────────────────────

function MiniCalendar({
  selected,
  onSelect,
}: {
  selected: string | null // YYYY-MM-DD
  onSelect: (date: string) => void
}) {
  const today = useMemo(() => new Date(), [])
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth)

  // Previous month padding
  const prevMonthDays = getDaysInMonth(viewYear, viewMonth - 1)
  const prevPadding = Array.from({ length: firstDay }, (_, i) => ({
    day: prevMonthDays - firstDay + 1 + i,
    current: false,
  }))

  // Current month days
  const currentDays = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    current: true,
  }))

  // Next month padding
  const totalCells = prevPadding.length + currentDays.length
  const nextPadding = Array.from({ length: (7 - (totalCells % 7)) % 7 }, (_, i) => ({
    day: i + 1,
    current: false,
  }))

  const allDays = [...prevPadding, ...currentDays, ...nextPadding]
  const weeks: typeof allDays[] = []
  for (let i = 0; i < allDays.length; i += 7) {
    weeks.push(allDays.slice(i, i + 7))
  }

  const monthLabel = new Date(viewYear, viewMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(viewYear - 1); setViewMonth(11) }
    else setViewMonth(viewMonth - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(viewYear + 1); setViewMonth(0) }
    else setViewMonth(viewMonth + 1)
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Month nav */}
      <div className="flex items-center justify-between px-1 pb-1">
        <button onClick={prevMonth} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="text-[13px] font-semibold">{monthLabel}</span>
        <button onClick={nextMonth} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
          <ChevronRightIcon className="size-4" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="flex h-7 items-center justify-center text-[10px] font-medium text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((cell, ci) => {
            const cellDate = cell.current
              ? new Date(viewYear, viewMonth, cell.day)
              : null
            const dateStr = cellDate ? formatDateToYMD(cellDate) : null
            const isToday = cellDate && isSameDay(cellDate, today)
            const isSelected = dateStr && dateStr === selected

            return (
              <button
                key={ci}
                onClick={() => dateStr && onSelect(dateStr)}
                disabled={!cell.current}
                className={cn(
                  "flex h-7 w-full items-center justify-center rounded-md text-xs transition-colors",
                  !cell.current && "text-muted-foreground/30",
                  cell.current && !isToday && !isSelected && "text-foreground hover:bg-muted",
                  isToday && !isSelected && "font-semibold text-primary",
                  isSelected && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {cell.day}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function InlineDueDateCell({
  taskId,
  dueDate,
  isOverdue,
  onSelect: onSelectProp,
}: {
  taskId?: Id<"tasks">
  dueDate: string | null // YYYY-MM-DD
  isOverdue?: boolean
  onSelect?: (date: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(date: string | null) {
    setOpen(false)
    if (onSelectProp) {
      onSelectProp(date)
      return
    }
    if (!taskId) return
    try {
      await updateTask({ id: taskId, dueDate: date })
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }

  function handlePreset(preset: Preset) {
    const date = preset.getDate(new Date())
    handleSelect(formatDateToYMD(date))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center py-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {dueDate ? (
            <span className={cn("text-xs", isOverdue ? "font-medium text-red-600" : "text-muted-foreground")}>
              {isOverdue ? "Overdue" : (
                <>
                  <CalendarIcon className="mr-1 inline size-3 opacity-50" />
                  {formatShortDate(dueDate)}
                </>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground/20 transition-colors group-hover/row:text-muted-foreground/50">
              <CalendarIcon className="size-3.5" />
              <span className="text-xs">Due</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <div className="flex">
          {/* Left: Presets */}
          <div className="flex w-[140px] flex-col gap-0.5 border-r bg-muted/30 p-2">
            <div className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Quick set
            </div>
            {PRESETS.map((preset) => {
              const presetDate = formatDateToYMD(preset.getDate(new Date()))
              const isActive = dueDate === presetDate
              return (
                <button
                  key={preset.label}
                  onClick={() => handlePreset(preset)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <PresetIcon type={preset.icon} className={isActive ? "text-primary" : "text-muted-foreground"} />
                  {preset.label}
                </button>
              )
            })}
            <div className="mt-1 border-t pt-1">
              <button
                onClick={() => handleSelect(null)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50"
              >
                <XIcon className="size-3.5 shrink-0" />
                No date
              </button>
            </div>
          </div>

          {/* Right: Calendar */}
          <div className="flex-1 p-3">
            <MiniCalendar
              selected={dueDate}
              onSelect={handleSelect}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

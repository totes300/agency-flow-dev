"use client"

import { useState, useMemo } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateToYMD, isSameDay } from "@/lib/format"

// ─── Date helpers ────────────────────────────────────────────────────────────

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function nextDayOfWeek(date: Date, dayOfWeek: number): Date {
  const d = new Date(date)
  const diff = (dayOfWeek - d.getDay() + 7) % 7
  d.setDate(d.getDate() + (diff === 0 ? 7 : diff))
  return d
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year: number, month: number): number {
  // 0=Mon, 1=Tue, ... 6=Sun (ISO week)
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

// ─── Mini Calendar ──────────────────────────────────────────────────────────

export function MiniCalendar({
  selected,
  onSelect,
  disableFuture = false,
}: {
  selected: string | null // YYYY-MM-DD
  onSelect: (date: string) => void
  disableFuture?: boolean
}) {
  const today = useMemo(() => new Date(), [])
  const todayStr = useMemo(() => formatDateToYMD(today), [today])
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
        <button
          onClick={prevMonth}
          aria-label="Previous month"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <span className="text-[13px] font-semibold">{monthLabel}</span>
        <button
          onClick={nextMonth}
          aria-label="Next month"
          className={cn(
            "rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:rounded-sm",
            disableFuture && viewYear === today.getFullYear() && viewMonth === today.getMonth() && "opacity-30 cursor-not-allowed"
          )}
          disabled={disableFuture && viewYear === today.getFullYear() && viewMonth === today.getMonth()}
        >
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
            const isFutureDate = disableFuture && dateStr && dateStr > todayStr

            return (
              <button
                key={ci}
                onClick={() => dateStr && onSelect(dateStr)}
                disabled={!cell.current || !!isFutureDate}
                aria-label={dateStr ? `Select ${dateStr}` : undefined}
                aria-selected={!!isSelected}
                className={cn(
                  "flex h-7 w-full items-center justify-center rounded-md text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  !cell.current && "text-muted-foreground/30",
                  isFutureDate && "text-muted-foreground/20 cursor-not-allowed",
                  cell.current && !isFutureDate && !isToday && !isSelected && "text-foreground hover:bg-muted",
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

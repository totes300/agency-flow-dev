"use client"

import { useMemo, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  addDays,
  formatRange,
  startOfWeek,
  useMonthGrid,
} from "@/lib/hooks/use-week-picker"

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

export function WorkdayWeekPicker({
  selectedWeek,
  onSelectWeek,
  onShiftWeek,
}: {
  selectedWeek: Date
  onSelectWeek: (weekStart: Date) => void
  onShiftWeek: (delta: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [displayMonth, setDisplayMonth] = useState(
    () => new Date(selectedWeek.getFullYear(), selectedWeek.getMonth(), 1),
  )

  const weekEnd = useMemo(() => addDays(selectedWeek, 4), [selectedWeek])
  const label = formatRange(selectedWeek, weekEnd)

  const grid = useMonthGrid(displayMonth, selectedWeek)

  function selectWeek(weekStart: Date) {
    onSelectWeek(weekStart)
    setOpen(false)
  }

  function jumpToThisWeek() {
    const monday = startOfWeek(new Date())
    setDisplayMonth(new Date(monday.getFullYear(), monday.getMonth(), 1))
    selectWeek(monday)
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Previous week"
        onClick={() => onShiftWeek(-1)}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setDisplayMonth(
              new Date(selectedWeek.getFullYear(), selectedWeek.getMonth(), 1),
            )
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-[13px] font-medium tabular-nums"
          >
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-[320px] p-3"
        >
          <CalendarHeader
            label={grid.monthLabel}
            onPrev={() =>
              setDisplayMonth(
                new Date(displayMonth.getFullYear(), displayMonth.getMonth() - 1, 1),
              )
            }
            onNext={() =>
              setDisplayMonth(
                new Date(displayMonth.getFullYear(), displayMonth.getMonth() + 1, 1),
              )
            }
          />

          <div className="mt-2 grid grid-cols-7 gap-y-0.5 px-1 text-[11px] text-muted-foreground/70">
            {WEEKDAY_LABELS.map((d) => (
              <div key={d} className="text-center">
                {d}
              </div>
            ))}
          </div>

          <div className="mt-1 flex flex-col">
            {grid.rows.map((row) => (
              <button
                key={row.weekStart.getTime()}
                type="button"
                onClick={() => selectWeek(row.weekStart)}
                className={cn(
                  "group grid grid-cols-7 rounded-md py-0.5 transition-colors",
                  "hover:bg-muted/60",
                  row.isSelectedWeek && "bg-primary/10 hover:bg-primary/15",
                )}
              >
                {row.cells.map((cell) => (
                  <span
                    key={cell.date.getTime()}
                    className={cn(
                      "relative flex h-8 items-center justify-center text-[12.5px] tabular-nums",
                      cell.inMonth ? "text-foreground" : "text-muted-foreground/55",
                      cell.isToday && "font-semibold text-primary",
                    )}
                  >
                    {cell.date.getDate()}
                    {cell.isToday ? (
                      <span className="absolute bottom-0.5 size-[3px] rounded-full bg-primary" />
                    ) : null}
                  </span>
                ))}
              </button>
            ))}
          </div>

          <div className="mt-2 flex justify-end border-t border-border pt-2">
            <button
              type="button"
              onClick={jumpToThisWeek}
              className="text-[12px] font-medium text-primary hover:underline"
            >
              Jump to this week
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label="Next week"
        onClick={() => onShiftWeek(1)}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
    </div>
  )
}

function CalendarHeader({
  label,
  onPrev,
  onNext,
}: {
  label: string
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Previous month"
        onClick={onPrev}
      >
        <ChevronLeftIcon className="size-4" />
      </Button>
      <span className="text-[13px] font-semibold tracking-tight">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label="Next month"
        onClick={onNext}
      >
        <ChevronRightIcon className="size-4" />
      </Button>
    </div>
  )
}

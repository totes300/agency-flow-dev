"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatNoteDate, getPrevDay, getNextDay, isToday } from "@/lib/daily-notes-helpers"

type DateNavigatorProps = {
  selectedDate: string
  today: string
  onDateChange: (date: string) => void
}

export function DateNavigator({
  selectedDate,
  today,
  onDateChange,
}: DateNavigatorProps) {
  const onToday = isToday(selectedDate, today)
  const label = formatNoteDate(selectedDate, today)

  const goBack = () => onDateChange(getPrevDay(selectedDate))
  const goForward = () => {
    if (!onToday) onDateChange(getNextDay(selectedDate))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") goBack()
    if (e.key === "ArrowRight") goForward()
  }

  return (
    <nav
      className="flex items-center justify-between gap-1"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Previous day"
        onClick={goBack}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <span className="text-sm font-medium select-none">{label}</span>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label="Next day"
        disabled={onToday}
        onClick={goForward}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </nav>
  )
}

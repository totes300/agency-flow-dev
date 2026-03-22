"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { MiniCalendar, addDays, nextDayOfWeek } from "@/components/ui/mini-calendar"
import { CalendarIcon, ClockIcon, ArrowRightIcon, XIcon, RepeatIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateToYMD, formatShortDate } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

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
              <CalendarIcon className={cn("mr-1 inline size-3", isOverdue ? "opacity-70" : "opacity-50")} />
              {formatShortDate(dueDate)}
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
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-500/10"
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

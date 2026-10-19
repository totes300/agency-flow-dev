"use client"

import { MiniCalendar, addDays, nextDayOfWeek } from "@/components/ui/mini-calendar"
import { CalendarIcon, ClockIcon, ArrowRightIcon, XIcon, RepeatIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateToYMD } from "@/lib/format"

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

/**
 * The due-date picker body (quick presets + month calendar), shown by the
 * shared `PropertyMenu` for the due and start dates.
 */
export function DueDatePanel({
  dueDate,
  onSelect,
}: {
  dueDate: string | null // YYYY-MM-DD
  onSelect: (date: string | null) => void
}) {
  return (
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
              type="button"
              onClick={() => onSelect(formatDateToYMD(preset.getDate(new Date())))}
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
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
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
          onSelect={onSelect}
        />
      </div>
    </div>
  )
}

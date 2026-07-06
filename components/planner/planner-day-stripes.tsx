"use client"

import { cn } from "@/lib/utils"

/**
 * Day-column background stripes (boundary line + weekend/today tint) for one
 * relative-positioned canvas. Shared by every row canvas and the flexible
 * filler area below the rows, so the columns run the full viewport height.
 * Positions are pixel-based: the continuous timeline uses fixed day widths.
 */
export function PlannerDayStripes({
  days,
  dayPx,
  weekendFlags,
  todayFlags,
  weekStartFlags,
}: {
  days: string[]
  dayPx: number
  weekendFlags: boolean[]
  todayFlags: boolean[]
  /** Mondays get a stronger left border (month zoom orientation aid). */
  weekStartFlags?: boolean[]
}) {
  return (
    <>
      {days.map((date, i) => (
        <div
          key={date}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 border-l",
            weekStartFlags?.[i] ? "border-border" : "border-border/60",
          )}
          style={{
            left: `${i * dayPx}px`,
            width: `${dayPx}px`,
            backgroundColor: todayFlags[i]
              ? "color-mix(in srgb, var(--primary) 4%, transparent)"
              : weekendFlags[i]
                ? "color-mix(in srgb, var(--foreground) 2.5%, transparent)"
                : undefined,
          }}
        />
      ))}
    </>
  )
}

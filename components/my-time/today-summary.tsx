"use client"

import { useTimer } from "@/lib/hooks/use-timer"
import { formatDuration } from "@/lib/duration"

export function TodaySummary({ totalMinutes }: { totalMinutes: number }) {
  const { timerState, formattedTime } = useTimer()
  const today = new Date()
  const dateStr = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold text-stone-900">My Time</h1>
        <p className="text-sm text-stone-400">{dateStr}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
          Today
        </span>
        <span
          className="text-2xl font-normal text-stone-900"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {formatDuration(totalMinutes)}
        </span>
      </div>
    </div>
  )
}

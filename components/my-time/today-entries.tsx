"use client"

import { useTimer } from "@/lib/hooks/use-timer"
import { useUser } from "@clerk/nextjs"
import { formatDuration } from "@/lib/duration"
import { ClockIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

type TodayEntry = {
  _id: string
  taskName: string
  durationMinutes: number
  note?: string
  isBillable: boolean
}

export function ActiveTimerBanner() {
  const { timerState, formattedTime } = useTimer()
  if (!timerState) return null

  return (
    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="size-2 animate-pulse rounded-full bg-red-500" />
        <span className="text-sm font-medium text-red-600">Recording</span>
        <span className="text-sm text-foreground">{timerState.taskName}</span>
      </div>
      <span className="font-mono text-sm font-normal text-red-500">
        {formattedTime}
      </span>
    </div>
  )
}

export function TodayEntries({ entries }: { entries: TodayEntry[] }) {
  const { user } = useUser()

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ClockIcon}
        title="No entries yet today"
        description="Start a timer or log time manually to see entries here."
      />
    )
  }

  const raw = user
    ? (user.firstName?.[0] ?? "") + (user.lastName?.[0] ?? "")
    : ""
  const initials = raw || "?"

  return (
    <div className="flex flex-col">
      {entries.map((entry) => (
        <div
          key={entry._id}
          className="flex items-center gap-3 border-b border-border/40 px-1 py-3 last:border-b-0"
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
            <span className="text-[11px] font-semibold text-muted-foreground">{initials}</span>
          </div>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{entry.taskName}</span>
            {entry.note && (
              <span className="text-xs text-muted-foreground">{entry.note}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {entry.isBillable && (
              <span
                className="size-1.5 rounded-full bg-green-500"
                title="Billable"
                aria-label="Billable"
              />
            )}
            <span className="font-mono text-sm text-muted-foreground">
              {formatDuration(entry.durationMinutes)}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

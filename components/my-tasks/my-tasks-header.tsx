"use client"

import { ClockIcon } from "lucide-react"
import { ViewSettingsDropdown } from "./view-settings-dropdown"

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export function MyTasksHeader({
  todayMinutes,
  visibleStatusIds,
  orgDefaultStatusIds,
}: {
  todayMinutes: number
  visibleStatusIds: string[]
  orgDefaultStatusIds?: string[]
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">My tasks</h1>
      <div className="flex items-center gap-2">
        <ViewSettingsDropdown
          visibleStatusIds={visibleStatusIds}
          orgDefaultStatusIds={orgDefaultStatusIds}
        />
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClockIcon className="size-3.5" />
          <span>{formatMinutes(todayMinutes)}</span>
        </div>
      </div>
    </div>
  )
}

"use client"

import { UserAvatar } from "@/components/user-avatar"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { WORKDAY_HEIGHT_PX } from "@/lib/workday"
import type { WorkdayBox, WorkdayUserRow as WorkdayUserRowData } from "@/convex/workday"
import { WorkdayDayCell } from "./workday-day-cell"

export function WorkdayUserRow({
  row,
  gridTemplate,
  weekendFlags,
  todayFlags,
  onOpenTask,
}: {
  row: WorkdayUserRowData
  gridTemplate: string
  weekendFlags: boolean[]
  todayFlags: boolean[]
  onOpenTask: (taskId: WorkdayBox["taskId"]) => void
}) {
  const hasTime = row.totalMinutes > 0
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-lg border border-border bg-background",
        "transition-colors hover:border-foreground/15",
      )}
      style={{ gridTemplateColumns: gridTemplate }}
    >
      <div
        className="flex flex-col gap-4 border-r border-border bg-muted/40 px-4 py-[18px]"
        style={{ minHeight: `${WORKDAY_HEIGHT_PX + 64}px` }}
      >
        <div className="flex items-center gap-2.5">
          <UserAvatar name={row.user.name} imageUrl={row.user.imageUrl} />
          <div className="flex min-w-0 flex-col gap-px">
            <span className="truncate text-[14px] font-semibold leading-[1.25] tracking-[-0.005em] text-foreground">
              {row.user.name}
            </span>
            <span className="text-[12px] capitalize leading-[1.2] text-muted-foreground/70">
              {row.user.role}
            </span>
          </div>
        </div>
        <div className="mt-auto flex flex-col gap-px">
          <span
            className={cn(
              "text-[22px] font-semibold leading-[1.1] tracking-[-0.015em]",
              "tabular-nums",
              hasTime ? "text-foreground" : "font-normal text-muted-foreground/70",
            )}
          >
            {hasTime ? formatDuration(row.totalMinutes) : "0h"}
          </span>
          <span className="text-[12px] font-normal text-muted-foreground/70">
            this week
          </span>
        </div>
      </div>
      {row.days.map((day, idx) => (
        <WorkdayDayCell
          key={day.date}
          day={day}
          isWeekend={weekendFlags[idx] ?? false}
          isToday={todayFlags[idx] ?? false}
          onOpenTask={onOpenTask}
        />
      ))}
    </div>
  )
}

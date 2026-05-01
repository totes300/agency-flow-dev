"use client"

import { cn } from "@/lib/utils"
import type { WorkdayBox, WorkdayGridData } from "@/convex/workday"
import { WorkdayEmptyState } from "./workday-empty-state"
import { WorkdayUserRow } from "./workday-user-row"

const DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

function dayLabel(date: string, idx: number): { name: string; num: string } {
  const [, , d] = date.split("-")
  return { name: DAY_NAMES[idx] ?? "", num: String(parseInt(d, 10)) }
}

/** True for Saturday or Sunday. Reading from the actual date instead of column
 *  index so the grid doesn't silently miscolor when a future locale change
 *  ships a Sun-first range. */
function isWeekendDate(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number)
  const w = new Date(y, m - 1, d).getDay()
  return w === 0 || w === 6
}

export function WorkdayGrid({
  data,
  todayYMD,
  onOpenTask,
}: {
  data: WorkdayGridData
  todayYMD: string
  onOpenTask: (taskId: WorkdayBox["taskId"]) => void
}) {
  if (data.users.length === 0) {
    return (
      <WorkdayEmptyState
        title="No team members yet"
        description="Once members join your organization their week will appear here."
      />
    )
  }

  const dayCount = data.users[0]?.days.length ?? 5
  const dates = data.users[0]?.days.map((d) => d.date) ?? []
  const weekendFlags = dates.map(isWeekendDate)
  const todayFlags = dates.map((d) => d === todayYMD)
  const gridTemplate = `200px repeat(${dayCount}, minmax(168px, 1fr))`
  const totalLogged = data.users.reduce((s, u) => s + u.totalMinutes, 0)

  return (
    <div className="flex flex-col">
      <div
        className="grid"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* invisible "user" column header — reserves the 200px identity column */}
        <div className="px-[14px] pb-[10px] pt-[6px]" aria-hidden />

        {dates.map((date, idx) => {
          const { name, num } = dayLabel(date, idx)
          const isToday = todayFlags[idx]
          return (
            <div
              key={date}
              className="flex flex-col gap-0.5 px-[14px] pb-[10px] pt-[6px]"
            >
              <span
                className={cn(
                  "text-[11.5px] font-medium lowercase",
                  isToday ? "text-primary opacity-80" : "text-muted-foreground/70",
                )}
              >
                {name}
              </span>
              <span
                className={cn(
                  "text-[18px] font-semibold leading-none",
                  "tracking-[-0.01em]",
                  isToday ? "text-primary" : "text-foreground",
                )}
              >
                {num}
              </span>
            </div>
          )
        })}
      </div>

      {totalLogged === 0 ? <WorkdayEmptyState /> : null}

      <div className="flex flex-col gap-2.5">
        {data.users.map((row) => (
          <WorkdayUserRow
            key={row.user._id}
            row={row}
            gridTemplate={gridTemplate}
            weekendFlags={weekendFlags}
            todayFlags={todayFlags}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  )
}

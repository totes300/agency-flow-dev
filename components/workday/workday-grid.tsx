"use client"

import { cn } from "@/lib/utils"
import type { WorkdayBox, WorkdayGridData } from "@/convex/workday"
import { WorkdayEmptyState } from "./workday-empty-state"
import { WorkdayUserRow } from "./workday-user-row"

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

function dayLabel(
  date: string,
  idx: number,
): { name: string; num: string; month: string | null } {
  const [, m, d] = date.split("-")
  const dayNum = parseInt(d, 10)
  // Show month only when the week crosses a month boundary — i.e. the cell
  // lands on the 1st. The week-range header above already labels months
  // when the week stays inside one month.
  return {
    name: DAY_NAMES[idx] ?? "",
    num: String(dayNum),
    month: dayNum === 1 ? MONTH_NAMES[parseInt(m, 10) - 1] ?? null : null,
  }
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

  return (
    <div className="flex flex-col">
      <div
        className="grid"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* invisible "user" column header — reserves the 200px identity column */}
        <div className="px-[14px] pb-[10px] pt-[6px]" aria-hidden />

        {dates.map((date, idx) => {
          const { name, num, month } = dayLabel(date, idx)
          const isToday = todayFlags[idx]
          return (
            <div
              key={date}
              className="flex items-baseline justify-center gap-1.5 px-[14px] pb-[10px] pt-[10px]"
              style={
                isToday
                  ? {
                      backgroundColor:
                        "color-mix(in srgb, var(--primary) 3%, transparent)",
                    }
                  : undefined
              }
            >
              <span
                className={cn(
                  "text-[12.5px] font-medium",
                  isToday ? "text-primary opacity-80" : "text-muted-foreground/70",
                )}
              >
                {name}
              </span>
              <span
                className={cn(
                  "text-[14px] font-semibold leading-none tracking-[-0.01em]",
                  isToday ? "text-primary" : "text-foreground",
                )}
              >
                {month ? `${month} ${num}` : num}
              </span>
            </div>
          )
        })}
      </div>

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

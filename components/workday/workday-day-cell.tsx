"use client"

import { Badge } from "@/components/ui/badge"
import { formatDuration } from "@/lib/duration"
import { cn } from "@/lib/utils"
import { CAPACITY_MINUTES, WORKDAY_HEIGHT_PX } from "@/lib/workday"
import type { WorkdayBox, WorkdayDay } from "@/convex/workday"
import { WorkdayTaskBox } from "./workday-task-box"

export function WorkdayDayCell({
  day,
  isWeekend,
  isToday,
  onOpenTask,
}: {
  day: WorkdayDay
  isWeekend: boolean
  isToday: boolean
  onOpenTask: (taskId: WorkdayBox["taskId"]) => void
}) {
  const hasBoxes = day.boxes.length > 0
  const overtimeMinutes = Math.max(0, day.totalMinutes - CAPACITY_MINUTES)
  const isOvertime = overtimeMinutes > 0

  return (
    <div
      className={cn(
        "relative flex flex-col border-r border-border last:border-r-0",
        "px-[10px] pt-[14px] pb-[12px]",
        isWeekend && "bg-muted/30",
      )}
      style={
        isToday
          ? {
              backgroundImage:
                "linear-gradient(to bottom, color-mix(in srgb, var(--primary) 2.5%, transparent) 0%, transparent 80px)",
            }
          : undefined
      }
    >
      <div
        className="relative flex flex-col gap-1"
        style={{ minHeight: `${WORKDAY_HEIGHT_PX}px` }}
      >
        {hasBoxes ? (
          // taskId is unique per (user, day) — one box per tuple by aggregation.
          day.boxes.map((box) => (
            <WorkdayTaskBox
              key={box.taskId.toString()}
              box={box}
              onOpenTask={onOpenTask}
            />
          ))
        ) : (
          <span className="pt-1 text-[11.5px] text-muted-foreground/60">
            No work logged
          </span>
        )}

        {/* 8h capacity hairline — visible when overtime spills past the stack. */}
        {isOvertime && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 flex items-center gap-1.5"
            style={{ top: `${WORKDAY_HEIGHT_PX}px`, transform: "translateY(-50%)" }}
          >
            <div className="h-0 flex-1 border-t border-dashed border-foreground/30" />
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground/80">
              8h
            </span>
          </div>
        )}
      </div>

      {hasBoxes && (
        <div className="flex items-center justify-between gap-2 border-t border-border pb-0 pt-2.5 text-[12px] font-medium tabular-nums">
          <span className="text-[11px] font-normal text-muted-foreground/70">
            total
          </span>
          <div className="flex items-center gap-2">
            {isOvertime && (
              <Badge
                variant="destructive"
                className="h-auto px-1.5 py-0.5 text-[10px] font-semibold"
              >
                +{formatDuration(overtimeMinutes)}
              </Badge>
            )}
            <span
              className={cn(
                "font-mono",
                isOvertime
                  ? "font-semibold text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {formatDuration(day.totalMinutes)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

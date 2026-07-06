import { Skeleton } from "@/components/ui/skeleton"
import { PLANNER_LANE_PX, PLANNER_ROW_PAD_PX } from "./planner-bar"

/**
 * Content-aware skeleton mirroring the fullscreen Planner grid: sticky-rail
 * column, day-header strip, rows with bar-shaped placeholders at staggered
 * offsets, and a filler area so the frame fills the viewport like the real
 * board.
 */
export function PlannerGridSkeleton({ dayCount = 14 }: { dayCount?: number }) {
  const days = Array.from({ length: dayCount }, (_, i) => i)
  const gridTemplate = `200px repeat(${dayCount}, minmax(0, 1fr))`
  const rowHeight = PLANNER_LANE_PX + PLANNER_ROW_PAD_PX * 2

  // Staggered bar placeholders: [startDay, spanDays] per row.
  const rowBars: Array<Array<[number, number]>> = [
    [[0, 3], [7, 2]],
    [[3, 4]],
    [[1, 2], [8, 3]],
    [[5, 3]],
  ]

  return (
    <div className="flex h-full flex-col overflow-hidden bg-card">
      <div
        className="grid border-b border-border"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="flex items-end border-r border-border px-3.5 pb-[7px] pt-2">
          <Skeleton className="h-3 w-10" />
        </div>
        {days.map((d) => (
          <div
            key={d}
            className="flex items-end justify-center border-l border-border/60 pb-1.5 pt-[7px]"
          >
            <Skeleton className="h-3.5 w-9" />
          </div>
        ))}
      </div>

      {rowBars.map((bars, rowIdx) => (
        <div
          key={rowIdx}
          className="grid border-b border-border"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div className="flex items-center gap-2.5 border-r border-border px-3.5 py-2.5">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-[13px] w-24" />
              <Skeleton className="h-[11px] w-14" />
            </div>
          </div>
          <div
            className="relative"
            style={{ gridColumn: "2 / -1", minHeight: `${rowHeight}px` }}
          >
            {bars.map(([start, span], i) => (
              <Skeleton
                key={i}
                className="absolute h-[46px] rounded-md"
                style={{
                  left: `${(start / dayCount) * 100}%`,
                  width: `${(span / dayCount) * 100}%`,
                  top: `${PLANNER_ROW_PAD_PX}px`,
                }}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Filler — mirrors the board's full-height frame */}
      <div className="grid flex-1" style={{ gridTemplateColumns: gridTemplate }}>
        <div className="border-r border-border" />
      </div>
    </div>
  )
}

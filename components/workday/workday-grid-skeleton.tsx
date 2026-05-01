import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { WORKDAY_HEIGHT_PX } from "@/lib/workday"

export function WorkdayGridSkeleton({ dayCount = 5 }: { dayCount?: number }) {
  const days = Array.from({ length: dayCount }, (_, i) => i)
  const gridTemplate = `200px repeat(${dayCount}, minmax(168px, 1fr))`

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="grid"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <div className="px-[14px] pb-[10px] pt-[6px]" aria-hidden />
        {days.map((d) => (
          <div
            key={d}
            className="flex flex-col gap-0.5 px-[14px] pb-[10px] pt-[6px]"
          >
            <Skeleton className="h-[11.5px] w-8" />
            <Skeleton className="h-[18px] w-6" />
          </div>
        ))}
      </div>

      {[1, 2, 3].map((row) => (
        <div
          key={row}
          className="grid overflow-hidden rounded-lg border border-border bg-background"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div
            className="flex flex-col gap-4 border-r border-border bg-muted/40 px-4 py-[18px]"
            style={{ minHeight: `${WORKDAY_HEIGHT_PX + 64}px` }}
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-[14px] w-24" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
            <div className="mt-auto flex flex-col gap-1">
              <Skeleton className="h-[22px] w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          {days.map((d) => (
            <div
              key={d}
              className={cn(
                "flex flex-col border-r border-border px-[10px] pt-[14px] pb-[12px] last:border-r-0",
                d >= 5 && "bg-muted/30",
              )}
              style={{ minHeight: `${WORKDAY_HEIGHT_PX + 44}px` }}
            >
              <div
                className="flex flex-col gap-1"
                style={{ minHeight: `${WORKDAY_HEIGHT_PX}px` }}
              >
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
              <div className="flex items-center justify-between border-t border-border pt-2.5">
                <Skeleton className="h-3 w-8" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

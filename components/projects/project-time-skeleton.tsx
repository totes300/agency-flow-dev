import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading state for the project detail "Time" tab. Mirrors the actual
 * layout: stats row, then a single toolbar row (search + filter +
 * group by + right-aligned action buttons), then the table.
 */
export function ProjectTimeSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {/* Stats row — 4 pairs to cover both T&M (4) and Fixed/Retainer (3). */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-baseline gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* Toolbar: search + filter + group by + right-aligned actions. */}
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-full max-w-xs" />
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-9 w-[150px]" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-9 w-44" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Table rows */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-md" />
        ))}
      </div>
    </div>
  )
}

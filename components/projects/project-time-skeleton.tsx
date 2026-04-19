import { Skeleton } from "@/components/ui/skeleton"

/**
 * Loading state for the project detail "Time" tab. Mirrors the filter bar
 * (member select + billing status select + search) and the time-entry table.
 * Filter-bar skeleton widths match `project-time-filters.tsx`'s
 * `size="sm"` select triggers (h-9).
 */
export function ProjectTimeSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-[200px]" />
        <Skeleton className="h-9 w-[220px]" />
        <Skeleton className="ml-auto h-9 w-full max-w-xs" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-11 rounded-md" />
        ))}
      </div>
    </div>
  )
}

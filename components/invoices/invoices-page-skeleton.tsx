import { Skeleton } from "@/components/ui/skeleton"

/**
 * Mirrors the real layout: toolbar (tabs · filter · search) · summary strip
 * · list rows. Same column counts and shapes as the live components so the
 * first paint doesn't reflow once data loads.
 */
export function InvoicesPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar: tabs · filter · search */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-3 border-b border-border/50 pb-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-16" />
          ))}
        </div>
        <Skeleton className="h-8 w-20" />
        <Skeleton className="ml-auto h-9 w-full max-w-xs" />
      </div>

      {/* Summary strip */}
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>

      {/* List rows */}
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-md" />
        ))}
      </div>
    </div>
  )
}


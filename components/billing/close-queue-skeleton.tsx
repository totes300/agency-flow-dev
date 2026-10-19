import { Skeleton } from "@/components/ui/skeleton"

/**
 * Mirrors the Close queue's open table: a header hairline and a few
 * single-line rows (period, project, client, status, time, amount), so first
 * paint matches the resolved layout.
 */
export function CloseQueueSkeleton() {
  return (
    <div className="flex flex-col">
      <div className="flex h-10 items-center border-b px-3">
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="divide-y border-b">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex h-12 items-center gap-6 px-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1 max-w-64" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="hidden h-5 w-24 rounded-[5px] sm:block" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

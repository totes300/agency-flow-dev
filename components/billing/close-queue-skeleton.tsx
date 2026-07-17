import { Skeleton } from "@/components/ui/skeleton"

/**
 * Content-aware skeleton mirroring the Close queue: two month section headers
 * each followed by a bordered card of single-line rows, so first paint matches
 * the resolved layout (loading → empty → content order, PRD Definition of done).
 */
export function CloseQueueSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      {[0, 1].map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="ml-auto h-4 w-16" />
          </div>
          <div className="divide-y rounded-lg border">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex h-12 items-center gap-3 px-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="hidden h-3 w-16 sm:block" />
                <Skeleton className="ml-auto h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-[4.5rem] rounded-md" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

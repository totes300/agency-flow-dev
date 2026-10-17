import { Skeleton } from "@/components/ui/skeleton"

/**
 * Mirrors the Close queue's single bordered table: a header row and a few
 * two-line project rows with time, amount and an action slot, so first paint
 * matches the resolved layout.
 */
export function CloseQueueSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex h-10 items-center border-b px-3">
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="divide-y">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex h-16 items-center gap-4 px-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-28 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

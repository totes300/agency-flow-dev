import { Skeleton } from "@/components/ui/skeleton"

/**
 * Content-aware skeleton for the whole workspace while auth boots: mirrors
 * the rail (switch, two labelled sections with icon+text rows) and the
 * center pane's empty-state shape (icon square + heading + body line).
 */
export function WorkspaceSkeleton() {
  return (
    <div className="flex h-full w-full">
      <aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
        <div className="p-2">
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
        <div className="flex flex-col gap-4 px-2">
          <div>
            <div className="flex h-8 items-center px-2">
              <Skeleton className="h-3 w-14" />
            </div>
            <RailRowSkeletons count={2} />
          </div>
          <div>
            <div className="flex h-8 items-center px-2">
              <Skeleton className="h-3 w-24" />
            </div>
            <RailRowSkeletons count={4} />
          </div>
        </div>
      </aside>
      <main className="flex flex-1 flex-col items-center justify-center gap-5">
        <Skeleton className="size-14 rounded-2xl" />
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
      </main>
    </div>
  )
}

function RailRowSkeletons({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-4 flex-1" />
        </div>
      ))}
    </div>
  )
}

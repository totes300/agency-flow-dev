import { Skeleton } from "@/components/ui/skeleton"

/**
 * Content-aware skeleton mirroring the Close workspace: back nav + title, the
 * inline budget summary line, then one task group with a few lean rows. Matches
 * the real layout so first paint doesn't reflow (loading → empty → content).
 */
export function CloseWorkspaceSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-56" />
        </div>
        <Skeleton className="h-8 w-40" />
      </div>

      {/* Budget summary line */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>

      {/* One task group */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 border-b py-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-12" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  )
}

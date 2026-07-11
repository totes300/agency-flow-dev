import { Skeleton } from "@/components/ui/skeleton"

// Center-pane route skeleton (the rail is layout chrome and stays live).
// Mirrors the workspace empty state: icon square + heading + body line.
export default function AgentsLoading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5">
      <Skeleton className="size-14 rounded-2xl" />
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  )
}

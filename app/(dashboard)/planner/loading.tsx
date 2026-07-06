import { Skeleton } from "@/components/ui/skeleton"
import { PlannerGridSkeleton } from "@/components/planner/planner-grid-skeleton"

export default function PlannerLoading() {
  return (
    <div className="-mx-4 -mb-6 -mt-6 flex min-h-0 flex-1 flex-col md:-mx-12">
      {/* Toolbar: title, week nav, range, zoom, member filter */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 md:px-6">
        <Skeleton className="h-[18px] w-16" />
        <div className="flex items-center gap-0.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="size-7 rounded-md" />
        </div>
        <Skeleton className="h-[16px] w-36" />
        <Skeleton className="h-[29px] w-[130px] rounded-lg" />
        <Skeleton className="ml-auto h-8 w-28 rounded-md" />
      </div>
      <div className="min-h-0 flex-1">
        <PlannerGridSkeleton />
      </div>
    </div>
  )
}

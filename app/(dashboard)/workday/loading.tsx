import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { WorkdayGridSkeleton } from "@/components/workday/workday-grid-skeleton"

export default function WorkdayLoading() {
  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-[28px] w-32" />
          <Skeleton className="h-[13px] w-64" />
        </div>
        <div className="flex items-center">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-8 w-40 rounded-md mx-1" />
          <Skeleton className="size-8 rounded-md" />
          <Separator orientation="vertical" className="mx-1 !h-[18px]" />
          <Skeleton className="h-8 w-32 rounded-md" />
          <Separator orientation="vertical" className="mx-1 !h-[18px]" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </header>
      <WorkdayGridSkeleton />
    </div>
  )
}

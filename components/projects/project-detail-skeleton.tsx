import { Skeleton } from "@/components/ui/skeleton"

export function ProjectDetailSkeleton() {
  return (
    <div data-full-bleed aria-busy="true" aria-label="Loading project" className="flex flex-col border-t border-border/60">
      <div className="flex flex-col gap-2 px-6 py-4">
        <Skeleton className="h-5 w-56" /><Skeleton className="h-4 w-40" />
      </div>
      <div className="flex gap-2 border-b border-border/60 px-4 py-2">
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-7 w-20 rounded-full" />)}
      </div>
      <div className="flex flex-col gap-6 p-6">
        <Skeleton className="h-52 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-lg" />
      </div>
    </div>
  )
}

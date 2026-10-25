import { Skeleton } from "@/components/ui/skeleton"

export function ClientDetailSkeleton() {
  return (
    <div
      data-full-bleed
      aria-busy="true"
      aria-label="Loading client"
      className="border-t border-border/60"
    >
      <div className="flex items-center gap-3 border-b border-border/60 px-6 py-4">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid gap-8 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  )
}

"use client"

import { Skeleton } from "@/components/ui/skeleton"

function RowSkeleton({ withStatusBadge = false }: { withStatusBadge?: boolean }) {
  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {/* Line 1: checkbox + title + timer */}
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-4 rounded-full" />
        <Skeleton className="h-4 flex-1 max-w-[260px]" />
        <Skeleton className="ml-auto size-5 rounded-full" />
      </div>
      {/* Line 2: metadata (Today rows lead with the status badge) */}
      <div className="flex items-center gap-2 pl-[26px]">
        {withStatusBadge && <Skeleton className="h-4 w-20 rounded-[5px]" />}
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-14 rounded-full" />
        <Skeleton className="h-3 w-12" />
        <span className="flex-1" />
        <Skeleton className="size-4 rounded-full" />
      </div>
    </div>
  )
}

function GroupSkeleton({
  rows = 4,
  isToday = false,
}: {
  rows?: number
  isToday?: boolean
}) {
  return (
    <div className="mt-5">
      {/* Group header (Today: sun icon + label + count + muted hint) */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Skeleton className="size-3.5 rounded-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3.5 w-5" />
        {isToday && <Skeleton className="h-3 w-36" />}
      </div>
      {/* Earlier subsection header (Today group only) */}
      {isToday && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 pl-9">
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton className="h-3 w-16" />
        </div>
      )}
      {/* Task rows */}
      {Array.from({ length: rows }, (_, i) => (
        <RowSkeleton key={i} withStatusBadge={isToday} />
      ))}
      {/* Inline add */}
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        <Skeleton className="size-3 rounded-sm" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  )
}

export function MyTasksSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-5 w-14" />
        </div>
      </div>
      {/* Groups: Today first, then status groups */}
      <GroupSkeleton rows={3} isToday />
      <GroupSkeleton rows={4} />
      <GroupSkeleton rows={2} />
    </div>
  )
}

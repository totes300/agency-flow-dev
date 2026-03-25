"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { TASK_GRID_COLS, TASK_TABLE_MIN_W } from "@/components/tasks/tasks-table"

export function TasksListSkeleton() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-5 w-6" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between border-b pb-0">
        <div className="flex items-center gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="my-2.5 mx-1 h-5 w-16 rounded-md" />
          ))}
        </div>
        <div className="flex items-center gap-2 pb-1">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <div className={TASK_TABLE_MIN_W}>
          {/* Column headers */}
          <div className={`grid ${TASK_GRID_COLS} items-center px-2 py-1`}>
            <div />
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-8" />
            <div />
          </div>

          {/* Task rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`grid ${TASK_GRID_COLS} items-center border-b border-border/50 px-2 py-2.5`}
            >
              <Skeleton className="mx-auto size-4 rounded-full" />
              <div className="space-y-1.5 px-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="flex items-center gap-2.5 px-1">
                <Skeleton className="size-3.5 rounded-full" />
                <Skeleton className="h-3 w-8 rounded" />
              </div>
              <Skeleton className="mx-1 h-6 w-20 rounded" />
              <Skeleton className="mx-1 h-6 w-14 rounded" />
              <div className="space-y-1 px-1">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="mx-auto size-6 rounded-full" />
              <Skeleton className="mx-1 h-3.5 w-12" />
              <Skeleton className="mx-1 h-3.5 w-10" />
              <Skeleton className="mx-auto size-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

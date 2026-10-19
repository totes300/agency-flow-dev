import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

/**
 * The task view fills the app shell's inset panel (U1): full bleed
 * (`data-full-bleed` drops the layout padding), below the 3rem header; on
 * desktop the inset panel sits 0.5rem off each viewport edge.
 */
export const TASK_VIEW_PANEL_CLASS =
  "flex h-[calc(100svh-3rem)] min-h-[28rem] w-full flex-col overflow-hidden border-t border-border/60 bg-background md:h-[calc(100svh-4rem)]"

/** The task view inside another page (the project Tasks tab): a bordered panel below the page header. */
export const TASK_VIEW_EMBEDDED_PANEL_CLASS =
  "flex h-[calc(100svh-15rem)] min-h-[28rem] w-full flex-col overflow-hidden rounded-lg border border-border bg-background"

/** Table rows only (inside a loaded panel). */
export function TaskTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      <div className="h-9 border-b border-border/60" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-3 border-b border-border/60 pr-3 pl-10">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className={cn("h-3.5", i % 3 === 0 ? "w-72" : i % 3 === 1 ? "w-56" : "w-64")} />
          <span className="flex-1" />
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-12" />
        </div>
      ))}
    </div>
  )
}

/** Full panel placeholder (route `loading.tsx` and first paint). */
export function TaskViewSkeleton() {
  return (
    <div className={TASK_VIEW_PANEL_CLASS} data-full-bleed aria-busy="true">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/60 px-3">
        <Skeleton className="h-7 w-16 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>
      <TaskTableSkeleton />
    </div>
  )
}

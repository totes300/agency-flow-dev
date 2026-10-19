import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { TASK_VIEW_PANEL_CLASS } from "@/components/task-view/task-view-skeleton"

/** The Triage panel's first paint: the list column and the conversation (B8b). */
export function TriageSkeleton() {
  return (
    <div className={cn(TASK_VIEW_PANEL_CLASS, "flex-row")} data-full-bleed aria-busy="true">
      <div className="flex w-[296px] shrink-0 flex-col gap-1 border-r border-border/60 bg-muted/30 px-2.5 max-md:w-full">
        <div className="flex h-12 items-center">
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5 py-2.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col max-md:hidden">
        <div className="flex h-12 items-center border-b border-border/60 px-4">
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </div>
  )
}

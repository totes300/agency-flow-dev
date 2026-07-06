"use client"

import { SunIcon, PartyPopperIcon } from "lucide-react"

/** Shown when there are no tasks at all (no groups with content). */
export function MyTasksEmptyState() {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <SunIcon className="size-10 text-muted-foreground/30" />
      <div>
        <p className="text-sm font-medium">All clear for today</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          No tasks scheduled. Ask your PM to queue work, or add one yourself.
        </p>
      </div>
    </div>
  )
}

/**
 * Shown inside the Today group when nothing is planned for today yet.
 * Teaches both gestures: the sun icon and Planner scheduling.
 */
export function TodayEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <SunIcon className="size-8 text-muted-foreground/30" />
      <p className="text-sm font-medium">Nothing planned for today</p>
      <p className="max-w-sm text-xs text-muted-foreground/60">
        Add a task with the sun icon, or schedule it in the Planner — anything
        planned for today lands here automatically.
      </p>
    </div>
  )
}

/** Shown inside the Today group when all tasks have been completed. */
export function TodayAllDoneState({
  completedCount,
}: {
  completedCount: number
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <PartyPopperIcon className="size-8 text-primary/70" />
      <p className="text-sm font-medium text-primary">
        All done for today!
      </p>
      {completedCount > 0 && (
        <p className="text-xs text-muted-foreground/50">
          {completedCount} {completedCount === 1 ? "task" : "tasks"} completed
        </p>
      )}
    </div>
  )
}

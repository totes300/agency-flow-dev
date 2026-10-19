"use client"

import { ArrowUpRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { CELL_PRIMARY } from "@/lib/table-tokens"

/**
 * Clickable task title inside a table row — opens the task detail
 * (?detail=taskId drawer/modal). One shared affordance everywhere a task
 * name appears in a list: quiet title, hover reveals a small ↗ hint,
 * click never bubbles to the row (rows keep their own semantics, e.g.
 * selection on the project Time tab).
 */
export function TaskTitleButton({
  title,
  note,
  onClick,
  className,
}: {
  title: string
  /** Optional muted second line (e.g. time-entry note). */
  note?: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "group/task-open block min-w-0 max-w-full cursor-pointer rounded-sm text-left",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            CELL_PRIMARY,
            "min-w-0 truncate transition-colors group-hover/task-open:text-foreground/70",
          )}
        >
          {title}
        </span>
        <ArrowUpRightIcon
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/task-open:opacity-100"
        />
      </span>
      {note && (
        <span className="block truncate text-xs text-muted-foreground">
          {note}
        </span>
      )}
    </button>
  )
}

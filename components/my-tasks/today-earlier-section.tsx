"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { ChevronDownIcon, ChevronRightIcon, SunIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import { StatusBadge } from "@/components/status-badge"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { getClientDisplayName } from "@/lib/format"
import type { TaskWithJoins } from "@/convex/lib/task_helpers"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * "Earlier" — planned-but-unfinished leftovers from the last 14 days,
 * nested inside the Today group. Expanded by default so the morning starts
 * by settling yesterday (move or let go); never auto-carried. "Move to
 * today" creates a FRESH one-day segment — the old segment stays as
 * history, so the record of what was planned stays honest.
 */
export function TodayEarlierSection({
  tasks,
  onOpenDetail,
}: {
  tasks: TaskWithJoins[]
  onOpenDetail?: (taskId: string) => void
}) {
  const [open, setOpen] = useState(true)
  const addToToday = useMutation(api.planner.addToToday)

  if (tasks.length === 0) return null

  const handleMoveToToday = (taskId: string) => {
    void addToToday({ taskId: taskId as Id<"tasks"> })
      .then(() => toast.success("Moved to today — yesterday's plan stays in the record"))
      .catch((err: unknown) => toastError(err, "Failed to move to today"))
  }

  return (
    <li className="mt-1 list-none">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 pl-9 text-xs font-medium text-muted-foreground/60 hover:text-muted-foreground"
      >
        {open ? (
          <ChevronDownIcon className="size-3" />
        ) : (
          <ChevronRightIcon className="size-3" />
        )}
        <span>Earlier</span>
        <span className="font-normal text-muted-foreground/50">· {tasks.length}</span>
      </button>

      {open && (
        <ul className="list-none">
          {tasks.map((task) => (
            <li
              key={task._id}
              className="group/earlier flex w-full list-none items-start rounded-lg transition-colors hover:bg-muted/70"
            >
              <span className="size-6 shrink-0" aria-hidden />
              <div
                role="button"
                tabIndex={0}
                onClick={() => onOpenDetail?.(task._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpenDetail?.(task._id)
                  }
                }}
                className={cn(
                  "relative flex min-w-0 flex-1 cursor-pointer flex-col px-3 py-2 opacity-60 transition-opacity",
                  "after:pointer-events-none after:absolute after:bottom-0 after:left-3 after:right-3 after:border-b after:border-border/40 after:content-['']",
                  "group-hover/earlier:opacity-90",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="truncate text-sm font-medium">{task.title}</span>
                  <span
                    className="ml-auto flex shrink-0 items-center"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => handleMoveToToday(task._id)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground/70 opacity-0 outline-hidden transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/earlier:opacity-100 pointer-coarse:opacity-100"
                    >
                      <SunIcon className="size-3.5" />
                      Move to today
                    </button>
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                  {task.status ? (
                    <StatusBadge
                      name={task.status.name}
                      color={task.status.color}
                      type={task.status.type}
                      className="shrink-0"
                    />
                  ) : null}
                  {task.project ? (
                    <span className="truncate">
                      {task.client ? `${getClientDisplayName(task.client)} · ` : ""}
                      {task.project.name}
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

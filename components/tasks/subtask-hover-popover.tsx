"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { UserAvatar } from "@/components/user-avatar"
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export function SubtaskHoverPopover({
  taskId,
  done,
  total,
  onOpenDetail,
  children,
}: {
  taskId: Id<"tasks">
  done: number
  total: number
  onOpenDetail?: (taskId: string) => void
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const data = useQuery(
    api.tasks.subtaskPreview,
    isOpen ? { taskId } : "skip",
  )

  const progress = total > 0 ? (done / total) * 100 : 0

  return (
    <HoverCard openDelay={250} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-0 hidden md:block">
        <div className="p-3 space-y-2.5">
          {/* Progress header */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {done} of {total} completed
            </p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/60 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Subtask list */}
          {!data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="size-3.5 rounded-sm bg-muted animate-pulse" />
                  <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No subtasks</p>
          ) : (
            <div className="space-y-1.5">
              {data.map((subtask) => {
                const isDone = subtask.statusType === "done"
                return (
                  <div key={subtask._id} className="flex items-center gap-2">
                    <span className={cn(
                      "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                      isDone
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : "border-muted-foreground/30",
                    )}>
                      {isDone && <CheckIcon className="size-2.5" />}
                    </span>
                    <span className={cn(
                      "flex-1 truncate text-xs",
                      isDone && "line-through text-muted-foreground/60",
                    )}>
                      {subtask.title}
                    </span>
                    {subtask.assignee && (
                      <UserAvatar
                        name={subtask.assignee.name}
                        imageUrl={subtask.assignee.imageUrl}
                        className="size-4 text-[7px]"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            View all subtasks
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

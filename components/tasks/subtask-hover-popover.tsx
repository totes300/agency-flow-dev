"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
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

  return (
    <HoverCard openDelay={250} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[280px] p-0 hidden md:block">
        {/* Header */}
        <div className="flex items-baseline justify-between px-4 pt-3.5 pb-2">
          <p className="text-xs font-medium text-muted-foreground">Subtasks</p>
          <p className="text-[11px] tabular-nums text-muted-foreground/60">
            {done}<span className="opacity-50">/{total}</span>
          </p>
        </div>

        {/* Subtask list */}
        <div className="max-h-[240px] overflow-y-auto">
          {!data ? (
            <div className="px-4 pb-3 space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="size-3.5 rounded bg-muted animate-pulse shrink-0" />
                  <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="px-4 pb-3 text-xs text-muted-foreground/60">No subtasks</p>
          ) : (
            <div className="divide-y divide-border/30">
              {data.map((subtask) => {
                const isDone = subtask.statusType === "done"
                return (
                  <div key={subtask._id} className="flex items-center gap-2.5 px-4 py-2">
                    <Checkbox
                      checked={isDone}
                      className="pointer-events-none"
                    />
                    <span className={cn(
                      "flex-1 truncate text-[13px]",
                      isDone ? "line-through text-muted-foreground/50" : "text-foreground/80",
                    )}>
                      {subtask.title}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-4 py-2.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            View all subtasks
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

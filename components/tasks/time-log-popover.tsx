"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { formatDuration } from "@/lib/duration"
import { TimeEntriesList } from "@/components/time/time-entries-list"
import { TimeLogForm } from "@/components/tasks/time-log-form"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export function TimeLogPopover({
  taskId,
  isBillable,
  children,
  align = "start",
  tooltipLabel,
  tooltipSide = "top",
}: {
  taskId: Id<"tasks">
  isBillable: boolean
  children: React.ReactNode
  align?: "start" | "center" | "end"
  tooltipLabel?: string
  tooltipSide?: "top" | "bottom" | "left" | "right"
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")

  const isAdmin = membership?.role === "org:admin"

  const [open, setOpen] = useState(false)
  const [entriesExpanded, setEntriesExpanded] = useState(false)

  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated && open ? { taskId } : "skip",
  )
  const totalMinutes = entries?.reduce((sum, e) => sum + e.durationMinutes, 0) ?? 0

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        // Collapse the entries section when closing so the next open starts
        // clean. The form itself unmounts with PopoverContent so its state
        // resets via remount — no explicit reset needed.
        if (!o) setEntriesExpanded(false)
      }}
    >
      {tooltipLabel ? (
        <Tooltip open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              {children}
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide} sideOffset={4}>{tooltipLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
      )}
      <PopoverContent
        className="w-[340px] p-0"
        align={align}
        sideOffset={4}
      >
        <TimeLogForm
          taskId={taskId}
          isBillable={isBillable}
          autoFocus
          onStartTimer={() => setOpen(false)}
        />

        {/* Time entries section — same surface, hairline divider, refined density */}
        {entries && entries.length > 0 && (
          <div className="flex flex-col border-t border-border/40 px-4 py-2.5">
            <button
              type="button"
              onClick={() => setEntriesExpanded((prev) => !prev)}
              className="flex items-center justify-between"
              aria-expanded={entriesExpanded}
            >
              <div className="flex items-center gap-1.5">
                <ChevronDownIcon
                  className={cn(
                    "size-3 text-muted-foreground transition-transform duration-150",
                    !entriesExpanded && "-rotate-90",
                  )}
                  strokeWidth={2}
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Time entries ({entries.length})
                </span>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                {formatDuration(totalMinutes)}
              </span>
            </button>
            {entriesExpanded && (
              <div className="mt-2.5">
                <TimeEntriesList
                  entries={entries}
                  isAdmin={isAdmin}
                  currentUserId={currentUser?._id}
                />
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

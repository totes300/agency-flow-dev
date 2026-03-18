"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { formatDuration } from "@/lib/duration"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export function TimerTodaySection() {
  const { isAuthenticated } = useConvexAuth()
  const entries = useQuery(api.timeEntries.listToday, isAuthenticated ? {} : "skip")
  const [expanded, setExpanded] = useState(true)

  if (!entries || entries.length === 0) return null

  const totalMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0)

  return (
    <>
      <div className="h-px bg-border" />
      <div className="flex flex-col px-5 py-3">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex items-center justify-between"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-1.5">
            <ChevronRightIcon
              className={cn(
                "size-2.5 text-muted-foreground transition-transform duration-150",
                expanded && "rotate-90",
              )}
              strokeWidth={2}
            />
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Today
            </span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {formatDuration(totalMinutes)}
          </span>
        </button>

        {expanded && (
          <div className="mt-2.5 flex flex-col gap-2.5">
            {entries.map((entry) => (
              <div key={entry._id} className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-foreground">{entry.taskName}</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDuration(entry.durationMinutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

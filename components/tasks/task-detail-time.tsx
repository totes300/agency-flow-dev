"use client"

import { useState, useMemo } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { api } from "@/convex/_generated/api"
import { TimeEntriesTable } from "@/components/tasks/time-entries-table"
import { TimeLogForm } from "@/components/tasks/time-log-form"
import { Button } from "@/components/ui/button"

import { formatMinutesDisplay } from "@/lib/duration"
import { getWeekBounds } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Types ──────────────────────────────────────────────────────────────────────

type TimeRange = "this_week" | "last_week" | "all"

const INITIAL_VISIBLE = 10

const RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "all", label: "All" },
]

// ─── Component ──────────────────────────────────────────────────────────────────

export function TaskDetailTime({
  taskId,
  isBillable,
}: {
  taskId: Id<"tasks">
  isBillable: boolean
}) {
  const { isAuthenticated } = useConvexAuth()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const entries = useQuery(
    api.timeEntries.listByTask,
    isAuthenticated ? { taskId } : "skip",
  )

  // ─── Filter + pagination ────────────────────────────────────────────────────
  const [range, setRange] = useState<TimeRange>("this_week")
  const [showAll, setShowAll] = useState(false)

  const filteredEntries = useMemo(() => {
    if (!entries) return []
    if (range === "all") return entries
    const bounds = range === "this_week" ? getWeekBounds(0) : getWeekBounds(-1)
    return entries.filter((e) => e.date >= bounds.start && e.date <= bounds.end)
  }, [entries, range])

  const visibleEntries = showAll ? filteredEntries : filteredEntries.slice(0, INITIAL_VISIBLE)
  const hasMore = filteredEntries.length > INITIAL_VISIBLE && !showAll
  const filteredTotal = filteredEntries.reduce((sum, e) => sum + e.durationMinutes, 0)

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* ── Shared time-log form (same component as the header popover) ────── */}
      <div className="-mx-4 max-w-[420px]">
        <TimeLogForm taskId={taskId} isBillable={isBillable} variant="embedded" />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
          {RANGE_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setRange(key); setShowAll(false) }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-all",
                range === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"} ·{" "}
          <span className="font-semibold text-foreground">
            {formatMinutesDisplay(filteredTotal)}
          </span>
        </span>
      </div>

      {/* ── Entries table ──────────────────────────────────────────────────── */}
      {visibleEntries.length > 0 ? (
        <TimeEntriesTable
          entries={visibleEntries}
          isAdmin={isAdmin ?? false}
          currentUserId={currentUser?._id}
        />
      ) : entries ? (
        <div className="flex items-center justify-center rounded-lg border border-border/40 py-10 text-sm text-muted-foreground/50">
          {range === "all" ? "No time entries yet" : "No entries this period"}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[38px] animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      )}

      {/* Show more */}
      {hasMore && (
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowAll(true)}
          className="w-full text-xs text-muted-foreground"
        >
          Show all {filteredEntries.length} entries
        </Button>
      )}
    </div>
  )
}

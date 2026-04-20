"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import {
  ProjectTimeTable,
  type TimeEntryRow,
  type ProjectTimeTableProps,
} from "@/components/projects/project-time-table"
import { formatHoursCompact } from "@/lib/format"
import type { Grouping } from "@/lib/date-buckets"
import {
  groupTimeEntries,
  type TimeEntryGroupAxis,
} from "@/lib/time-entry-grouping"
import { CalendarIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type SharedTableProps = Omit<ProjectTimeTableProps, "entries">

export function ProjectTimeGrouped({
  entries,
  grouping,
  // `createdAtMap` lets within-group sort mirror the flat sort (date desc,
  // then createdAt desc) — matching what the backend returns.
  createdAtMap,
  ...tableProps
}: {
  entries: TimeEntryRow[]
  grouping: Exclude<Grouping, "none">
  createdAtMap: Map<string, number>
} & SharedTableProps) {
  const { timezone } = tableProps
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Reset collapse state whenever the grouping axis changes — old keys are
  // meaningless under a new axis.
  const [lastGrouping, setLastGrouping] = useState(grouping)
  if (lastGrouping !== grouping) {
    setLastGrouping(grouping)
    setCollapsed(new Set())
  }

  const groups = useMemo(
    () => groupTimeEntries(entries, grouping as TimeEntryGroupAxis, timezone, createdAtMap),
    [entries, grouping, timezone, createdAtMap],
  )

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key)
        return (
          <div key={g.key} className="flex flex-col">
            <GroupHeader
              label={g.label}
              icon={g.icon}
              totalMinutes={g.totalMinutes}
              entryCount={g.entries.length}
              collapsed={isCollapsed}
              onToggle={() => toggleGroup(g.key)}
            />
            {!isCollapsed && (
              <div className="mt-1">
                <ProjectTimeTable entries={g.entries} {...tableProps} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function GroupHeader({
  label,
  icon,
  totalMinutes,
  entryCount,
  collapsed,
  onToggle,
}: {
  label: string
  icon: "calendar" | null
  totalMinutes: number
  entryCount: number
  collapsed: boolean
  onToggle: () => void
}) {
  const Caret = collapsed ? ChevronRightIcon : ChevronDownIcon
  return (
    <Button
      type="button"
      variant="ghost"
      aria-expanded={!collapsed}
      aria-label={`Toggle ${label} entries`}
      onClick={onToggle}
      className={cn(
        "group h-auto w-full select-none justify-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm font-normal hover:bg-muted/50",
      )}
    >
      <Caret aria-hidden className="size-3.5 text-muted-foreground" />
      {icon === "calendar" && (
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <CalendarIcon aria-hidden className="size-3.5" />
        </span>
      )}
      <span className="font-medium">{label}</span>
      <span className="text-xs text-muted-foreground">
        · {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </span>
      <span className="ml-auto tabular-nums text-sm font-medium">
        {formatHoursCompact(totalMinutes)}
      </span>
    </Button>
  )
}


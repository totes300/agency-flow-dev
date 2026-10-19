"use client"

import { useState, useMemo } from "react"
import {
  ProjectTimeTable,
  type TimeEntryRow,
  type ProjectTimeTableProps,
} from "@/components/projects/project-time-table"
import { TimeEntryGroupHeader } from "@/components/projects/time-entry-group-header"
import type { Grouping } from "@/lib/date-buckets"
import {
  groupTimeEntries,
  type TimeEntryGroupAxis,
} from "@/lib/time-entry-grouping"
import { deriveGroupReference } from "@/lib/group-reference"

type SharedTableProps = Omit<ProjectTimeTableProps<TimeEntryRow>, "entries">

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
        // Slice 4 — the day-group header carries the "consolidated"
        // reference (period range or invoice number) when every billable
        // entry agrees. Mixed groups → null, falling back to per-row
        // badges. Recomputed each render (cheap — pure pass over the
        // group's entries).
        const groupRef = deriveGroupReference(g.entries)
        return (
          <div key={g.key} className="flex flex-col">
            <TimeEntryGroupHeader
              label={g.label}
              icon={g.icon}
              totalMinutes={g.totalMinutes}
              entryCount={g.entries.length}
              groupRef={groupRef}
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



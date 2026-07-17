"use client"

import { useMemo, useState } from "react"
import { CornerUpRightIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { CloseWorkspaceRow } from "@/convex/close"
import {
  compareCloseRows,
  deriveCloseGroupMeta,
  type CloseGroupMeta,
} from "@/convex/lib/closeGroups"
import {
  ProjectTimeTable,
  type CloseTableConfig,
} from "@/components/projects/project-time-table"
import { TimeEntryGroupHeader } from "@/components/projects/time-entry-group-header"
import { CarriedLabel } from "@/components/carried-label"
import { Button } from "@/components/ui/button"
import {
  groupTimeEntries,
  type TimeEntryGroupAxis,
} from "@/lib/time-entry-grouping"

// The close ledger has no row selection — stable no-op table props.
const NO_SELECTION = new Set<string>()
const noop = () => {}
// Rows are re-sorted with `compareCloseRows` after grouping, so the
// grouping helper's createdAt tiebreaker is never consulted.
const EMPTY_CREATED_MAP = new Map<string, number>()

/**
 * Grouped Close ledger — the close-owned sibling of `ProjectTimeGrouped`.
 *
 * Composes the same primitives (`groupTimeEntries`, `TimeEntryGroupHeader`,
 * `ProjectTimeTable` in close mode) but owns the close-only group semantics,
 * all axis-agnostic (task, day, week, month, member):
 *
 *   - subtotals & counts cover IN-SCOPE rows only (skipped rows render but
 *     are leaving the period — they must not inflate what the owner
 *     sanity-checks against the budget line);
 *   - hover "Skip all → <next>" on the header skips the group's in-scope
 *     entries;
 *   - majority-carried promotion lifts the "carried · May 2026" label to the
 *     header and suppresses the per-row copies;
 *   - a fully-skipped group collapses to a single undo line;
 *   - `revealEntryId` force-expands the group holding that entry so a
 *     review-checklist jump can scroll to a row inside a collapsed group.
 *
 * Group order: chronological ascending on date axes (a close reads like the
 * story of the month — same direction as the rows), alpha on member/task.
 */
export function CloseEntryGroups({
  entries,
  grouping,
  timezone,
  showAmounts,
  currency,
  projectId,
  currentUserId,
  onEdit,
  onOpenTask,
  closeMode,
  revealEntryId,
}: {
  entries: CloseWorkspaceRow[]
  grouping: TimeEntryGroupAxis
  timezone: string
  showAmounts: boolean
  currency: string
  projectId: Id<"projects">
  currentUserId: Id<"users"> | undefined
  onEdit: (entryId: Id<"timeEntries">) => void
  onOpenTask: (taskId: Id<"tasks">) => void
  /** Base close config — per-group tables add `hideCarriedLabels` on promotion. */
  closeMode: CloseTableConfig
  /** Entry a checklist jump is heading to — its group is force-expanded. */
  revealEntryId?: Id<"timeEntries"> | null
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // Reset collapse state whenever the grouping axis changes — old keys are
  // meaningless under a new axis. (Same pattern as ProjectTimeGrouped.)
  const [lastGrouping, setLastGrouping] = useState(grouping)
  if (lastGrouping !== grouping) {
    setLastGrouping(grouping)
    setCollapsed(new Set())
  }

  const groups = useMemo(() => {
    const raw = groupTimeEntries(entries, grouping, timezone, EMPTY_CREATED_MAP)
    // Date axes come back newest-first (Time-tab convention); a close review
    // reads oldest-first, matching the in-group row order.
    const ordered =
      grouping === "day" || grouping === "week" || grouping === "month"
        ? [...raw].reverse()
        : raw
    return ordered.map((g) => {
      const sorted = [...g.entries].sort(compareCloseRows)
      return { ...g, entries: sorted, meta: deriveCloseGroupMeta(sorted) }
    })
  }, [entries, grouping, timezone])

  // Checklist jump into a collapsed group — expand it (render-time state
  // adjustment, same pattern as the grouping reset above) so the row's DOM
  // node exists for the parent's scroll-and-flash effect. The group stays
  // expanded after the jump target clears.
  const [lastReveal, setLastReveal] = useState<Id<"timeEntries"> | null>(null)
  if (revealEntryId && revealEntryId !== lastReveal) {
    setLastReveal(revealEntryId)
    const target = groups.find((g) =>
      g.entries.some((e) => e._id === revealEntryId),
    )
    if (target && collapsed.has(target.key)) {
      const next = new Set(collapsed)
      next.delete(target.key)
      setCollapsed(next)
    }
  }

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
        if (g.meta.allSkipped) {
          return (
            <FullySkippedGroupLine
              key={g.key}
              label={g.label}
              skippedToLabel={g.entries[0]?.skippedToLabel ?? null}
              onUndoAll={() => closeMode.onUnskip(g.entries.map((e) => e._id))}
            />
          )
        }

        const promoted = g.meta.majorityCarried && g.meta.carriedShared !== null
        const inScopeIds = g.entries
          .filter((e) => !e.skipped)
          .map((e) => e._id)

        return (
          <div key={g.key} className="flex flex-col">
            <TimeEntryGroupHeader
              label={g.label}
              icon={g.icon}
              totalMinutes={g.meta.inScopeMinutes}
              entryCount={g.meta.inScopeCount}
              collapsed={collapsed.has(g.key)}
              onToggle={() => toggleGroup(g.key)}
              extras={
                <GroupExtras
                  meta={g.meta}
                  promoted={promoted}
                  inScopeIds={inScopeIds}
                  closeMode={closeMode}
                />
              }
            />
            {!collapsed.has(g.key) && (
              <div className="mt-1">
                <ProjectTimeTable
                  entries={g.entries}
                  selectedIds={NO_SELECTION}
                  onToggle={noop}
                  onSelectAllVisible={noop}
                  selectable={false}
                  showAmounts={showAmounts}
                  currency={currency}
                  timezone={timezone}
                  isAdmin
                  projectId={projectId}
                  currentUserId={currentUserId}
                  onEdit={onEdit}
                  onOpenTask={onOpenTask}
                  statusColumn={false}
                  closeMode={
                    promoted
                      ? { ...closeMode, hideCarriedLabels: true }
                      : closeMode
                  }
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Header slot: promoted carried label + hover "Skip all → <next>". */
function GroupExtras({
  meta,
  promoted,
  inScopeIds,
  closeMode,
}: {
  meta: CloseGroupMeta
  promoted: boolean
  inScopeIds: Id<"timeEntries">[]
  closeMode: CloseTableConfig
}) {
  return (
    <>
      {promoted && meta.carriedShared && (
        <CarriedLabel
          reason={meta.carriedShared.reason}
          monthLabel={meta.carriedShared.originMonthLabel}
        />
      )}
      {closeMode.nextPeriodLabel && inScopeIds.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          title={`Skip all → ${closeMode.nextPeriodLabel}`}
          onClick={() =>
            closeMode.onSkip(inScopeIds, closeMode.nextPeriodLabel!)
          }
        >
          <CornerUpRightIcon data-icon="inline-start" className="size-3.5" />
          Skip all
        </Button>
      )}
    </>
  )
}

/**
 * A group whose every entry was skipped out — one quiet line with Undo all
 * (PRD story 18), instead of a header + table full of muted rows.
 */
function FullySkippedGroupLine({
  label,
  skippedToLabel,
  onUndoAll,
}: {
  label: string
  skippedToLabel: string | null
  onUndoAll: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
      <span className="truncate font-medium">{label}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs">
        <CornerUpRightIcon aria-hidden className="size-3.5" />
        skipped → {skippedToLabel}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-2 text-xs text-primary"
        onClick={onUndoAll}
      >
        Undo all
      </Button>
    </div>
  )
}

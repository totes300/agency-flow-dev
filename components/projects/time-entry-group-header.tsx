"use client"

import { CalendarIcon, ChevronDownIcon, ChevronRightIcon, LockIcon } from "lucide-react"
import { formatHoursCompact } from "@/lib/format"
import type { GroupReference } from "@/lib/group-reference"
import { cn } from "@/lib/utils"

/**
 * Collapsible group header shared by the project Time tab's grouped view and
 * the Close workspace ledger: caret + label + entry count on the left, an
 * optional consolidated lock reference (period range / invoice number), an
 * optional `extras` slot, and the group's total hours right-aligned.
 *
 * Structure: the whole row is clickable (toggle), but the actual `<button>`
 * wraps only the caret + label so the `extras` slot can host its own
 * interactive controls (e.g. the Close workspace's "Skip all") without
 * nesting buttons — clicks inside `extras` never toggle the group.
 */
export function TimeEntryGroupHeader({
  label,
  icon,
  totalMinutes,
  entryCount,
  groupRef = null,
  collapsed,
  onToggle,
  extras,
}: {
  label: string
  icon: "calendar" | null
  totalMinutes: number
  entryCount: number
  /** Consolidated lock reference chip — omit/null to hide. */
  groupRef?: GroupReference
  collapsed: boolean
  onToggle: () => void
  /** Optional inline slot after the count (close: carried label, Skip all). */
  extras?: React.ReactNode
}) {
  const Caret = collapsed ? ChevronRightIcon : ChevronDownIcon
  return (
    <div
      onClick={onToggle}
      className={cn(
        "group flex w-full cursor-pointer select-none items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm transition-colors hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={`Toggle ${label} entries`}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
        className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Caret aria-hidden className="size-3.5 text-muted-foreground" />
        {icon === "calendar" && (
          <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
            <CalendarIcon aria-hidden className="size-3.5" />
          </span>
        )}
        <span className="font-medium">{label}</span>
      </button>
      <span className="text-xs text-muted-foreground">
        · {entryCount} {entryCount === 1 ? "entry" : "entries"}
      </span>
      {groupRef && (
        <span
          className="ml-2 inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          // Aria-label spells out the abbreviation for screen readers.
          aria-label={`This day's entries are ${groupRef.label}`}
        >
          <LockIcon aria-hidden className="size-3" />
          {groupRef.label}
        </span>
      )}
      {extras && (
        <span
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {extras}
        </span>
      )}
      <span className="ml-auto tabular-nums text-sm font-medium">
        {formatHoursCompact(totalMinutes)}
      </span>
    </div>
  )
}

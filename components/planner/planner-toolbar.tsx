"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { MemberFilter, type Member } from "@/components/member-filter"
import { cn } from "@/lib/utils"
import type { PlannerZoom } from "@/lib/hooks/use-planner-query-args"
import type { Id } from "@/convex/_generated/dataModel"

const ZOOM_OPTIONS: ReadonlyArray<readonly [PlannerZoom, string]> = [
  ["1w", "Week"],
  ["2w", "2 weeks"],
  ["1m", "Month"],
]

export function PlannerToolbar({
  rangeLabel,
  zoom,
  onShiftRange,
  onToday,
  onSetZoom,
  members,
  selectedUserIds,
  onSelectUserIds,
  unscheduledCount,
  panelOpen,
  onTogglePanel,
  onNewTask,
}: {
  rangeLabel: string
  zoom: PlannerZoom
  /** ±1 = one week in week zooms, one calendar month in month zoom. */
  onShiftRange: (delta: number) => void
  onToday: () => void
  onSetZoom: (zoom: PlannerZoom) => void
  members: Member[] | undefined
  selectedUserIds: Id<"users">[]
  onSelectUserIds: (ids: Id<"users">[]) => void
  /** Badge on the Tasks button; undefined while the panel query loads. */
  unscheduledCount: number | undefined
  panelOpen: boolean
  onTogglePanel: () => void
  /** Opens (and focuses) the panel's quick-add composer. Admin only — the
   *  button renders only when a handler is passed. */
  onNewTask?: () => void
}) {
  const shiftUnit = zoom === "1m" ? "month" : "week"
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2 md:px-6">
      <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">
        Planner
      </h1>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Previous ${shiftUnit}`}
          onClick={() => onShiftRange(-1)}
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-2.5 text-[12.5px] font-medium"
          onClick={onToday}
        >
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Next ${shiftUnit}`}
          onClick={() => onShiftRange(1)}
        >
          <ChevronRightIcon className="size-4" />
        </Button>
      </div>

      <span className="text-[13px] tabular-nums text-muted-foreground">
        {rangeLabel}
      </span>

      <div
        role="group"
        aria-label="Zoom"
        className="flex overflow-hidden rounded-lg border border-border"
      >
        {ZOOM_OPTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onSetZoom(value)}
            className={cn(
              "px-3 py-[5px] text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
              zoom === value
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <MemberFilter
          members={members ?? []}
          selectedIds={selectedUserIds}
          onChange={onSelectUserIds}
        />
        {/* Quiet toolbar toggle (matches MemberFilter's ghost language):
            icon + label, count as plain muted text — no border, no pill. */}
        <Button
          variant="ghost"
          aria-pressed={panelOpen}
          onClick={onTogglePanel}
          className={cn(
            "h-8 gap-1.5 px-2.5 text-[13px] font-medium",
            panelOpen && "bg-muted hover:bg-muted",
          )}
        >
          <PanelRightIcon className="size-3.5 text-muted-foreground" />
          Tasks
          {unscheduledCount ? (
            <span className="text-[11.5px] tabular-nums text-muted-foreground">
              {unscheduledCount}
            </span>
          ) : null}
        </Button>
        {onNewTask ? (
          <Button
            onClick={onNewTask}
            className="h-8 px-3 text-[13px] font-medium"
          >
            + New task
          </Button>
        ) : null}
      </div>
    </div>
  )
}

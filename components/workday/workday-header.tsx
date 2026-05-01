"use client"

import { Separator } from "@/components/ui/separator"
import type { Id } from "@/convex/_generated/dataModel"
import {
  WorkdayMemberFilter,
  type WorkdayMember,
} from "./workday-member-filter"
import { WorkdayWeekPicker } from "./workday-week-picker"
import { WorkdayInlineToggle } from "./workday-inline-toggle"

export function WorkdayHeader({
  selectedWeek,
  onSelectWeek,
  onShiftWeek,
  isAdmin,
  members,
  selectedUserIds,
  onSelectUserIds,
  showWeekend,
  onToggleWeekend,
}: {
  selectedWeek: Date
  onSelectWeek: (weekStart: Date) => void
  onShiftWeek: (delta: number) => void
  isAdmin: boolean
  members: WorkdayMember[] | undefined
  selectedUserIds: Id<"users">[]
  onSelectUserIds: (ids: Id<"users">[]) => void
  showWeekend: boolean
  onToggleWeekend: (next: boolean) => void
}) {
  return (
    <header className="mb-6 flex items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-bold tracking-tight">Workday</h1>
        <p className="text-[13px] text-muted-foreground">
          See what your team worked on this week.
        </p>
      </div>
      <div className="flex items-center">
        <WorkdayWeekPicker
          selectedWeek={selectedWeek}
          onSelectWeek={onSelectWeek}
          onShiftWeek={onShiftWeek}
        />
        {isAdmin ? (
          <>
            <Separator orientation="vertical" className="mx-1 !h-[18px]" />
            <WorkdayMemberFilter
              members={members ?? []}
              selectedIds={selectedUserIds}
              onChange={onSelectUserIds}
            />
          </>
        ) : null}
        <Separator orientation="vertical" className="mx-1 !h-[18px]" />
        <WorkdayInlineToggle
          label="Weekend"
          checked={showWeekend}
          onChange={onToggleWeekend}
        />
      </div>
    </header>
  )
}

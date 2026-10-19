"use client"

import { useDeferredValue, useMemo } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useWorkdayQueryArgs } from "@/lib/hooks/use-workday-query-args"
import { formatYMD } from "@/lib/hooks/use-week-picker"
import { getYMDInTimezone } from "@/lib/workday"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { TaskDetailDrawer } from "@/components/task-detail/task-detail-drawer"
import { WorkdayHeader } from "@/components/workday/workday-header"
import { WorkdayGrid } from "@/components/workday/workday-grid"
import { WorkdayGridSkeleton } from "@/components/workday/workday-grid-skeleton"

export default function WorkdayPage() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() === true

  // Org timezone drives "today" everywhere on this page (column highlight,
  // current-week URL state) so all viewers see the same anchor regardless of
  // their browser tz.
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const orgTimezone = orgSettings?.timezone

  const {
    queryArgs,
    selectedWeek,
    selectedUserIds,
    showWeekend,
    setWeek,
    shiftWeek,
    setUserIds,
    setShowWeekend,
  } = useWorkdayQueryArgs({ orgTimezone })

  const data = useQuery(
    api.workday.weekGrid,
    isAuthenticated ? queryArgs : "skip",
  )

  // Hold the last good grid across `undefined` transitions so filter ticks
  // don't flash the skeleton.
  const displayData = useDeferredValue(data)

  const todayYMD = useMemo(
    () =>
      orgTimezone
        ? getYMDInTimezone(new Date(), orgTimezone)
        : formatYMD(new Date()),
    [orgTimezone],
  )
  // Members feed the admin toolbar filter (the drawer reads `workspaceRefs` itself).
  const orgMembersData = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated && isAdmin ? undefined : "skip",
  )

  // Visible-week task IDs in scan order (earliest firstStart, deduped) so the
  // drawer's prev/next walks the same order the user sees on screen.
  const visibleTaskIds = useMemo(() => {
    if (!data) return [] as string[]
    const seen = new Map<string, number>()
    for (const u of data.users) {
      for (const d of u.days) {
        for (const b of d.boxes) {
          const key = b.taskId.toString()
          const prev = seen.get(key)
          if (prev === undefined || b.firstStart < prev) {
            seen.set(key, b.firstStart)
          }
        }
      }
    }
    return [...seen.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => id)
  }, [data])

  const navigateToTask = useTaskDetailNav()

  return (
    <>
      <div className="mx-auto w-full max-w-screen-2xl">
        <WorkdayHeader
          selectedWeek={selectedWeek}
          onSelectWeek={setWeek}
          onShiftWeek={shiftWeek}
          isAdmin={isAdmin}
          members={orgMembersData}
          selectedUserIds={selectedUserIds}
          onSelectUserIds={setUserIds}
          showWeekend={showWeekend}
          onToggleWeekend={setShowWeekend}
        />
        {displayData === undefined ? (
          <WorkdayGridSkeleton dayCount={showWeekend ? 7 : 5} />
        ) : (
          <WorkdayGrid
            data={displayData}
            todayYMD={todayYMD}
            onOpenTask={(taskId) => navigateToTask(taskId.toString())}
          />
        )}
      </div>

      <TaskDetailDrawer taskIds={visibleTaskIds} isAdmin={isAdmin} />
    </>
  )
}

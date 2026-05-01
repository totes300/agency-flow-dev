"use client"

import { useDeferredValue, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { useWorkdayQueryArgs } from "@/lib/hooks/use-workday-query-args"
import { formatYMD } from "@/lib/hooks/use-week-picker"
import { getYMDInTimezone } from "@/lib/workday"
import { parseDetailParam } from "@/lib/task-detail"
import { useTaskDetail } from "@/components/tasks/use-task-detail"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { WorkdayHeader } from "@/components/workday/workday-header"
import { WorkdayGrid } from "@/components/workday/workday-grid"
import { WorkdayGridSkeleton } from "@/components/workday/workday-grid-skeleton"

export default function WorkdayPage() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() === true
  const isMobile = useIsMobile()

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

  // Drawer reference data loads on first open, then stays subscribed.
  // Watching `?detail=` keeps this gate in sync with the drawer's own hook.
  const searchParams = useSearchParams()
  const detailId = parseDetailParam(searchParams)
  const [drawerEverOpened, setDrawerEverOpened] = useState(false)
  if (detailId && !drawerEverOpened) setDrawerEverOpened(true)
  const drawerNeedsData = isAuthenticated && drawerEverOpened

  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const todayYMD = useMemo(
    () =>
      orgTimezone
        ? getYMDInTimezone(new Date(), orgTimezone)
        : formatYMD(new Date()),
    [orgTimezone],
  )
  const statuses = useQuery(api.statuses.list, drawerNeedsData ? {} : "skip")
  const categories = useQuery(api.workCategories.list, drawerNeedsData ? {} : "skip")
  const projects = useQuery(api.projects.list, drawerNeedsData ? {} : "skip")
  // Members also feed the toolbar filter — eager for admins, deferred for members.
  const orgMembersData = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated && (isAdmin || drawerEverOpened) ? undefined : "skip",
  )
  const referenceData = useMemo(
    () => ({ statuses, categories, projects, orgMembers: orgMembersData }),
    [statuses, categories, projects, orgMembersData],
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

  const { navigateToTask } = useTaskDetail(visibleTaskIds)

  const rawViewPref = currentUser?.taskDetailView ?? "modal"
  const viewPref = isMobile ? "modal" : rawViewPref

  return (
    <TaskReferenceDataProvider value={referenceData}>
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

      {viewPref === "drawer" ? (
        <TaskDetailDrawer taskIds={visibleTaskIds} isAdmin={isAdmin} />
      ) : (
        <TaskDetailModal taskIds={visibleTaskIds} isAdmin={isAdmin} />
      )}
    </TaskReferenceDataProvider>
  )
}

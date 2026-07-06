"use client"

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { buildDetailUrl, parseDetailParam } from "@/lib/task-detail"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { usePlannerQueryArgs } from "@/lib/hooks/use-planner-query-args"
import { usePlannerMutations } from "@/lib/hooks/use-planner-mutations"
import {
  usePlannerDrag,
  type PlannerDragTarget,
} from "@/lib/hooks/use-planner-drag"
import { formatRange, formatYMD } from "@/lib/hooks/use-week-picker"
import { getYMDInTimezone } from "@/lib/workday"
import {
  addDaysYmd,
  dayDiff,
  mondayOfYmd,
  ymdToLocalDate,
} from "@/lib/planner"
import {
  PlannerGrid,
  PLANNER_DAY_PX,
  PLANNER_RAIL_PX,
} from "@/components/planner/planner-grid"
import {
  PlannerTaskPanel,
  isUnscheduled,
} from "@/components/planner/planner-task-panel"
import { PlannerTaskCard } from "@/components/planner/planner-task-card"
import { PlannerGridSkeleton } from "@/components/planner/planner-grid-skeleton"
import { PlannerToolbar } from "@/components/planner/planner-toolbar"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"

export default function PlannerPage() {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() === true

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  const detailId = parseDetailParam(searchParams)

  // The Planner always opens tasks in the DRAWER on desktop, regardless of
  // the /tasks drawer/modal preference. The fullscreen modal covers the
  // board and its pointer-down-outside dismissal swallows bar clicks — the
  // first click on another bar closed the modal instead of opening the
  // task. A shared board must stay visible and clickable behind the open
  // task (mockup behavior; owner ruling 2026-07-06). Mobile still gets the
  // modal — a 54vw side drawer is unusable there.
  const isMobile = useIsMobile()

  // Org timezone anchors "today" so all viewers see the same column tinted.
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const orgTimezone = orgSettings?.timezone
  const todayYMD = useMemo(
    () =>
      orgTimezone
        ? getYMDInTimezone(new Date(), orgTimezone)
        : formatYMD(new Date()),
    [orgTimezone],
  )

  const {
    queryArgs,
    days,
    zoom,
    anchorYmd,
    selectedUserIds,
    panelOpen,
    extendBack,
    extendForward,
    commitAnchor,
    setZoom,
    setUserIds,
    setPanelOpen,
  } = usePlannerQueryArgs({ orgTimezone })

  const data = useQuery(
    api.planner.weekGrid,
    isAuthenticated ? queryArgs : "skip",
  )
  // Hold the last good grid across window-extension refetches — the board
  // must never unmount mid-pan (it would flash the skeleton and lose the
  // scroll position).
  const displayData = useDeferredValue(data)

  // Everyone can filter rows (the board is shared), so members load the
  // member list too — unlike Workday, where the filter is admin-only.
  const members = useQuery(
    api.orgMembers.listOrgMembers,
    isAuthenticated ? {} : "skip",
  )

  // Tasks panel data — loaded regardless of panel visibility because the
  // toolbar badge shows the unscheduled count even while the panel is closed.
  const panelTasks = useQuery(
    api.planner.taskPanel,
    isAuthenticated ? {} : "skip",
  )
  const unscheduledCount = useMemo(
    () => panelTasks?.filter(isUnscheduled).length,
    [panelTasks],
  )

  // Reference data for the drawer's inline cells — subscribed only while a
  // task detail is open, so the board itself stays light.
  const statuses = useQuery(
    api.statuses.list,
    isAuthenticated && detailId ? {} : "skip",
  )
  const categories = useQuery(
    api.workCategories.list,
    isAuthenticated && detailId ? {} : "skip",
  )
  const projects = useQuery(
    api.projects.list,
    isAuthenticated && detailId ? {} : "skip",
  )
  const referenceData = useMemo(
    () => ({ statuses, categories, projects, orgMembers: members }),
    [statuses, categories, projects, members],
  )

  // Drawer prev/next (J/K) walks tasks in board order: row order, then each
  // task's first visible segment (segments arrive start-date sorted).
  const orderedTaskIds = useMemo(() => {
    if (!displayData) return []
    const seen = new Set<string>()
    const out: string[] = []
    for (const row of displayData.rows) {
      for (const seg of row.segments) {
        if (!seen.has(seg.taskId)) {
          seen.add(seg.taskId)
          out.push(seg.taskId)
        }
      }
    }
    return out
  }, [displayData])

  // Clicking a bar opens the SAME task drawer /tasks uses (?detail= param).
  const handleOpenTask = useCallback(
    (taskId: Id<"tasks">) => {
      const url = buildDetailUrl(searchParamsRef.current, taskId)
      router.push(`${pathname}${url}`, { scroll: false })
    },
    [router, pathname],
  )

  // Plan mutations: optimistic apply, automatic rollback, error toast —
  // all wrapped in a dedicated hook so the page stays an orchestrator.
  const {
    handleMoveSegment,
    handleRemoveSegment,
    handleSplitSegment,
    handleCreateFromPanel,
    handleCreateTaskWithSegment,
  } = usePlannerMutations(queryArgs, { grid: displayData, days })

  // Draw-to-create: the released sketch waits here (ghost bar + title
  // popover) until Enter creates the task atomically or Escape/outside
  // click cancels. Page state — it must survive board re-renders.
  const [pendingCreate, setPendingCreate] =
    useState<PlannerDragTarget | null>(null)
  const handleDrawComplete = useCallback(
    (target: PlannerDragTarget) => setPendingCreate(target),
    [],
  )
  const handleCancelCreate = useCallback(() => setPendingCreate(null), [])
  const pendingCreateRef = useRef(pendingCreate)
  pendingCreateRef.current = pendingCreate
  const handleConfirmCreate = useCallback(
    async (title: string, projectId: Id<"projects"> | null) => {
      const target = pendingCreateRef.current
      if (!target) return
      // Rejection propagates to the popover, which keeps the typed title;
      // the toast already fired in the mutation wrapper.
      await handleCreateTaskWithSegment({
        title,
        ...(projectId ? { projectId } : {}),
        userId: target.userId,
        startDate: target.startDate,
        endDate: target.endDate,
      })
      setPendingCreate(null)
    },
    [handleCreateTaskWithSegment],
  )

  // "+ New task" (admin): open the panel and (re)mount the composer at the
  // top of the list — the key bump refocuses it even when already open.
  const [composerNonce, setComposerNonce] = useState(0)
  const handleNewTask = useCallback(() => {
    setPanelOpen(true)
    setComposerNonce((n) => n + 1)
  }, [setPanelOpen])
  const handleCloseComposer = useCallback(() => setComposerNonce(0), [])

  // The grid reports the visible day span while panning; the toolbar label
  // follows it, and the URL anchor commits once panning settles.
  const dayPx = PLANNER_DAY_PX[zoom]
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Drag engine — owned by the page: the grid renders its state, the Tasks
  // panel starts card drags into it (admin only; members get an inert board).
  const engine = usePlannerDrag({
    enabled: isAdmin,
    days,
    dayPx,
    railPx: PLANNER_RAIL_PX,
    scrollRef,
    onCommitMove: handleMoveSegment,
    onCommitCopy: handleSplitSegment,
    onCommitCreate: handleCreateFromPanel,
    onDrawComplete: handleDrawComplete,
  })
  const [view, setView] = useState<{ start: string; end: string } | null>(null)
  useEffect(() => {
    if (!view) return
    const t = setTimeout(() => commitAnchor(view.start), 400)
    return () => clearTimeout(t)
  }, [view, commitAnchor])

  const rangeLabel = useMemo(() => {
    const start = view?.start ?? anchorYmd
    const end = view?.end ?? addDaysYmd(anchorYmd, 13)
    return formatRange(ymdToLocalDate(start), ymdToLocalDate(end))
  }, [view, anchorYmd])

  // Toolbar buttons drive the same continuous canvas the trackpad pans.
  const shiftDays = zoom === "1m" ? 28 : 7
  const shiftRange = (delta: number) => {
    scrollRef.current?.scrollBy({
      left: delta * shiftDays * dayPx,
      behavior: "smooth",
    })
  }
  const goToday = () => {
    const el = scrollRef.current
    if (!el) return
    const target = dayDiff(days[0], mondayOfYmd(todayYMD)) * dayPx
    el.scrollTo({ left: Math.max(0, target), behavior: "smooth" })
  }

  // Fullscreen board (Toggl Plan mold): reclaim the dashboard layout's
  // padding and fill the remaining viewport height; the grid scrolls
  // internally on both axes.
  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div className="-mx-4 -mb-6 -mt-6 flex min-h-0 min-w-0 flex-1 flex-col md:-mx-12">
      <PlannerToolbar
        rangeLabel={rangeLabel}
        zoom={zoom}
        onShiftRange={shiftRange}
        onToday={goToday}
        onSetZoom={setZoom}
        members={members ?? undefined}
        selectedUserIds={selectedUserIds}
        onSelectUserIds={setUserIds}
        unscheduledCount={unscheduledCount}
        panelOpen={panelOpen}
        onTogglePanel={() => setPanelOpen(!panelOpen)}
        onNewTask={isAdmin ? handleNewTask : undefined}
      />

      {/* Board + Tasks panel; the panel collapses below the grid on narrow
          viewports (mockup breakpoint behavior). min-w-0 keeps the board's
          intrinsic canvas width from propagating out of this row. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <div className="min-h-0 min-w-0 flex-1">
          {displayData === undefined ? (
            <PlannerGridSkeleton
              dayCount={zoom === "1m" ? 31 : zoom === "1w" ? 7 : 14}
            />
          ) : (
            <PlannerGrid
              data={displayData}
              days={days}
              todayYMD={todayYMD}
              zoom={zoom}
              isAdmin={isAdmin}
              anchorYmd={anchorYmd}
              scrollRef={scrollRef}
              engine={engine}
              pendingCreate={pendingCreate}
              onConfirmCreate={handleConfirmCreate}
              onCancelCreate={handleCancelCreate}
              onExtendBack={extendBack}
              onExtendForward={extendForward}
              onViewChange={(start, end) =>
                setView((prev) =>
                  prev?.start === start && prev?.end === end
                    ? prev
                    : { start, end },
                )
              }
              onRemoveSegment={handleRemoveSegment}
              onOpenTask={handleOpenTask}
            />
          )}
        </div>

        {panelOpen ? (
          <PlannerTaskPanel
            tasks={panelTasks}
            isAdmin={isAdmin}
            engine={engine}
            onOpenTask={handleOpenTask}
            todayYmd={todayYMD}
            composerNonce={composerNonce}
            onCloseComposer={handleCloseComposer}
          />
        ) : null}
      </div>

      {/* Cursor-following card while dragging from the panel (positioned
          imperatively by the engine; hidden while the grid ghost shows). */}
      {engine.panelDrag ? (
        <div
          ref={engine.registerFlyEl}
          className="pointer-events-none fixed left-0 top-0 z-[60] w-[230px]"
        >
          <PlannerTaskCard
            title={engine.panelDrag.task.title}
            clientName={engine.panelDrag.task.clientName}
            categoryColor={engine.panelDrag.task.categoryColor}
            isDone={engine.panelDrag.task.statusType === "done"}
            floating
          />
        </div>
      ) : null}

      {isMobile ? (
        <TaskDetailModal taskIds={orderedTaskIds} isAdmin={isAdmin} />
      ) : (
        <TaskDetailDrawer taskIds={orderedTaskIds} isAdmin={isAdmin} />
      )}
    </div>
    </TaskReferenceDataProvider>
  )
}

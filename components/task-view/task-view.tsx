"use client"

import { useCallback, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ListViewSurface } from "@/convex/tasks/model"
import { useIsAdmin } from "@/lib/hooks/use-is-admin"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { useLastDefined } from "@/lib/hooks/use-last-defined"
import { useRowSelection } from "@/lib/hooks/use-row-selection"
import { useTimerActions } from "@/lib/hooks/use-timer"
import { buildDetailUrl, parseDetailParam } from "@/lib/task-detail"
import { formatDateToYMD } from "@/lib/format"
import { formatDuration } from "@/lib/duration"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskFormModal, type TaskFormDefaults } from "@/components/tasks/task-form-modal"
import { ComposeIcon } from "@/components/icons/nav-icons"
import { visibleColumnKeys, type CellContext } from "@/components/task-view/columns"
import type { OrderBy } from "@/components/task-view/column-rules"
import { PropertyMenu, type PropertyMenuKind, type PropertyMenuRequest } from "@/components/task-view/property-menus"
import { buildRowModels, groupRows, indexRefs, sortRows, type TaskGroup } from "@/components/task-view/row-model"
import { SelectionBar } from "@/components/task-view/selection-bar"
import { ShortcutsDialog } from "@/components/task-view/shortcuts-dialog"
import { TaskTable } from "@/components/task-view/task-table"
import { TASK_VIEW_PANEL_CLASS, TaskTableSkeleton } from "@/components/task-view/task-view-skeleton"
import { useTaskActions } from "@/components/task-view/use-task-actions"
import { useTaskKeyboard } from "@/components/task-view/use-task-keyboard"
import { useViewState } from "@/components/task-view/use-view-state"
import { ViewTabs } from "@/components/task-view/view-tabs"

/** Closed-row paging, mirroring `CLOSED_ROW_DEFAULT` / `CLOSED_ROW_MAX` in convex/tasks/read.ts (server clamps). */
const CLOSED_ROW_DEFAULT = 200
const CLOSED_ROW_MAX = 2000

/**
 * The task view container (docs/prd-tasks-refactor.md §6.2): surface preset +
 * view spec (URL) → `tasks.queries.listView` → client-side grouping/ordering
 * → the aligned-column table. Slice 3 serves `/tasks` with the system views
 * Active / Backlog / All tasks; saved views, the display/filter menus and the
 * board arrive in slice 4. Rows open the existing task detail (`?detail=`).
 */
export function TaskView({ surface }: { surface: Extract<ListViewSurface, "tasks"> }) {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() ?? false
  const isMobile = useIsMobile()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = useViewState(surface)
  const { spec, viewKey } = view
  const [today] = useState(() => formatDateToYMD(new Date()))

  // "Load more" for completed/canceled rows, per view.
  const [closedLimits, setClosedLimits] = useState<Record<string, number>>({})
  const closedLimit = closedLimits[viewKey] ?? CLOSED_ROW_DEFAULT

  const listArgs = useMemo(
    () => ({
      surface,
      ...(view.modified ? { spec } : { viewKey }),
      closedLimit,
      today,
    }),
    [surface, view.modified, spec, viewKey, closedLimit, today],
  )
  const liveResult = useQuery(api.tasks.queries.listView, isAuthenticated ? listArgs : "skip")
  const result = useLastDefined(liveResult)
  const refs = useQuery(api.workspaceRefs.get, isAuthenticated ? {} : "skip")

  // The existing detail drawer/modal and the create modal still read the
  // legacy reference-data context (they are reworked in slice 6).
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const statuses = useQuery(api.statuses.list, isAuthenticated ? {} : "skip")
  const categories = useQuery(api.workCategories.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, isAuthenticated ? undefined : "skip")
  const referenceData = useMemo(
    () => ({ statuses, categories, projects, orgMembers }),
    [statuses, categories, projects, orgMembers],
  )
  const detailMode = isMobile ? "modal" : (currentUser?.taskDetailView ?? "modal")

  // ─── Rows → groups ──────────────────────────────────────────────────────────
  const index = useMemo(() => (refs ? indexRefs(refs) : null), [refs])
  const rows = useMemo(
    () => (result && index ? sortRows(buildRowModels(result.rows, result.perUser, index), spec.orderBy) : []),
    [result, index, spec.orderBy],
  )
  const rowById = useMemo(() => new Map(rows.map((r) => [r.task._id, r])), [rows])
  const groups = useMemo(() => (index ? groupRows(rows, spec, index) : []), [rows, spec, index])
  const columns = useMemo(() => visibleColumnKeys(spec), [spec])
  const grouped = spec.groupBy !== "none"

  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const groupStateKey = useCallback((key: string) => `${viewKey}|${spec.groupBy}|${key}`, [viewKey, spec.groupBy])
  const isCollapsed = useCallback((key: string) => collapsedGroups.has(groupStateKey(key)), [collapsedGroups, groupStateKey])
  const toggleGroup = useCallback(
    (key: string) =>
      setCollapsedGroups((prev) => {
        const next = new Set(prev)
        const k = groupStateKey(key)
        if (!next.delete(k)) next.add(k)
        return next
      }),
    [groupStateKey],
  )

  /** Visible rows in screen order (a multi-assignee/label row counts once). */
  const orderedIds = useMemo(() => {
    const seen = new Set<Id<"tasks">>()
    for (const g of groups) {
      if (grouped && isCollapsed(g.key)) continue
      for (const r of g.rows) seen.add(r.task._id)
    }
    return [...seen]
  }, [groups, grouped, isCollapsed])

  // ─── Selection, focus, detail ───────────────────────────────────────────────
  const selection = useRowSelection(orderedIds)
  const [focusState, setFocusState] = useState<Id<"tasks"> | null>(null)
  const focusedId = focusState && rowById.has(focusState) ? focusState : null
  const setFocusedId = useCallback((id: Id<"tasks"> | null) => {
    setFocusState(id)
    if (id) document.querySelector(`[data-task-id="${id}"]`)?.scrollIntoView({ block: "nearest" })
  }, [])

  const detailId = parseDetailParam(searchParams)
  const openTask = useCallback(
    (taskId: Id<"tasks">) => {
      setFocusState(taskId)
      router.push(`${pathname}${buildDetailUrl(new URLSearchParams(searchParams.toString()), taskId)}`, { scroll: false })
    },
    [pathname, router, searchParams],
  )

  // ─── Menus and actions ──────────────────────────────────────────────────────
  const actions = useTaskActions()
  const [menu, setMenu] = useState<PropertyMenuRequest | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const toggleMenu = useCallback((kind: PropertyMenuKind, taskIds: Id<"tasks">[], anchor: HTMLElement) => {
    setMenu((current) =>
      current && current.anchor === anchor && current.kind === kind ? null : { kind, taskIds, anchor },
    )
  }, [])
  const menuTasks = useMemo(
    () => (menu ? menu.taskIds.flatMap((id) => rowById.get(id)?.task ?? []) : []),
    [menu, rowById],
  )

  const cellContext: CellContext = useMemo(
    () => ({
      today,
      memberById: index?.memberById ?? new Map(),
      openMenu: (kind, taskId, anchor) => toggleMenu(kind, [taskId], anchor),
    }),
    [today, index, toggleMenu],
  )

  const [createDefaults, setCreateDefaults] = useState<TaskFormDefaults | null>(null)
  const openCreate = useCallback((defaults: TaskFormDefaults = {}) => setCreateDefaults({ ...defaults }), [])
  const createInGroup = useCallback(
    (group: TaskGroup) => {
      const h = group.header
      if (h.kind === "status") return () => openCreate({ statusId: h.status._id })
      if (h.kind === "project" && h.project) return () => openCreate({ projectId: h.project!._id })
      if (h.kind === "assignee" && h.member) return () => openCreate({ assigneeIds: [h.member!._id] })
      return undefined
    },
    [openCreate],
  )

  const toggleTimer = useToggleTaskTimer()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useTaskKeyboard({
    enabled: !!index && !detailId && menu === null,
    orderedIds,
    focusedId,
    setFocusedId,
    hasSelection: selection.size > 0,
    onOpen: openTask,
    onToggleSelect: (id) => selection.toggle(id),
    onClearSelection: selection.clear,
    onOpenMenu: (kind, id) => {
      const row = document.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
      if (!row) return
      const anchor = row.querySelector<HTMLElement>(`[data-menu-anchor="${kind}"]`) ?? row.querySelector<HTMLElement>("[data-col='title']") ?? row
      const ids = selection.size > 0 && selection.isSelected(id) ? [...selection.selectedIds] : [id]
      setMenu({ kind, taskIds: ids, anchor })
    },
    onToggleTimer: (id) => {
      const row = rowById.get(id)
      if (row) void toggleTimer(row.task._id, row.isClosed)
    },
    onNewTask: () => openCreate(),
    onShowShortcuts: () => setShortcutsOpen(true),
  })

  const loaded = result !== undefined && index !== null
  const changeOrder = (orderBy: OrderBy) => view.updateSpec({ orderBy })

  return (
    <TaskReferenceDataProvider value={referenceData}>
      <div className={TASK_VIEW_PANEL_CLASS}>
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-3">
          <ViewTabs views={view.views} activeKey={viewKey} modified={view.modified} onSelect={(key) => { selection.clear(); view.setView(key) }} />
          {view.modified ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={view.reset}>
              Reset
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full"
            aria-label="New task"
            title="New task (C)"
            onClick={() => openCreate()}
          >
            <ComposeIcon />
          </Button>
        </div>

        {result?.truncated ? (
          <p className="shrink-0 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
            Showing the first 1,000 open tasks. Refine with filters.
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto pb-20">
          {!loaded ? (
            <TaskTableSkeleton />
          ) : rows.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyTitle>No tasks in this view</EmptyTitle>
                <EmptyDescription>Tasks you create or are assigned to show up here.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => openCreate()}>
                  <ComposeIcon data-icon="inline-start" />
                  New task
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              <TaskTable
                columns={columns}
                groups={groups}
                grouped={grouped}
                orderBy={spec.orderBy}
                defaultOrderBy={view.baseSpec.orderBy}
                onOrderBy={changeOrder}
                isCollapsed={isCollapsed}
                onToggleGroup={toggleGroup}
                onCreateInGroup={createInGroup}
                ctx={cellContext}
                isSelected={selection.isSelected}
                hasSelection={selection.size > 0}
                headerSelection={selection.headerState}
                onToggleAll={selection.toggleAllVisible}
                onToggleSelect={selection.toggle}
                focusedId={focusedId}
                openId={detailId}
                onOpen={openTask}
              />
              {result.hasMoreClosed && closedLimit < CLOSED_ROW_MAX ? (
                <div className="flex justify-center py-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() =>
                      setClosedLimits((prev) => ({ ...prev, [viewKey]: Math.min(CLOSED_ROW_MAX, closedLimit + CLOSED_ROW_DEFAULT) }))
                    }
                  >
                    Load more closed tasks
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <SelectionBar
        count={selection.size}
        onClear={selection.clear}
        onOpenMenu={(kind, anchor) => toggleMenu(kind, [...selection.selectedIds], anchor)}
        onArchive={() => {
          const ids = [...selection.selectedIds]
          selection.clear()
          void actions.archive(ids)
        }}
      />

      {index ? (
        <PropertyMenu request={menu} tasks={menuTasks} index={index} actions={actions} onClose={closeMenu} />
      ) : null}

      <TaskFormModal
        open={createDefaults !== null}
        onOpenChange={(open) => { if (!open) setCreateDefaults(null) }}
        defaults={createDefaults ?? undefined}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {detailMode === "drawer" ? (
        <TaskDetailDrawer taskIds={orderedIds} isAdmin={isAdmin} />
      ) : (
        <TaskDetailModal taskIds={orderedIds} isAdmin={isAdmin} />
      )}
    </TaskReferenceDataProvider>
  )
}

/**
 * Y — start/stop the timer on a task, with the same rules as the row's time
 * cell: a running timer elsewhere is stopped (and its entry reported) first;
 * closed tasks don't start a timer.
 */
function useToggleTaskTimer() {
  const { timerState, isRunningOn, startTimer, stopTimer, setPendingStopResult } = useTimerActions()

  return useCallback(
    async (taskId: Id<"tasks">, isClosed: boolean) => {
      const running = isRunningOn(taskId)
      if (!running && isClosed) return
      try {
        if (timerState !== null) {
          const stopped = await stopTimer()
          if (stopped && !stopped.discarded && stopped.entryId) {
            setPendingStopResult(stopped)
            toast.info(`${formatDuration(stopped.roundedMinutes)} saved on "${stopped.taskName}"`, {
              description: "Adjust it in the floating widget if needed",
            })
          } else if (stopped?.discarded) {
            toast.info("Timer was under 30 seconds — nothing saved")
          }
        }
        if (!running) await startTimer(taskId)
      } catch (err) {
        toastError(err, running ? "Failed to stop timer" : "Failed to start timer")
      }
    },
    [isRunningOn, setPendingStopResult, startTimer, stopTimer, timerState],
  )
}

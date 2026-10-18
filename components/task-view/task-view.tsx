"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskViewSpec, TaskViewSurface } from "@/convex/tasks/model"
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
import { ConfirmDialog } from "@/components/confirm-dialog"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskFormModal, type TaskFormDefaults } from "@/components/tasks/task-form-modal"
import { ComposeIcon } from "@/components/icons/nav-icons"
import { visibleColumnKeys, type CellContext } from "@/components/task-view/columns"
import type { ColumnKey, OrderBy } from "@/components/task-view/column-rules"
import { boardMoveFor, canDragOnBoard } from "@/components/task-view/board-model"
import { DisplayMenu, boardGroupBy } from "@/components/task-view/display-menu"
import { applyChips, applySearch } from "@/components/task-view/filter-model"
import { FilterButton, FilterChips, type FacetContext } from "@/components/task-view/filter-menu"
import { SearchBox, type SearchBoxHandle } from "@/components/task-view/search-box"
import { TaskBoard } from "@/components/task-view/task-board"
import { ViewDialog, type ViewDialogRequest } from "@/components/task-view/view-dialog"
import type { ViewOption } from "@/components/task-view/view-state"
import { PropertyMenu, type PropertyMenuKind, type PropertyMenuRequest } from "@/components/task-view/property-menus"
import { buildRowModels, groupRows, indexRefs, sortRows, type TaskGroup } from "@/components/task-view/row-model"
import { canReorderList, inlineAddPrefill, reorderNeighbours, scopeDefaultStatusId } from "@/components/task-view/row-editing"
import { SelectionBar } from "@/components/task-view/selection-bar"
import { ShortcutsDialog } from "@/components/task-view/shortcuts-dialog"
import { TaskTable } from "@/components/task-view/task-table"
import { TASK_VIEW_PANEL_CLASS, TaskTableSkeleton } from "@/components/task-view/task-view-skeleton"
import { useTaskActions } from "@/components/task-view/use-task-actions"
import { useTaskKeyboard } from "@/components/task-view/use-task-keyboard"
import { useViewActions, useViewState } from "@/components/task-view/use-view-state"
import { ViewTabs } from "@/components/task-view/view-tabs"

/** Closed-row paging, mirroring `CLOSED_ROW_DEFAULT` / `CLOSED_ROW_MAX` in convex/tasks/read.ts (server clamps). */
const CLOSED_ROW_DEFAULT = 200
const CLOSED_ROW_MAX = 2000

/** Columns a board card never shows: the ID (U3) and the long list-only cells. */
const BOARD_HIDDEN_KEYS: ReadonlySet<ColumnKey> = new Set(["id", "created", "activity"])

/**
 * The task view container (docs/prd-tasks-refactor.md §6.2): surface preset +
 * view (URL ⇄ saved views, `use-view-state`) → `tasks.queries.listView` (the
 * view's scope) → client-side search, filter chips and facets, grouping and
 * ordering → the aligned-column table or the board. Rows open the existing
 * task detail (`?detail=`). The list edits category, client (project) and due
 * date inline, reorders by drag in manual order and adds tasks from the end
 * of each group (slice 4b, `row-editing.ts`).
 */
export function TaskView({ surface }: { surface: Extract<TaskViewSurface, "tasks"> }) {
  const { isAuthenticated } = useConvexAuth()
  const isAdmin = useIsAdmin() ?? false
  const isMobile = useIsMobile()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = useViewState(surface)
  const viewActions = useViewActions(view)
  const { spec, draft } = view
  const viewKey = view.view.key
  // UI affordances follow the Clerk role (like the rest of the app); `tasks/views.ts` enforces it.
  const canManageViews = view.canManageWorkspace || isAdmin
  const [today] = useState(() => formatDateToYMD(new Date()))

  // "Load more" for completed/canceled rows, per view.
  const [closedLimits, setClosedLimits] = useState<Record<string, number>>({})
  const closedLimit = closedLimits[viewKey] ?? CLOSED_ROW_DEFAULT

  const listArgs = useMemo(
    () => ({ surface, ...view.listQuery, closedLimit, today }),
    [surface, view.listQuery, closedLimit, today],
  )
  const liveResult = useQuery(api.tasks.queries.listView, isAuthenticated && view.ready ? listArgs : "skip")
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

  // ─── Rows → search → chips → groups ─────────────────────────────────────────
  const index = useMemo(() => (refs ? indexRefs(refs) : null), [refs])
  const me = refs?.me ?? ""
  const allRows = useMemo(
    () => (result && index ? sortRows(buildRowModels(result.rows, result.perUser, index), spec.orderBy) : []),
    [result, index, spec.orderBy],
  )
  const searched = useMemo(() => applySearch(allRows, view.search), [allRows, view.search])
  const rows = useMemo(() => applyChips(searched, draft.chips, me), [searched, draft.chips, me])
  const rowById = useMemo(() => new Map(allRows.map((r) => [r.task._id, r])), [allRows])

  const board = spec.layout === "board"
  const boardGroup = boardGroupBy(spec.groupBy)
  const groups = useMemo(() => {
    if (!index) return []
    if (!board) return groupRows(rows, spec, index)
    // Status columns always show (inside the view's scope) so every status is a drop target.
    return groupRows(rows, { ...spec, groupBy: boardGroup, showEmptyGroups: spec.showEmptyGroups || boardGroup === "status" }, index)
  }, [board, boardGroup, index, rows, spec])
  const columns = useMemo(() => visibleColumnKeys(spec), [spec])
  const boardKeys = useMemo(
    () =>
      visibleColumnKeys({ ...spec, groupBy: boardGroup }).filter(
        (k) => !BOARD_HIDDEN_KEYS.has(k) && !(boardGroup === "status" && k === "statusIcon"),
      ),
    [boardGroup, spec],
  )
  const grouped = board || spec.groupBy !== "none"

  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const groupStateKey = useCallback((key: string) => `${viewKey}|${spec.groupBy}|${key}`, [viewKey, spec.groupBy])
  const isCollapsed = useCallback(
    (key: string) => !board && collapsedGroups.has(groupStateKey(key)),
    [board, collapsedGroups, groupStateKey],
  )
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
      canEditBilling: isAdmin,
    }),
    [today, index, toggleMenu, isAdmin],
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

  // ─── Row editing: drag reorder + inline add (§11.7) ─────────────────────────
  const { reorder } = actions
  const reorderInGroup = useMemo(() => {
    if (!canReorderList(spec)) return null
    return (group: TaskGroup, from: number, to: number) => {
      const moved = group.rows[from]
      const neighbours = reorderNeighbours(group.rows.map((r) => r.task.sortKey), from, to)
      if (!moved || !neighbours) {
        toast.error("This task can't be placed there")
        return
      }
      void reorder(moved.task._id, neighbours)
    }
  }, [reorder, spec])

  const createTask = useMutation(api.tasks.create)
  const defaultStatusId = useMemo(
    () => (refs ? scopeDefaultStatusId(spec, refs.statuses) : undefined),
    [refs, spec],
  )
  const inlineAdd = useCallback(
    (group: TaskGroup) => {
      const prefill = inlineAddPrefill(group, { defaultStatusId, isAdmin })
      if (!prefill) return undefined
      return (title: string) => {
        createTask({ title, ...prefill }).catch((err) => toastError(err, "Failed to create task"))
      }
    },
    [createTask, defaultStatusId, isAdmin],
  )

  const boardDraggable = canDragOnBoard(boardGroup, isAdmin)
  const moveOnBoard = useCallback(
    (taskId: Id<"tasks">, fromKey: string, toKey: string) => {
      const row = rowById.get(taskId)
      if (!row) return
      const move = boardMoveFor(boardGroup, row.task, fromKey, toKey)
      if (!move) return
      switch (move.kind) {
        case "status":
          return void actions.setStatus([row.task], move.statusId)
        case "priority":
          return void actions.setPriority([row.task], move.priority)
        case "assignees":
          return void actions.patchTask(row.task, { assigneeIds: move.assigneeIds }, "Failed to change assignees")
        case "labels":
          return void actions.patchTask(row.task, { labelIds: move.labelIds }, "Failed to change labels")
        case "project":
          return void actions.patchTask(row.task, { projectId: move.projectId }, "Failed to move the task")
        case "workCategory":
          return void actions.patchTask(row.task, { workCategoryId: move.workCategoryId }, "Failed to change the category")
      }
    },
    [actions, boardGroup, rowById],
  )

  // ─── Views: dialogs ─────────────────────────────────────────────────────────
  const [viewDialog, setViewDialog] = useState<
    (ViewDialogRequest & { spec?: TaskViewSpec; target?: ViewOption }) | null
  >(null)
  const [deleting, setDeleting] = useState<ViewOption | null>(null)
  const submitViewDialog = async (name: string, scope: "personal" | "workspace") => {
    if (!viewDialog) return
    if (viewDialog.mode === "rename" && viewDialog.target) await viewActions.rename(viewDialog.target, name)
    else if ((await viewActions.saveAsNew(name, scope, viewDialog.spec)) === null) return
    setViewDialog(null)
  }

  const facetCtx: FacetContext | null = useMemo(
    () => (index ? { rows: searched, chips: draft.chips, index, me, onChange: view.setChips } : null),
    [draft.chips, index, me, searched, view.setChips],
  )
  const [filterOpen, setFilterOpen] = useState(false)
  const searchRef = useRef<SearchBoxHandle>(null)

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
    onFilter: () => setFilterOpen(true),
    onSearch: () => searchRef.current?.focus(),
  })

  const loaded = result !== undefined && index !== null
  const changeOrder = (orderBy: OrderBy) => view.updateDisplay({ orderBy })
  const narrowed = draft.chips.length > 0 || view.search !== ""

  return (
    <TaskReferenceDataProvider value={referenceData}>
      <div className={TASK_VIEW_PANEL_CLASS} data-full-bleed>
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <ViewTabs
            views={view.options}
            activeKey={viewKey}
            isAdmin={canManageViews}
            customizedDefaults={view.customizedDefaults}
            actions={{
              onSelect: (key) => { selection.clear(); view.setView(key) },
              onNew: () => setViewDialog({ mode: "create", filterCount: draft.chips.length }),
              onRename: (target) => setViewDialog({ mode: "rename", initialName: target.name, target }),
              onDuplicate: (target) =>
                setViewDialog({
                  mode: "create",
                  initialName: `${target.name} copy`,
                  filterCount: target.key === viewKey ? draft.chips.length : 0,
                  spec: target.key === viewKey ? spec : target.spec,
                }),
              onDelete: setDeleting,
              onMove: (target, afterKey) => void viewActions.move(target, afterKey),
              onResetDefault: (target) => void viewActions.resetDefaultForEveryone(target),
            }}
          />
          <span className="flex-1" />
          <SearchBox ref={searchRef} value={view.search} onChange={view.setSearch} />
          {facetCtx ? <FilterButton open={filterOpen} onOpenChange={setFilterOpen} ctx={facetCtx} /> : null}
          <DisplayMenu
            display={draft.display}
            view={view.view}
            modified={view.modified}
            isAdmin={canManageViews}
            onChange={view.updateDisplay}
            onReset={view.reset}
            onSave={() => void viewActions.save()}
            onSaveAsNew={() => setViewDialog({ mode: "create", filterCount: draft.chips.length })}
            onSetDefault={() => void viewActions.setDefaultForEveryone()}
          />
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
        {facetCtx ? <FilterChips ctx={facetCtx} /> : null}

        {result?.truncated ? (
          <p className="shrink-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
            Showing the first 1,000 open tasks. Refine with filters.
          </p>
        ) : null}

        <div className={board ? "min-h-0 flex-1 overflow-auto border-t border-border/60" : "min-h-0 flex-1 overflow-auto border-t border-border/60 pb-20"}>
          {!loaded ? (
            <TaskTableSkeleton />
          ) : rows.length === 0 && !board ? (
            narrowed ? (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyTitle>No tasks match</EmptyTitle>
                  <EmptyDescription>Nothing in this view matches the current filters or search.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => { view.setChips([]); view.setSearch("") }}>
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
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
            )
          ) : board ? (
            <TaskBoard
              columns={groups}
              keys={boardKeys}
              ctx={cellContext}
              draggable={boardDraggable}
              focusedId={focusedId}
              openId={detailId}
              onOpen={openTask}
              onMove={moveOnBoard}
              onCreateInColumn={createInGroup}
            />
          ) : (
            <>
              <TaskTable
                columns={columns}
                groups={groups}
                grouped={grouped}
                orderBy={spec.orderBy}
                defaultOrderBy={view.view.spec.orderBy}
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
                onReorder={reorderInGroup}
                inlineAdd={inlineAdd}
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

      <ViewDialog
        request={viewDialog}
        canManageWorkspace={canManageViews}
        onOpenChange={(open) => { if (!open) setViewDialog(null) }}
        onSubmit={submitViewDialog}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => { if (!open) setDeleting(null) }}
        title={`Delete “${deleting?.name ?? ""}”?`}
        description={
          deleting?.scope === "workspace"
            ? "The view disappears for everyone in the workspace. Tasks are not affected."
            : "The view is removed. Tasks are not affected."
        }
        confirmLabel="Delete view"
        variant="destructive"
        onConfirm={() => {
          if (deleting) void viewActions.remove(deleting)
          setDeleting(null)
        }}
      />

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

"use client"

import { useState, useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { useTaskFilters } from "@/lib/hooks/use-task-filters"
import { useInlineDraftTasks } from "@/lib/hooks/use-inline-draft-tasks"
import { buildDetailUrl, parseDetailParam } from "@/lib/task-detail"
import { findNeighborKeys } from "@/lib/reorder"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TasksHeader } from "@/components/tasks/tasks-header"
import { TasksTabs } from "@/components/tasks/tasks-tabs"
import { TasksTable } from "@/components/tasks/tasks-table"
import { TaskRow } from "@/components/tasks/task-row"
import { InlineAddTask } from "@/components/tasks/inline-add-task"
import { InlineCreatedTaskRow } from "@/components/tasks/inline-created-task-row"
import { TaskFormModal } from "@/components/tasks/task-form-modal"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { BulkToolbar } from "@/components/tasks/bulk-toolbar"
import { TasksEmptyState } from "@/components/tasks/tasks-empty-state"
import { TaskCard } from "@/components/tasks/task-card"
import { TasksListSkeleton } from "@/components/tasks/tasks-list-skeleton"
import { Button } from "@/components/ui/button"
import { DeleteTaskDialog } from "@/components/tasks/delete-task-dialog"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { toastArchiveSuccess, toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskListItem } from "@/components/tasks/tasks-table"

export default function TasksPage() {
  const { isAuthenticated } = useConvexAuth()
  const { membership, organization } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const orgId = organization?.id ?? ""

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const detailId = parseDetailParam(searchParams)
  const filters = useTaskFilters()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const staleListRef = useRef<typeof listResult>(undefined)

  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters.tab])

  // Escape to deselect all
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedIds.size > 0 && !createModalOpen && !deleteTargetId) {
        setSelectedIds(new Set())
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [selectedIds.size, createModalOpen, deleteTargetId])

  const archiveTask = useMutation(api.tasks.archive)
  const restoreTask = useMutation(api.tasks.restore)
  const reorderTask = useMutation(api.tasks.reorderTask)
  const { trigger: triggerUndo } = useUndoAction()

  // Queries
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const rawViewPref = currentUser?.taskDetailView ?? "modal"
  const isMobile = useIsMobile()
  const viewPref = isMobile ? "modal" : rawViewPref
  const counts = useQuery(api.tasks.counts, isAuthenticated ? {} : "skip")
  const listResult = useQuery(api.tasks.list, isAuthenticated ? filters.listArgs : "skip")

  // Reference data — single subscription each, shared via context
  const statuses = useQuery(api.statuses.list, isAuthenticated ? {} : "skip")
  const categories = useQuery(api.workCategories.list, isAuthenticated ? {} : "skip")
  const projects = useQuery(api.projects.list, isAuthenticated ? {} : "skip")
  const orgMembersData = useQuery(api.orgMembers.listOrgMembers, isAuthenticated ? undefined : "skip")
  const referenceData = useMemo(() => ({
    statuses,
    categories,
    projects,
    orgMembers: orgMembersData,
  }), [statuses, categories, projects, orgMembersData])

  // Stale-while-revalidate: keep last result visible during tab switches
  if (listResult !== undefined) {
    staleListRef.current = listResult
  }
  const displayResult = listResult ?? staleListRef.current

  const displayGroups = displayResult

  const createTask = useMutation(api.tasks.create)
  const {
    inlineCreatedTasks,
    handleInlineTaskCreated,
    handleInlineTaskSettled,
    handleDismissDraft,
    handleRetryDraft,
  } = useInlineDraftTasks({
    displayResult,
    filtersKey: `${filters.tab}|${filters.groupBy}|${filters.search}|${filters.filtersKey}`,
    createTask,
  })

  // Optimistic reorder: hold spliced task order until server catches up
  const [optimisticOrder, setOptimisticOrder] = useState<string[] | null>(null)
  const pendingReorderRef = useRef<string | null>(null)

  // Clear optimistic state when server data catches up
  useEffect(() => {
    if (!pendingReorderRef.current || !displayGroups) return
    const serverIds = displayGroups.groups[0]?.tasks.map((t) => t._id) ?? []
    if (optimisticOrder && serverIds.join(",") === optimisticOrder.join(",")) {
      setOptimisticOrder(null)
      pendingReorderRef.current = null
    }
  }, [displayGroups, optimisticOrder])

  const desktopGroups = useMemo(() => {
    if (!displayGroups) return displayGroups
    return displayGroups.groups.map((group) => {
      let tasks = group.tasks

      // Apply optimistic reorder if active (only for ungrouped single-group view)
      if (optimisticOrder && displayGroups.groups.length === 1) {
        const taskMap = new Map(tasks.map((t) => [t._id, t]))
        const reordered = optimisticOrder
          .map((id) => taskMap.get(id as Id<"tasks">))
          .filter(Boolean) as typeof tasks
        // Include any tasks not in optimisticOrder (e.g. newly created)
        const seen = new Set(optimisticOrder)
        const extras = tasks.filter((t) => !seen.has(t._id))
        tasks = [...reordered, ...extras]
      }

      const persistedIds = new Set(tasks.map((task) => task._id))
      const persistedItems: TaskListItem[] = tasks.map((task) => ({
        kind: "task",
        key: task._id,
        task,
      }))
      const draftItems: TaskListItem[] = (inlineCreatedTasks[group.key] ?? [])
        .filter((draft) => !draft.serverId || !persistedIds.has(draft.serverId))
        .map((draft) => ({
          kind: "draft",
          key: draft.localId,
          draft,
        }))

      return {
        ...group,
        tasks,
        items: [...persistedItems, ...draftItems],
      }
    })
  }, [displayGroups, inlineCreatedTasks, optimisticOrder])

  // Batch time query — all visible task IDs in one call (N+1 prevention)
  // Sort IDs so reorder doesn't change the array → avoids Convex re-subscribing
  const allVisibleTaskIds = useMemo(() => {
    if (!displayGroups) return []
    return displayGroups.groups.flatMap((g) => g.tasks.map((t) => t._id)).sort()
  }, [displayGroups])
  const timeMap = useQuery(
    api.timeEntries.sumByTasks,
    isAuthenticated && allVisibleTaskIds.length > 0
      ? { taskIds: allVisibleTaskIds }
      : "skip",
  )
  const activityMap = useQuery(
    api.tasks.activityIndicators,
    isAuthenticated && allVisibleTaskIds.length > 0
      ? { taskIds: allVisibleTaskIds }
      : "skip",
  )

  // Ref for stable callback — avoid re-creating when searchParams change
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams

  // Open task detail via URL param
  const handleOpenDetail = useCallback((taskId: string) => {
    const url = buildDetailUrl(searchParamsRef.current, taskId as Id<"tasks">)
    router.push(`${pathname}${url}`, { scroll: false })
  }, [router, pathname])

  // Selection
  const handleSelect = useCallback((taskId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected && next.size < 50) {
        next.add(taskId)
      } else if (!selected) {
        next.delete(taskId)
      }
      return next
    })
  }, [])

  const handleSelectAll = useCallback((taskIds: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of taskIds) {
        if (selected) {
          if (next.size < 50) next.add(id)
        } else {
          next.delete(id)
        }
      }
      return next
    })
  }, [])

  const isArchivedView = filters.tab === "archived"

  // Drag reorder — only enabled in manual sort mode, no grouping/search/filters, not archived
  const isDragEnabled = !filters.groupBy && !filters.search && !filters.hasActiveFilters
    && filters.sort.field === "manual" && !isArchivedView

  const handleReorder = useCallback((taskId: string, fromIndex: number, toIndex: number) => {
    const group = desktopGroups?.[0]
    if (!group) return

    const tasks = group.tasks
    // Splice to compute new order
    const reordered = [...tasks]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)

    // Set optimistic order immediately
    const newOrder = reordered.map((t) => t._id as string)
    setOptimisticOrder(newOrder)
    pendingReorderRef.current = taskId

    const { beforeKey, afterKey } = findNeighborKeys(reordered, toIndex)

    void reorderTask({
      taskId: taskId as Id<"tasks">,
      beforeKey,
      afterKey,
    }).catch((err) => {
      setOptimisticOrder(null)
      pendingReorderRef.current = null
      toastError(err, "Failed to reorder task")
    })
  }, [desktopGroups, reorderTask])

  // Archive with undo
  const handleArchive = useCallback((taskId: string) => {
    triggerUndo({
      key: taskId,
      message: "Task archived",
      action: async () => {
        const result = await archiveTask({ id: taskId as Id<"tasks"> })
        // The undo toast already says "Task archived" — only add noise when
        // a running timer was rescued (or couldn't be).
        if (result.autoSavedTimers.length > 0 || result.timerSaveFailures.length > 0) {
          toastArchiveSuccess(result, "Task archived")
        }
      },
      onUndo: async () => {
        await restoreTask({ id: taskId as Id<"tasks"> })
      },
    })
  }, [triggerUndo, archiveTask, restoreTask])

  // Restore from archived
  const handleRestore = useCallback(async (taskId: string) => {
    try {
      await restoreTask({ id: taskId as Id<"tasks"> })
      toast.success("Task restored")
    } catch (err) {
      toastError(err, "Failed to restore task")
    }
  }, [restoreTask])

  const renderItem = useCallback((item: TaskListItem) => {
    if (item.kind === "draft") {
      return (
        <InlineCreatedTaskRow
          key={item.key}
          task={item.draft}
          onDismiss={handleDismissDraft}
          onRetry={handleRetryDraft}
        />
      )
    }
    const task = item.task
    return (
      <TaskRow
        key={task._id}
        task={task}
        isAdmin={isAdmin ?? false}
        isSelected={selectedIds.has(task._id)}
        hasSelection={selectedIds.size > 0}
        onSelect={handleSelect}
        onArchive={handleArchive}
        onRestore={handleRestore}
        onDelete={setDeleteTargetId}
        onOpenDetail={handleOpenDetail}
        totalMinutes={timeMap?.[task._id] ?? 0}
        activity={activityMap?.[task._id]}
        isArchivedView={isArchivedView}
        isDetailOpen={viewPref === "drawer" && detailId === task._id}
      />
    )
  }, [isAdmin, selectedIds, handleSelect, handleArchive, handleRestore, handleOpenDetail, handleDismissDraft, handleRetryDraft, timeMap, activityMap, isArchivedView, viewPref, detailId])

  // Initial load — skeleton only on first render, never on tab switch
  if (!isAuthenticated || counts === undefined || displayGroups === undefined) {
    return <TasksListSkeleton />
  }

  const isEmpty = displayGroups.totalCount === 0 && Object.keys(inlineCreatedTasks).length === 0

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div className="flex w-full flex-col">
      <div className="flex flex-col gap-4">
        <TasksHeader />

        <TasksTabs
          activeTab={filters.tab}
          onTabChange={filters.setTab}
          counts={counts}
          isSearching={filters.isSearching}
          groupBy={filters.groupBy}
          onGroupByChange={filters.setGroupBy}
          search={filters.search}
          onSearchChange={filters.setSearch}
          onNewTask={() => setCreateModalOpen(true)}
          filters={filters.filters}
          setFilters={filters.setFilters}
          isAdmin={isAdmin ?? false}
        />
      </div>

      {isEmpty ? (
        <TasksEmptyState
          tab={filters.tab}
          hasFilters={filters.hasActiveFilters}
          isSearching={filters.isSearching}
          onClearFilters={filters.clearAllFilters}
          onNewTask={() => setCreateModalOpen(true)}
        />
      ) : (
        <>
          {/* Desktop: table view */}
          <div className="hidden pt-2 md:block">
            <TasksTable
              groups={desktopGroups!}
              isGrouped={!!filters.groupBy}
              groupBy={filters.groupBy ?? ""}
              orgId={orgId}
              selectedIds={selectedIds}
              onLoadMore={filters.loadMore}
              onSelectAll={handleSelectAll}
              sortBy={filters.sort.field}
              sortOrder={filters.sort.order}
              onSort={filters.setSort}
              onResetSort={filters.resetSort}
              renderItem={renderItem}
              onReorder={handleReorder}
              isDragEnabled={isDragEnabled}
              renderAddTask={isArchivedView ? undefined : (groupKey) => (
                <InlineAddTask
                  key={`add-${groupKey}`}
                  groupBy={filters.groupBy}
                  groupKey={groupKey}
                  isAdmin={isAdmin ?? false}
                  tab={filters.tab}
                  onCreateInlineTask={handleInlineTaskCreated}
                  onInlineTaskSettled={handleInlineTaskSettled}
                />
              )}
            />
          </div>

          {/* Mobile: card view */}
          <div className="md:hidden">
            {displayGroups.groups.map((group) => (
              <div key={group.key}>
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task._id}
                    task={task}
                    isSelected={selectedIds.has(task._id)}
                    hasSelection={selectedIds.size > 0}
                    onSelect={handleSelect}
                    activity={activityMap?.[task._id]}
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <BulkToolbar
        selectedIds={selectedIds}
        onDeselectAll={() => setSelectedIds(new Set())}
        isAdmin={isAdmin ?? false}
        activeTab={filters.tab}
      />

      {/* Mobile FAB */}
      <Button
        onClick={() => setCreateModalOpen(true)}
        className="fixed bottom-6 right-6 z-40 size-12 rounded-full shadow-lg md:hidden"
        size="icon"
      >
        <PlusIcon className="size-5" />
      </Button>

      <TaskFormModal open={createModalOpen} onOpenChange={setCreateModalOpen} />

      <DeleteTaskDialog
        taskId={deleteTargetId as Id<"tasks"> | null}
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
      />

      {viewPref === "drawer" ? (
        <TaskDetailDrawer
          taskIds={allVisibleTaskIds}
          isAdmin={isAdmin ?? false}
        />
      ) : (
        <TaskDetailModal
          taskIds={allVisibleTaskIds}
          isAdmin={isAdmin ?? false}
        />
      )}
    </div>
    </TaskReferenceDataProvider>
  )
}

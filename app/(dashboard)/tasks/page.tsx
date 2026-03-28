"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useTaskFilters } from "@/lib/hooks/use-task-filters"
import { buildDetailUrl, parseDetailParam } from "@/lib/task-detail"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TasksHeader } from "@/components/tasks/tasks-header"
import { TasksTabs } from "@/components/tasks/tasks-tabs"
import { TasksTable } from "@/components/tasks/tasks-table"
import { TaskRow } from "@/components/tasks/task-row"
import { InlineAddTask } from "@/components/tasks/inline-add-task"
import { InlineCreatedTaskRow, type InlineCreatedTask } from "@/components/tasks/inline-created-task-row"
import { TaskFormModal } from "@/components/tasks/task-form-modal"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
import { TaskDetailDrawer } from "@/components/tasks/task-detail-drawer"
import { BulkToolbar } from "@/components/tasks/bulk-toolbar"
import { TasksEmptyState } from "@/components/tasks/tasks-empty-state"
import { TaskCard } from "@/components/tasks/task-card"
import { TasksListSkeleton } from "@/components/tasks/tasks-list-skeleton"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
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
  const [inlineCreatedTasks, setInlineCreatedTasks] = useState<Record<string, InlineCreatedTask[]>>({})

  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters.tab])

  useEffect(() => {
    setInlineCreatedTasks({})
  }, [filters.tab, filters.groupBy, filters.search, filters.filtersKey])

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
  const removeTask = useMutation(api.tasks.remove)
  const { trigger: triggerUndo } = useUndoAction()

  // Queries
  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const rawViewPref = currentUser?.taskDetailView ?? "modal"

  // Responsive: force modal on mobile (<768px)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    setIsMobile(mq.matches)
    function handleChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches)
    }
    mq.addEventListener("change", handleChange)
    return () => mq.removeEventListener("change", handleChange)
  }, [])
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
  const lastResultRef = useRef(listResult)
  useEffect(() => {
    if (listResult !== undefined) {
      lastResultRef.current = listResult
    }
  }, [listResult])
  const displayResult = listResult ?? lastResultRef.current

  const displayGroups = displayResult

  useEffect(() => {
    if (!displayResult) return

    const visibleTaskIds = new Set(
      displayResult.groups.flatMap((group) => group.tasks.map((task) => task._id))
    )

    setInlineCreatedTasks((prev) => {
      let changed = false
      const next: Record<string, InlineCreatedTask[]> = {}

      for (const [groupKey, drafts] of Object.entries(prev)) {
        const remaining = drafts.filter((draft) => {
          const shouldKeep = !draft.serverId || !visibleTaskIds.has(draft.serverId)
          if (!shouldKeep) changed = true
          return shouldKeep
        })

        if (remaining.length > 0) {
          next[groupKey] = remaining
        } else if (drafts.length > 0) {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [displayResult])

  const desktopGroups = useMemo(() => {
    if (!displayGroups) return displayGroups
    return displayGroups.groups.map((group) => {
      const persistedIds = new Set(group.tasks.map((task) => task._id))
      const persistedItems: TaskListItem[] = group.tasks.map((task) => ({
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
        items: [...persistedItems, ...draftItems],
      }
    })
  }, [displayGroups, inlineCreatedTasks])

  // Batch time query — all visible task IDs in one call (N+1 prevention)
  const allVisibleTaskIds = useMemo(() => {
    if (!displayGroups) return []
    return displayGroups.groups.flatMap((g) => g.tasks.map((t) => t._id))
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

  // Open task detail via URL param
  const handleOpenDetail = useCallback((taskId: string) => {
    const url = buildDetailUrl(searchParams, taskId as Id<"tasks">)
    router.push(`${pathname}${url}`, { scroll: false })
  }, [searchParams, router, pathname])

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

  // Archive with undo
  const handleArchive = useCallback((taskId: string) => {
    triggerUndo({
      key: taskId,
      message: "Task archived",
      action: async () => {
        await archiveTask({ id: taskId as Id<"tasks"> })
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

  // Delete with confirmation
  async function handleDelete() {
    if (!deleteTargetId) return
    try {
      await removeTask({ id: deleteTargetId as Id<"tasks"> })
      setDeleteTargetId(null)
      toast.success("Task deleted")
    } catch (err) {
      toastError(err, "Failed to delete task")
    }
  }

  const createTask = useMutation(api.tasks.create)

  const handleInlineTaskCreated = useCallback((task: InlineCreatedTask) => {
    setInlineCreatedTasks((prev) => ({
      ...prev,
      [task.groupKey]: [...(prev[task.groupKey] ?? []), task],
    }))
  }, [])

  const handleInlineTaskSettled = useCallback((
    groupKey: string,
    localId: string,
    result: { serverId?: Id<"tasks">; error?: boolean },
  ) => {
    setInlineCreatedTasks((prev) => {
      const groupTasks = prev[groupKey]
      if (!groupTasks) return prev

      const nextGroupTasks = groupTasks.map((task) => {
        if (task.localId !== localId) return task
        return {
          ...task,
          serverId: result.serverId ?? task.serverId,
          saveState: result.error ? "error" as const : "saved" as const,
        }
      })

      return {
        ...prev,
        [groupKey]: nextGroupTasks,
      }
    })
  }, [])

  const handleDismissDraft = useCallback((localId: string) => {
    setInlineCreatedTasks((prev) => {
      const next: Record<string, InlineCreatedTask[]> = {}
      let changed = false
      for (const [groupKey, drafts] of Object.entries(prev)) {
        const remaining = drafts.filter((d) => d.localId !== localId)
        if (remaining.length !== drafts.length) changed = true
        if (remaining.length > 0) next[groupKey] = remaining
      }
      return changed ? next : prev
    })
  }, [])

  const handleRetryDraft = useCallback((draft: InlineCreatedTask) => {
    const newLocalId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `inline-${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Replace old draft with new saving draft
    setInlineCreatedTasks((prev) => {
      const groupDrafts = prev[draft.groupKey]
      if (!groupDrafts) return prev
      return {
        ...prev,
        [draft.groupKey]: groupDrafts.map((d) =>
          d.localId === draft.localId
            ? { ...d, localId: newLocalId, saveState: "saving" as const, serverId: undefined }
            : d,
        ),
      }
    })

    // Rebuild mutation args from draft data
    const args: {
      title: string
      projectId?: Id<"projects">
      workCategoryId?: Id<"workCategories">
      statusId?: Id<"statuses">
      assigneeIds?: Id<"users">[]
      dueDate?: string
    } = { title: draft.title }

    if (draft.status) args.statusId = draft.status._id
    if (draft.category) args.workCategoryId = draft.category._id
    if (draft.project) args.projectId = draft.project._id
    if (draft.assignees.length > 0) args.assigneeIds = draft.assignees.map((a) => a._id)
    if (draft.dueDate) args.dueDate = draft.dueDate

    void createTask(args)
      .then((taskId) => {
        handleInlineTaskSettled(draft.groupKey, newLocalId, { serverId: taskId })
      })
      .catch((err) => {
        handleInlineTaskSettled(draft.groupKey, newLocalId, { error: true })
        toastError(err, "Failed to create task")
      })
  }, [createTask, handleInlineTaskSettled])

  // Initial load — skeleton only on first render, never on tab switch
  if (!isAuthenticated || counts === undefined || displayGroups === undefined) {
    return <TasksListSkeleton />
  }

  const isEmpty = displayGroups.totalCount === 0 && Object.keys(inlineCreatedTasks).length === 0

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div>
      <TasksHeader
        search={filters.search}
        onSearchChange={filters.setSearch}
        onNewTask={() => setCreateModalOpen(true)}
        totalCount={counts.all}
      />

      <div className="mt-8">
        <TasksTabs
          activeTab={filters.tab}
          onTabChange={filters.setTab}
          counts={counts}
          isSearching={filters.isSearching}
          groupBy={filters.groupBy}
          onGroupByChange={filters.setGroupBy}
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
          <div className="hidden md:block">
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
              renderItem={(item) => {
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
              }}
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

      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
        title="Delete task"
        description="This will permanently delete this task including all subtasks, time entries, comments, and attachments. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
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

"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useTaskFilters } from "@/lib/hooks/use-task-filters"
import { buildDetailUrl } from "@/lib/task-detail"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { TaskReferenceDataProvider } from "@/components/tasks/task-reference-data"
import { TasksHeader } from "@/components/tasks/tasks-header"
import { TasksTabs } from "@/components/tasks/tasks-tabs"
import { TasksTable } from "@/components/tasks/tasks-table"
import { TaskRow } from "@/components/tasks/task-row"
import { InlineAddTask } from "@/components/tasks/inline-add-task"
import { TasksFilterBar } from "@/components/tasks/tasks-filter-bar"
import { TaskFormModal } from "@/components/tasks/task-form-modal"
import { TaskDetailModal } from "@/components/tasks/task-detail-modal"
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

export default function TasksPage() {
  const { isAuthenticated } = useConvexAuth()
  const { membership, organization } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const orgId = organization?.id ?? ""

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const filters = useTaskFilters()
  const [filterBarOpen, setFilterBarOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)

  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters.tab])

  // Auto-open filter bar when filters are active
  useEffect(() => {
    if (filters.hasActiveFilters && !filterBarOpen) {
      setFilterBarOpen(true)
    }
  }, [filters.hasActiveFilters]) // eslint-disable-line react-hooks/exhaustive-deps

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
  if (listResult !== undefined) {
    lastResultRef.current = listResult
  }
  const displayResult = listResult ?? lastResultRef.current

  // Batch time query — all visible task IDs in one call (N+1 prevention)
  const allVisibleTaskIds = useMemo(() => {
    if (!displayResult) return []
    return displayResult.groups.flatMap((g) => g.tasks.map((t) => t._id))
  }, [displayResult])
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

  // Archive with undo
  function handleArchive(taskId: string) {
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
  }

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

  // Initial load — skeleton only on first render, never on tab switch
  if (!isAuthenticated || counts === undefined || displayResult === undefined) {
    return <TasksListSkeleton />
  }

  const isEmpty = displayResult.totalCount === 0

  return (
    <TaskReferenceDataProvider value={referenceData}>
    <div>
      <TasksHeader
        search={filters.search}
        onSearchChange={filters.setSearch}
        onNewTask={() => setCreateModalOpen(true)}
        totalCount={counts.all}
      />

      <div className="mt-4">
        <TasksTabs
          activeTab={filters.tab}
          onTabChange={filters.setTab}
          counts={counts}
          isSearching={filters.isSearching}
          groupBy={filters.groupBy}
          onGroupByChange={filters.setGroupBy}
          hasActiveFilters={filters.hasActiveFilters}
          onFilterToggle={() => setFilterBarOpen(!filterBarOpen)}
          isAdmin={isAdmin ?? false}
        />
      </div>

      {filterBarOpen && (
        <TasksFilterBar
          statusFilter={filters.statusFilter}
          projectFilter={filters.projectFilter}
          assigneeFilter={filters.assigneeFilter}
          categoryFilter={filters.categoryFilter}
          isAdmin={isAdmin ?? false}
          onFilterChange={filters.setFilter}
          onClearAll={filters.clearAllFilters}
        />
      )}

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
              groups={displayResult.groups}
              isGrouped={!!filters.groupBy}
              groupBy={filters.groupBy ?? ""}
              orgId={orgId}
              selectedIds={selectedIds}
              onSelectAll={(taskIds, selected) => {
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
              }}
              renderRow={(task) => (
                <TaskRow
                  key={task._id}
                  task={task}
                  isAdmin={isAdmin ?? false}
                  isSelected={selectedIds.has(task._id)}
                  hasSelection={selectedIds.size > 0}
                  onSelect={handleSelect}
                  onArchive={handleArchive}
                  onDelete={setDeleteTargetId}
                  onOpenDetail={handleOpenDetail}
                  totalMinutes={timeMap?.[task._id] ?? 0}
                  activity={activityMap?.[task._id]}
                />
              )}
              renderAddTask={(groupKey) => (
                <InlineAddTask
                  key={`add-${groupKey}`}
                  groupBy={filters.groupBy}
                  groupKey={groupKey}
                  isAdmin={isAdmin ?? false}
                  tab={filters.tab}
                />
              )}
            />
          </div>

          {/* Mobile: card view */}
          <div className="md:hidden">
            {displayResult.groups.map((group) => (
              <div key={group.key}>
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task._id}
                    task={task}
                    isSelected={selectedIds.has(task._id)}
                    hasSelection={selectedIds.size > 0}
                    onSelect={handleSelect}
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
        description="This will permanently delete this task and all subtasks. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />

      <TaskDetailModal
        taskIds={allVisibleTaskIds}
        isAdmin={isAdmin ?? false}
      />
    </div>
    </TaskReferenceDataProvider>
  )
}

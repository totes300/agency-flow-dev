"use client"

import { useState, useCallback, useEffect } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useConvexAuth } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
import { useTaskFilters } from "@/lib/hooks/use-task-filters"
import { useUndoAction } from "@/lib/hooks/use-undo-action"
import { TasksHeader } from "@/components/tasks/tasks-header"
import { TasksTabs } from "@/components/tasks/tasks-tabs"
import { TasksTable } from "@/components/tasks/tasks-table"
import { TaskRow } from "@/components/tasks/task-row"
import { InlineAddTask } from "@/components/tasks/inline-add-task"
import { TasksFilterBar } from "@/components/tasks/tasks-filter-bar"
import { TasksEmptyState } from "@/components/tasks/tasks-empty-state"
import { TasksListSkeleton } from "@/components/tasks/tasks-list-skeleton"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { toast } from "sonner"
import type { Id } from "@/convex/_generated/dataModel"

export default function TasksPage() {
  const { isAuthenticated } = useConvexAuth()
  const { membership, organization } = useOrganization()
  const isAdmin = membership?.role === "org:admin"
  const orgId = organization?.id ?? ""

  const filters = useTaskFilters()
  const [filterBarOpen, setFilterBarOpen] = useState(filters.hasActiveFilters)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  // Clear selection when tab changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [filters.tab])

  // Auto-open filter bar when filters become active (e.g. from URL on mount)
  useEffect(() => {
    if (filters.hasActiveFilters && !filterBarOpen) {
      setFilterBarOpen(true)
    }
  }, [filters.hasActiveFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  const archiveTask = useMutation(api.tasks.archive)
  const restoreTask = useMutation(api.tasks.restore)
  const removeTask = useMutation(api.tasks.remove)
  const { trigger: triggerUndo } = useUndoAction()

  // Queries
  const counts = useQuery(api.tasks.counts, isAuthenticated ? {} : "skip")
  const listResult = useQuery(api.tasks.list, isAuthenticated ? filters.toListArgs() : "skip")

  // Selection
  const handleSelect = useCallback((taskId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected && next.size < 50) {
        next.add(taskId)
      } else {
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
      toast.error(err instanceof Error ? err.message : "Failed to delete task")
    }
  }

  // Loading
  if (!isAuthenticated || counts === undefined || listResult === undefined) {
    return <TasksListSkeleton />
  }

  const isEmpty = listResult.totalCount === 0

  return (
    <div className="space-y-4">
      <TasksHeader
        search={filters.search}
        onSearchChange={filters.setSearch}
        onNewTask={() => {/* TODO: Chunk 8 */}}
        totalCount={counts[filters.tab]}
      />

      <TasksTabs
        activeTab={filters.tab}
        onTabChange={filters.setTab}
        counts={counts}
        groupBy={filters.groupBy}
        onGroupByChange={filters.setGroupBy}
        hasActiveFilters={filters.hasActiveFilters}
        onFilterToggle={() => setFilterBarOpen(!filterBarOpen)}
        isAdmin={isAdmin ?? false}
      />

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
          onClearFilters={filters.clearAllFilters}
          onNewTask={() => {/* TODO: Chunk 8 */}}
        />
      ) : (
        <TasksTable
          groups={listResult.groups}
          isGrouped={!!filters.groupBy}
          groupBy={filters.groupBy ?? ""}
          orgId={orgId}
          renderRow={(task) => (
            <TaskRow
              key={task._id}
              task={task}
              isAdmin={isAdmin ?? false}
              isSelected={selectedIds.has(task._id)}
              onSelect={handleSelect}
              onArchive={handleArchive}
              onDelete={setDeleteTargetId}
            />
          )}
          renderAddTask={(groupKey) => (
            <InlineAddTask
              key={`add-${groupKey}`}
              groupBy={filters.groupBy}
              groupKey={groupKey}
            />
          )}
        />
      )}

      {/* TODO: Chunk 8 — bulk toolbar + creation modal */}

      <ConfirmDialog
        open={!!deleteTargetId}
        onOpenChange={(open) => { if (!open) setDeleteTargetId(null) }}
        title="Delete task"
        description="This will permanently delete this task and all subtasks. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

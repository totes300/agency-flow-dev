"use client"

import { FilterPill } from "@/components/tasks/filter-pill"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { getStatusColor } from "@/lib/status-colors"
import { getCategoryColor } from "@/convex/lib/constants"
import type { FilterOp, FilterValue } from "@/lib/hooks/use-task-filters"

export function TasksFilterBar({
  statusFilter,
  projectFilter,
  assigneeFilter,
  categoryFilter,
  isAdmin,
  onFilterChange,
  onClearAll,
}: {
  statusFilter: FilterValue | null
  projectFilter: FilterValue | null
  assigneeFilter: FilterValue | null
  categoryFilter: FilterValue | null
  isAdmin: boolean
  onFilterChange: (field: "status" | "client" | "project" | "assignee" | "category", value: FilterValue | null) => void
  onClearAll: () => void
}) {
  const { statuses, categories, projects, orgMembers } = useTaskReferenceData()

  const statusOptions = (statuses ?? []).map((s) => ({
    id: s._id,
    label: s.name,
    color: getStatusColor(s.color).dot,
  }))

  const categoryOptions = (categories ?? []).map((c) => ({
    id: c._id,
    label: c.name,
    color: getCategoryColor(c.color).text,
  }))

  // Project options grouped by client name (like the inline-project-cell)
  const projectOptions = (projects ?? []).map((p) => ({
    id: p._id,
    label: `${p.clientName} · ${p.name}`,
  }))

  function pillProps(
    field: "status" | "project" | "assignee" | "category",
    filter: FilterValue | null,
  ) {
    return {
      value: filter?.value ?? null,
      operator: filter?.op ?? ("is" as FilterOp),
      onSelect: (ids: string) => onFilterChange(field, {
        op: filter?.op ?? "is",
        value: ids,
      }),
      onOperatorChange: (op: FilterOp) => {
        if (filter) {
          const isMultiOp = op === "anyOf" || op === "noneOf"
          const wasMulti = filter.op === "anyOf" || filter.op === "noneOf"
          let newValue = filter.value
          if (wasMulti && !isMultiOp && filter.value.includes(",")) {
            newValue = filter.value.split(",")[0]
          }
          onFilterChange(field, { op, value: newValue })
        }
      },
      onClear: () => onFilterChange(field, null),
    }
  }

  const hasAny = statusFilter || projectFilter || assigneeFilter || categoryFilter

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 py-2">
      <FilterPill
        label="Status"
        options={statusOptions}
        multiSelect
        {...pillProps("status", statusFilter)}
      />

      <FilterPill
        label="Project"
        options={projectOptions}
        multiSelect
        {...pillProps("project", projectFilter)}
      />

      <FilterPill
        label="Category"
        options={categoryOptions}
        multiSelect
        {...pillProps("category", categoryFilter)}
      />

      <FilterPill
        label="Assignee"
        options={(orgMembers ?? []).map((m) => ({
          id: m._id,
          label: m.name,
        }))}
        multiSelect
        {...pillProps("assignee", assigneeFilter)}
      />

      {hasAny && (
        <button
          onClick={onClearAll}
          className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

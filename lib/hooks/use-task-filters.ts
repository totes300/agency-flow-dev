"use client"

import { useState, useCallback } from "react"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type TaskTab = "all" | "backlog" | "in_progress" | "review" | "blocked" | "done"
export type GroupByOption = "project" | "client" | "category" | "assignee" | "status" | null
export type FilterOp = "is" | "isNot" | "anyOf" | "noneOf"

export type FilterValue = {
  op: FilterOp
  value: string // single ID or comma-separated IDs for anyOf/noneOf
}

// ─── State shape ────────────────────────────────────────────────────────────────

type TaskViewState = {
  tab: TaskTab
  search: string
  groupBy: GroupByOption
  statusFilter: FilterValue | null
  clientFilter: FilterValue | null
  projectFilter: FilterValue | null
  assigneeFilter: FilterValue | null
  categoryFilter: FilterValue | null
  dateFrom: string | null
  dateTo: string | null
}

const INITIAL_STATE: TaskViewState = {
  tab: "backlog",
  search: "",
  groupBy: null,
  statusFilter: null,
  clientFilter: null,
  projectFilter: null,
  assigneeFilter: null,
  categoryFilter: null,
  dateFrom: null,
  dateTo: null,
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useTaskFilters() {
  const [state, setState] = useState<TaskViewState>(INITIAL_STATE)

  // ── Derived ─────────────────────────────────────────────────────────────

  const hasActiveFilters = !!(
    state.statusFilter || state.clientFilter || state.projectFilter ||
    state.assigneeFilter || state.categoryFilter || state.dateFrom || state.dateTo
  )

  const isSearching = state.search.length > 0

  // ── Setters ─────────────────────────────────────────────────────────────

  const setTab = useCallback((tab: TaskTab) => {
    setState((s) => ({ ...s, tab, search: "" }))
  }, [])

  const setSearch = useCallback((search: string) => {
    setState((s) => ({ ...s, search }))
  }, [])

  const setGroupBy = useCallback((groupBy: GroupByOption) => {
    setState((s) => ({ ...s, groupBy }))
  }, [])

  const setFilter = useCallback((
    field: "status" | "client" | "project" | "assignee" | "category",
    value: FilterValue | null,
  ) => {
    const key = `${field}Filter` as keyof TaskViewState
    setState((s) => ({ ...s, [key]: value }))
  }, [])

  const setDateRange = useCallback((from: string | null, to: string | null) => {
    setState((s) => ({ ...s, dateFrom: from, dateTo: to }))
  }, [])

  const clearAllFilters = useCallback(() => {
    setState((s) => ({
      ...s,
      statusFilter: null,
      clientFilter: null,
      projectFilter: null,
      assigneeFilter: null,
      categoryFilter: null,
      dateFrom: null,
      dateTo: null,
    }))
  }, [])

  // ── Build Convex query args ───────────────────────────────────────────

  function toListArgs() {
    type SingleOp = "is" | "isNot"
    type MultiOp = "is" | "isNot" | "anyOf" | "noneOf"

    function toSingleOp(op: FilterOp): SingleOp {
      if (op === "anyOf") return "is"
      if (op === "noneOf") return "isNot"
      return op as SingleOp
    }

    const filters: {
      statusId?: { op: MultiOp; value: Id<"statuses">[] }
      clientId?: { op: SingleOp; value: Id<"clients"> }
      projectId?: { op: MultiOp; value: Id<"projects">[] }
      assigneeIds?: { op: MultiOp; value: Id<"users">[] }
      workCategoryId?: { op: MultiOp; value: Id<"workCategories">[] }
      dateFrom?: string
      dateTo?: string
    } = {}

    if (state.statusFilter) {
      filters.statusId = {
        op: state.statusFilter.op,
        value: state.statusFilter.value.split(",") as Id<"statuses">[],
      }
    }

    if (state.clientFilter) {
      filters.clientId = {
        op: toSingleOp(state.clientFilter.op),
        value: state.clientFilter.value.split(",")[0] as Id<"clients">,
      }
    }

    if (state.projectFilter) {
      filters.projectId = {
        op: state.projectFilter.op,
        value: state.projectFilter.value.split(",") as Id<"projects">[],
      }
    }

    if (state.assigneeFilter) {
      filters.assigneeIds = {
        op: state.assigneeFilter.op,
        value: state.assigneeFilter.value.split(",") as Id<"users">[],
      }
    }

    if (state.categoryFilter) {
      filters.workCategoryId = {
        op: state.categoryFilter.op,
        value: state.categoryFilter.value.split(",") as Id<"workCategories">[],
      }
    }

    if (state.dateFrom) filters.dateFrom = state.dateFrom
    if (state.dateTo) filters.dateTo = state.dateTo

    const hasFilters = Object.keys(filters).length > 0

    // Search spans all tasks — send "all" tab to backend
    const effectiveTab = isSearching ? "all" as const : state.tab

    return {
      tab: effectiveTab,
      filters: hasFilters ? (filters as typeof filters) : undefined,
      groupBy: state.groupBy,
      search: state.search || undefined,
    }
  }

  return {
    // State
    tab: state.tab,
    groupBy: state.groupBy,
    search: state.search,
    statusFilter: state.statusFilter,
    clientFilter: state.clientFilter,
    projectFilter: state.projectFilter,
    assigneeFilter: state.assigneeFilter,
    categoryFilter: state.categoryFilter,
    dateFrom: state.dateFrom,
    dateTo: state.dateTo,
    hasActiveFilters,
    isSearching,

    // Setters
    setTab,
    setGroupBy,
    setSearch,
    setFilter,
    setDateRange,
    clearAllFilters,

    // Convex args builder
    toListArgs,
  }
}

"use client"

import { useState, useCallback, useMemo } from "react"
import type { Filter } from "@/components/ui/filters"
import { FilterOperator } from "@/components/ui/filters"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type TaskTab = "all" | "backlog" | "in_progress" | "review" | "blocked" | "done" | "archived"
export type GroupByOption = "project" | "client" | "category" | "assignee" | "status" | null
export type FilterOp = "is" | "isNot" | "anyOf" | "noneOf"

// ─── State shape ────────────────────────────────────────────────────────────────

type TaskViewState = {
  tab: TaskTab
  search: string
  groupBy: GroupByOption
  filters: Filter[]
}

const INITIAL_STATE: TaskViewState = {
  tab: "backlog",
  search: "",
  groupBy: null,
  filters: [],
}

// ─── Helpers: map new filter model → Convex args ─────────────────────────────

function operatorToFilterOp(op: FilterOperator, multiValue: boolean): FilterOp {
  switch (op) {
    case FilterOperator.IS:
      return multiValue ? "anyOf" : "is"
    case FilterOperator.IS_NOT:
      return multiValue ? "noneOf" : "isNot"
    case FilterOperator.IS_ANY_OF:
    case FilterOperator.INCLUDE_ANY_OF:
    case FilterOperator.INCLUDE:
      return "anyOf"
    case FilterOperator.DO_NOT_INCLUDE:
    case FilterOperator.EXCLUDE_ALL_OF:
    case FilterOperator.EXCLUDE_IF_ANY_OF:
      return "noneOf"
    case FilterOperator.INCLUDE_ALL_OF:
      return "anyOf"
    default:
      return "is"
  }
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50
const LOAD_MORE_INCREMENT = 50

export function useTaskFilters() {
  const [state, setState] = useState<TaskViewState>(INITIAL_STATE)
  const [limit, setLimit] = useState(DEFAULT_LIMIT)

  // ── Derived ─────────────────────────────────────────────────────────────

  const hasActiveFilters = state.filters.some((f) => f.value.length > 0)
  const isSearching = state.search.length > 0

  // ── Setters ─────────────────────────────────────────────────────────────

  const setTab = useCallback((tab: TaskTab) => {
    setState((s) => ({ ...s, tab, search: "" }))
    setLimit(DEFAULT_LIMIT)
  }, [])

  const setSearch = useCallback((search: string) => {
    setState((s) => ({ ...s, search }))
  }, [])

  const setGroupBy = useCallback((groupBy: GroupByOption) => {
    setState((s) => ({ ...s, groupBy }))
  }, [])

  const setFilters = useCallback((updater: Filter[] | ((prev: Filter[]) => Filter[])) => {
    setState((s) => ({
      ...s,
      filters: typeof updater === "function" ? updater(s.filters) : updater,
    }))
  }, [])

  const clearAllFilters = useCallback(() => {
    setState((s) => ({ ...s, filters: [] }))
    setLimit(DEFAULT_LIMIT)
  }, [])

  const loadMore = useCallback(() => {
    setLimit((prev) => prev + LOAD_MORE_INCREMENT)
  }, [])

  // ── Build Convex query args (memoized to avoid re-subscriptions) ─────

  type SingleOp = "is" | "isNot"
  type MultiOp = "is" | "isNot" | "anyOf" | "noneOf"

  const listArgs = useMemo(() => {
    const convexFilters: {
      statusId?: { op: MultiOp; value: Id<"statuses">[] }
      clientId?: { op: SingleOp; value: Id<"clients"> }
      projectId?: { op: MultiOp; value: Id<"projects">[] }
      assigneeIds?: { op: MultiOp; value: Id<"users">[] }
      workCategoryId?: { op: MultiOp; value: Id<"workCategories">[] }
      dateFrom?: string
      dateTo?: string
    } = {}

    for (const filter of state.filters) {
      if (filter.value.length === 0) continue
      const isMulti = filter.value.length > 1
      const op = operatorToFilterOp(filter.operator, isMulti)

      switch (filter.type) {
        case "status":
          convexFilters.statusId = {
            op,
            value: filter.value as unknown as Id<"statuses">[],
          }
          break
        case "project":
          convexFilters.projectId = {
            op,
            value: filter.value as unknown as Id<"projects">[],
          }
          break
        case "category":
          convexFilters.workCategoryId = {
            op,
            value: filter.value as unknown as Id<"workCategories">[],
          }
          break
        case "assignee":
          convexFilters.assigneeIds = {
            op,
            value: filter.value as unknown as Id<"users">[],
          }
          break
        case "client": {
          // Client filter uses single value with is/isNot op
          const clientOp = op === "anyOf" || op === "is" ? "is" : "isNot"
          convexFilters.clientId = {
            op: clientOp as SingleOp,
            value: filter.value[0] as unknown as Id<"clients">,
          }
          break
        }
        case "dueDate": {
          // Date range filter: value is [from, to] as ISO date strings
          const [from, to] = filter.value
          if (from) convexFilters.dateFrom = from
          if (to) convexFilters.dateTo = to
          break
        }
      }
    }

    const hasFilters = Object.keys(convexFilters).length > 0

    // Search spans all tasks — send "all" tab to backend
    const effectiveTab = state.search ? "all" as const : state.tab

    return {
      tab: effectiveTab,
      filters: hasFilters ? (convexFilters as typeof convexFilters) : undefined,
      groupBy: state.groupBy,
      search: state.search || undefined,
      limit,
    }
  }, [state, limit])

  return {
    // State
    tab: state.tab,
    groupBy: state.groupBy,
    search: state.search,
    filters: state.filters,
    hasActiveFilters,
    isSearching,

    // Setters
    setTab,
    setGroupBy,
    setSearch,
    setFilters,
    clearAllFilters,
    loadMore,

    // Convex args (memoized)
    listArgs,
  }
}

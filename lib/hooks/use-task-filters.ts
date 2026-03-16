"use client"

import { useQueryStates, parseAsString, parseAsStringEnum } from "nuqs"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type TaskTab = "active" | "backlog" | "today" | "review" | "blocked" | "done"
export type GroupByOption = "project" | "client" | "category" | "assignee" | "status" | null
export type FilterOp = "is" | "isNot" | "anyOf" | "noneOf"

export type FilterValue = {
  op: FilterOp
  value: string // single ID or comma-separated IDs for anyOf/noneOf
}

// ─── Parsers ────────────────────────────────────────────────────────────────────

const TABS: TaskTab[] = ["active", "backlog", "today", "review", "blocked", "done"]
const GROUP_BY_OPTIONS = ["project", "client", "category", "assignee", "status"] as const

/**
 * Custom parser for filter values in the format "op:value" or "op:val1,val2"
 * e.g. "is:abc123" or "anyOf:abc123,def456"
 */
function parseAsFilter() {
  return {
    parse: (value: string): FilterValue | null => {
      const colonIdx = value.indexOf(":")
      if (colonIdx === -1) return null
      const op = value.slice(0, colonIdx) as FilterOp
      const val = value.slice(colonIdx + 1)
      if (!["is", "isNot", "anyOf", "noneOf"].includes(op)) return null
      if (!val) return null
      return { op, value: val }
    },
    serialize: (filter: FilterValue): string => {
      return `${filter.op}:${filter.value}`
    },
    eq: (a: FilterValue | null, b: FilterValue | null): boolean => {
      if (a === null && b === null) return true
      if (a === null || b === null) return false
      return a.op === b.op && a.value === b.value
    },
  }
}

// ─── nuqs state definition ──────────────────────────────────────────────────────

const taskFilterParsers = {
  tab: parseAsStringEnum<TaskTab>(TABS).withDefault("active"),
  groupBy: parseAsString.withDefault(""),
  search: parseAsString.withDefault(""),
  // Filter params — each is "op:value" format
  status: parseAsString.withDefault(""),
  client: parseAsString.withDefault(""),
  project: parseAsString.withDefault(""),
  assignee: parseAsString.withDefault(""),
  category: parseAsString.withDefault(""),
  dateFrom: parseAsString.withDefault(""),
  dateTo: parseAsString.withDefault(""),
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

export function useTaskFilters() {
  const [params, setParams] = useQueryStates(taskFilterParsers, {
    history: "replace",
  })

  // ── Derived values ──────────────────────────────────────────────────────

  const tab: TaskTab = params.tab

  const groupBy: GroupByOption = GROUP_BY_OPTIONS.includes(params.groupBy as any)
    ? (params.groupBy as GroupByOption)
    : null

  const search = params.search || ""

  // Parse filter strings into structured objects
  const filterParser = parseAsFilter()

  function parseFilterParam(raw: string): FilterValue | null {
    if (!raw) return null
    return filterParser.parse(raw)
  }

  const statusFilter = parseFilterParam(params.status)
  const clientFilter = parseFilterParam(params.client)
  const projectFilter = parseFilterParam(params.project)
  const assigneeFilter = parseFilterParam(params.assignee)
  const categoryFilter = parseFilterParam(params.category)

  const hasActiveFilters = !!(
    params.status || params.client || params.project || params.assignee ||
    params.category || params.dateFrom || params.dateTo
  )

  // ── Setters ─────────────────────────────────────────────────────────────

  function setTab(newTab: TaskTab) {
    setParams({ tab: newTab }, { history: "push" })
  }

  function setGroupBy(option: GroupByOption) {
    setParams({ groupBy: option ?? "" })
  }

  function setSearch(value: string) {
    setParams({ search: value || "" })
  }

  function setFilter(
    field: "status" | "client" | "project" | "assignee" | "category",
    value: FilterValue | null
  ) {
    setParams({
      [field]: value ? filterParser.serialize(value) : "",
    })
  }

  function setDateRange(from: string | null, to: string | null) {
    setParams({
      dateFrom: from ?? "",
      dateTo: to ?? "",
    })
  }

  function clearAllFilters() {
    setParams({
      status: "",
      client: "",
      project: "",
      assignee: "",
      category: "",
      dateFrom: "",
      dateTo: "",
    })
  }

  // ── Build Convex query args ─────────────────────────────────────────────

  /**
   * Convert parsed URL state into the args shape expected by `tasks.list`.
   * Returns a plain object that can be spread directly into `useQuery(api.tasks.list, ...)`.
   *
   * Note: Convex ID strings from the URL are passed as-is — Convex accepts valid
   * ID strings for `v.id()` validators at runtime.
   */
  function toListArgs() {
    type SingleOp = "is" | "isNot"
    type MultiOp = "is" | "isNot" | "anyOf" | "noneOf"

    // Normalize multi-value ops to single-value ops for single-value fields
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

    if (statusFilter) {
      filters.statusId = {
        op: statusFilter.op,
        value: statusFilter.value.split(",") as Id<"statuses">[],
      }
    }

    if (clientFilter) {
      filters.clientId = {
        op: toSingleOp(clientFilter.op),
        value: clientFilter.value.split(",")[0] as Id<"clients">,
      }
    }

    if (projectFilter) {
      filters.projectId = {
        op: projectFilter.op,
        value: projectFilter.value.split(",") as Id<"projects">[],
      }
    }

    if (assigneeFilter) {
      filters.assigneeIds = {
        op: assigneeFilter.op,
        value: assigneeFilter.value.split(",") as Id<"users">[],
      }
    }

    if (categoryFilter) {
      filters.workCategoryId = {
        op: categoryFilter.op,
        value: categoryFilter.value.split(",") as Id<"workCategories">[],
      }
    }

    if (params.dateFrom) filters.dateFrom = params.dateFrom
    if (params.dateTo) filters.dateTo = params.dateTo

    const hasFilters = Object.keys(filters).length > 0

    return {
      tab,
      filters: hasFilters ? (filters as typeof filters) : undefined,
      groupBy: groupBy,
      search: search || undefined,
    }
  }

  return {
    // State
    tab,
    groupBy,
    search,
    statusFilter,
    clientFilter,
    projectFilter,
    assigneeFilter,
    categoryFilter,
    dateFrom: params.dateFrom || null,
    dateTo: params.dateTo || null,
    hasActiveFilters,

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

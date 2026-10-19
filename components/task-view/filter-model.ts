import type { Id } from "@/convex/_generated/dataModel"
import { NONE_FILTER_VALUE, PRIORITY_LABELS, type TaskPriority } from "@/convex/tasks/model"
import { matchesFilters, resolveFilterValue, type FilterSubject, type ListFilter } from "@/convex/tasks/filters"
import type { RefIndex, TaskRowModel } from "@/components/task-view/row-model"

/**
 * Client-side filters and facets (U7, docs/prd-tasks-refactor.md §5.4).
 * Pure. Chips (the editable filters) and the title search run over the rows
 * `listView` returned; facet counts for a property come from the rows that
 * pass every OTHER chip, so picking a client narrows the project facet to that
 * client's projects (Notion-style). Matching is the shared
 * `convex/tasks/filters.ts`, the same code the server runs for a view's scope.
 */

export type FilterField =
  | "status"
  | "priority"
  | "assignee"
  | "label"
  | "project"
  | "client"
  | "workCategory"
  | "createdBy"
  | "newComments"

/** The properties the "+ Filter" menu offers, in menu order. */
export const FILTER_FIELDS: ReadonlyArray<{ key: FilterField; label: string }> = [
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "assignee", label: "Assignee" },
  { key: "label", label: "Labels" },
  { key: "project", label: "Project" },
  { key: "client", label: "Client" },
  { key: "workCategory", label: "Category" },
  { key: "createdBy", label: "Created by" },
  { key: "newComments", label: "New comments" },
]

const FIELD_LABEL = new Map(FILTER_FIELDS.map((f) => [f.key, f.label]))

export function filterFieldLabel(property: ListFilter["property"]): string {
  return FIELD_LABEL.get(property as FilterField) ?? property
}

export function isFilterField(property: ListFilter["property"]): property is FilterField {
  return FIELD_LABEL.has(property as FilterField)
}

/** The filterable fields of a row, with the client resolved through the project. */
export function subjectOf(row: TaskRowModel): FilterSubject {
  return { ...row.task, clientId: row.client?._id ?? null }
}

function matchesRow(row: TaskRowModel, chips: readonly ListFilter[], me: string): boolean {
  return matchesFilters(subjectOf(row), chips, me, row.perUser.unreadComments)
}

/** Rows passing every chip. */
export function applyChips(rows: readonly TaskRowModel[], chips: readonly ListFilter[], me: string): TaskRowModel[] {
  if (chips.length === 0) return [...rows]
  return rows.filter((row) => matchesRow(row, chips, me))
}

/** Case-insensitive title / identifier search (the old /tasks search box). */
export function applySearch(rows: readonly TaskRowModel[], search: string): TaskRowModel[] {
  const q = search.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter(
    (row) => row.task.title.toLowerCase().includes(q) || (row.task.identifier?.toLowerCase().includes(q) ?? false),
  )
}

/** The facet keys a row contributes to `field` (several for multi-value properties). */
export function facetKeysOf(row: TaskRowModel, field: FilterField): string[] {
  const t = row.task
  const orNone = (ids: readonly string[]) => (ids.length > 0 ? [...ids] : [NONE_FILTER_VALUE])
  switch (field) {
    case "status":
      return [t.statusId]
    case "priority":
      return [String(t.priority)]
    case "assignee":
      return orNone(t.assigneeIds)
    case "label":
      return orNone(t.labelIds)
    case "project":
      return [t.projectId ?? NONE_FILTER_VALUE]
    case "client":
      return [row.client?._id ?? NONE_FILTER_VALUE]
    case "workCategory":
      return [t.workCategoryId ?? NONE_FILTER_VALUE]
    case "createdBy":
      return [t.createdBy]
    case "newComments":
      return [row.perUser.unreadComments > 0 ? "true" : "false"]
  }
}

export type FacetOption = {
  /** The filter value. */
  key: string
  label: string
  count: number
  selected: boolean
  /** Ref colour key (status/label/category palettes), when the value has one. */
  color?: string
}

type Candidate = { key: string; label: string; color?: string; archived?: boolean }

const NONE_LABEL: Partial<Record<FilterField, string>> = {
  assignee: "No assignee",
  label: "No label",
  project: "No project",
  client: "No client",
  workCategory: "No category",
}

function candidatesFor(field: FilterField, index: RefIndex): Candidate[] {
  const { refs } = index
  const none = NONE_LABEL[field] ? [{ key: NONE_FILTER_VALUE, label: NONE_LABEL[field]! }] : []
  const byName = <T extends { name: string }>(xs: readonly T[]) => [...xs].sort((a, b) => a.name.localeCompare(b.name))
  switch (field) {
    case "status":
      return refs.statuses.map((s) => ({ key: s._id, label: s.name, color: s.color, archived: s.archived }))
    case "priority":
      return ([1, 2, 3, 4, 0] as TaskPriority[]).map((p) => ({ key: String(p), label: PRIORITY_LABELS[p] }))
    case "assignee":
    case "createdBy": {
      const me = refs.me
      const members = byName(refs.members).sort((a, b) => Number(b._id === me) - Number(a._id === me))
      return [
        ...members.map((m) => ({ key: m._id as string, label: m._id === me ? `${m.name} (you)` : m.name })),
        ...(field === "assignee" ? none : []),
      ]
    }
    case "label":
      return [...refs.labels.map((l) => ({ key: l._id as string, label: l.name, color: l.color, archived: l.archived })), ...none]
    case "project":
      return [
        ...[...refs.projects]
          .map((p) => ({ p, client: index.clientById.get(p.clientId)?.name ?? "" }))
          .sort((a, b) => a.client.localeCompare(b.client) || a.p.name.localeCompare(b.p.name))
          .map(({ p, client }) => ({ key: p._id as string, label: client ? `${client} › ${p.name}` : p.name, archived: p.archived })),
        ...none,
      ]
    case "client":
      return [...byName(refs.clients).map((c) => ({ key: c._id as string, label: c.name, archived: c.archived })), ...none]
    case "workCategory":
      return [
        ...refs.workCategories.map((c) => ({ key: c._id as string, label: c.name, color: c.color, archived: c.archived })),
        ...none,
      ]
    case "newComments":
      return [
        { key: "true", label: "Has new comments" },
        { key: "false", label: "No new comments" },
      ]
  }
}

/** The `is` chip on `field`, if any (the one the menu edits). */
export function chipFor(chips: readonly ListFilter[], field: FilterField): ListFilter | undefined {
  return chips.find((c) => c.property === field && c.operator === "is")
}

/** Selected values of `field`'s chip, with `me` resolved to the caller. */
export function selectedValues(chips: readonly ListFilter[], field: FilterField, me: string): Set<string> {
  return new Set((chipFor(chips, field)?.values ?? []).map((v) => resolveFilterValue(v, me)))
}

/**
 * The value list for `field`: every value present in the rows that pass the
 * other chips (with its count), plus selected values even at zero. Values
 * absent from the pool and archived refs are hidden.
 */
export function facetOptions(
  rows: readonly TaskRowModel[],
  chips: readonly ListFilter[],
  field: FilterField,
  index: RefIndex,
  me: string,
): FacetOption[] {
  const others = chips.filter((c) => c.property !== field)
  const pool = applyChips(rows, others, me)
  const counts = new Map<string, number>()
  for (const row of pool) {
    for (const key of new Set(facetKeysOf(row, field))) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const selected = selectedValues(chips, field, me)
  return candidatesFor(field, index)
    .filter((c) => counts.has(c.key) || selected.has(c.key))
    .map((c) => ({ key: c.key, label: c.label, color: c.color, count: counts.get(c.key) ?? 0, selected: selected.has(c.key) }))
}

/**
 * Toggles one value of `field`'s `is` chip: adds the chip when missing,
 * drops it when its last value goes. Single-value fields (new comments)
 * replace the value instead.
 */
export function toggleChipValue(chips: readonly ListFilter[], field: FilterField, value: string, me: string): ListFilter[] {
  const existing = chipFor(chips, field)
  if (!existing) return [...chips, { property: field, operator: "is", values: [value] }]
  const current = existing.values.map((v) => resolveFilterValue(v, me))
  const values =
    field === "newComments"
      ? current.includes(value) ? [] : [value]
      : current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return values.length === 0
    ? chips.filter((c) => c !== existing)
    : chips.map((c) => (c === existing ? { ...c, values } : c))
}

export function removeChip(chips: readonly ListFilter[], chip: ListFilter): ListFilter[] {
  return chips.filter((c) => c !== chip)
}

/** Display name of one filter value, for a chip. */
export function valueLabel(field: ListFilter["property"], value: string, index: RefIndex, me: string): string {
  if (!isFilterField(field)) return value
  const key = resolveFilterValue(value, me)
  const hit = candidatesFor(field, index).find((c) => c.key === key)
  if (hit) return hit.label
  if (field === "assignee" || field === "createdBy") return index.memberById.get(key as Id<"users">)?.name ?? "Unknown"
  return "Unknown"
}

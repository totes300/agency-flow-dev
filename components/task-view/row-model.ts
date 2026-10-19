import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  isClosedCategory,
  isTaskCategory,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  prioritySortRank,
  type TaskCategory,
  type TaskPriority,
  type TaskViewSpec,
} from "@/convex/tasks/model"
import type { PerUserRowState } from "@/convex/tasks/read"

/**
 * Client-side row model (docs/prd-tasks-refactor.md §5.4): `listView` rows are
 * flat and id-based; names, colours and avatars are resolved here from the
 * single `workspaceRefs.get` subscription. Grouping and ordering run over the
 * loaded rows, so they are instant and keep the server contract small.
 */

export type WorkspaceRefs = FunctionReturnType<typeof api.workspaceRefs.get>
export type ListViewResult = FunctionReturnType<typeof api.tasks.queries.listView>
export type TaskRowDTO = ListViewResult["rows"][number]

export type StatusRef = WorkspaceRefs["statuses"][number]
export type LabelRef = WorkspaceRefs["labels"][number]
export type ProjectRef = WorkspaceRefs["projects"][number]
export type ClientRef = WorkspaceRefs["clients"][number]
export type MemberRef = WorkspaceRefs["members"][number]
export type WorkCategoryRef = WorkspaceRefs["workCategories"][number]

export const DEFAULT_PER_USER_STATE: PerUserRowState = {
  unreadComments: 0,
  hasUnseenChanges: false,
  inMyToday: false,
}

export type RefIndex = {
  refs: WorkspaceRefs
  statusById: Map<Id<"statuses">, StatusRef>
  labelById: Map<Id<"labels">, LabelRef>
  projectById: Map<Id<"projects">, ProjectRef>
  clientById: Map<Id<"clients">, ClientRef>
  memberById: Map<Id<"users">, MemberRef>
  categoryById: Map<Id<"workCategories">, WorkCategoryRef>
}

export function indexRefs(refs: WorkspaceRefs): RefIndex {
  return {
    refs,
    statusById: new Map(refs.statuses.map((s) => [s._id, s])),
    labelById: new Map(refs.labels.map((l) => [l._id, l])),
    projectById: new Map(refs.projects.map((p) => [p._id, p])),
    clientById: new Map(refs.clients.map((c) => [c._id, c])),
    memberById: new Map(refs.members.map((m) => [m._id, m])),
    categoryById: new Map(refs.workCategories.map((c) => [c._id, c])),
  }
}

export type TaskRowModel = {
  task: TaskRowDTO
  status: StatusRef | null
  category: TaskCategory | null
  isClosed: boolean
  project: ProjectRef | null
  client: ClientRef | null
  workCategory: WorkCategoryRef | null
  assignees: MemberRef[]
  labels: LabelRef[]
  perUser: PerUserRowState
  /** Title of the parent when this row is a sub-task and the parent is loaded. */
  parentTitle: string | null
}

export function buildRowModels(
  rows: readonly TaskRowDTO[],
  perUser: Record<string, PerUserRowState>,
  index: RefIndex,
): TaskRowModel[] {
  const titleById = new Map(rows.map((r) => [r._id, r.title]))
  return rows.map((task) => {
    const status = index.statusById.get(task.statusId) ?? null
    const category = task.statusCategory ?? status?.category ?? null
    const project = task.projectId ? index.projectById.get(task.projectId) ?? null : null
    const clientId = task.clientId ?? project?.clientId ?? null
    return {
      task,
      status,
      category,
      isClosed: category !== null && isClosedCategory(category),
      project,
      client: clientId ? index.clientById.get(clientId) ?? null : null,
      workCategory: task.workCategoryId ? index.categoryById.get(task.workCategoryId) ?? null : null,
      assignees: task.assigneeIds.flatMap((id) => index.memberById.get(id) ?? []),
      labels: task.labelIds.flatMap((id) => index.labelById.get(id) ?? []),
      perUser: perUser[task._id] ?? DEFAULT_PER_USER_STATE,
      parentTitle: task.parentTaskId ? titleById.get(task.parentTaskId) ?? null : null,
    }
  })
}

// ─── Ordering ────────────────────────────────────────────────────────────────

type Compare = (a: TaskRowDTO, b: TaskRowDTO) => number

function bySortKey(a: TaskRowDTO, b: TaskRowDTO): number {
  if (a.sortKey === b.sortKey) return a.createdAt - b.createdAt
  if (a.sortKey === null) return 1
  if (b.sortKey === null) return -1
  return a.sortKey < b.sortKey ? -1 : 1
}

/** Ascending on a nullable string; nulls last. */
function ascNullsLast(get: (t: TaskRowDTO) => string | null): Compare {
  return (a, b) => {
    const x = get(a)
    const y = get(b)
    if (x === y) return 0
    if (x === null) return 1
    if (y === null) return -1
    return x < y ? -1 : 1
  }
}

const COMPARE: Record<TaskViewSpec["orderBy"], Compare> = {
  manual: () => 0,
  priority: (a, b) => prioritySortRank(a.priority) - prioritySortRank(b.priority),
  dueDate: ascNullsLast((t) => t.dueDate),
  startDate: ascNullsLast((t) => t.startDate),
  createdAt: (a, b) => b.createdAt - a.createdAt,
  updatedAt: (a, b) => b.updatedAt - a.updatedAt,
  lastActivityAt: (a, b) => b.lastActivityAt - a.lastActivityAt,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
}

/** Orders rows by the view's `orderBy`; ties fall back to the manual order (sort key). */
export function sortRows(rows: readonly TaskRowModel[], orderBy: TaskViewSpec["orderBy"]): TaskRowModel[] {
  const compare = COMPARE[orderBy]
  return [...rows].sort((a, b) => compare(a.task, b.task) || bySortKey(a.task, b.task))
}

// ─── Grouping ────────────────────────────────────────────────────────────────

export type GroupHeader =
  | { kind: "none" }
  | { kind: "status"; status: StatusRef }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "assignee"; member: MemberRef | null }
  | { kind: "project"; project: ProjectRef | null; client: ClientRef | null }
  | { kind: "client"; client: ClientRef | null }
  | { kind: "workCategory"; category: WorkCategoryRef | null }
  | { kind: "label"; label: LabelRef | null }
  /** The caller's Today plan (the dashboard "My work" board, §11.8). */
  | { kind: "today" }

export type TaskGroup = {
  key: string
  label: string
  header: GroupHeader
  rows: TaskRowModel[]
}

const NONE_KEY = "none"

/** Categories a view is scoped to by its `statusCategory is …` filter (all when unscoped). */
export function scopeCategories(spec: Pick<TaskViewSpec, "filters">): TaskCategory[] | null {
  const filter = spec.filters.find((f) => f.property === "statusCategory" && f.operator === "is")
  if (!filter) return null
  return filter.values.filter(isTaskCategory)
}

type Bucket = { key: string; label: string; header: GroupHeader; archived: boolean }

function collect(
  rows: readonly TaskRowModel[],
  buckets: Bucket[],
  keysOf: (row: TaskRowModel) => string[],
  showEmpty: boolean,
): TaskGroup[] {
  const byKey = new Map<string, TaskRowModel[]>()
  for (const row of rows) {
    for (const key of keysOf(row)) {
      const list = byKey.get(key)
      if (list) list.push(row)
      else byKey.set(key, [row])
    }
  }
  return buckets
    .filter((b) => byKey.has(b.key) || (showEmpty && !b.archived))
    .map((b) => ({ key: b.key, label: b.label, header: b.header, rows: byKey.get(b.key) ?? [] }))
}

/**
 * Groups already-ordered rows. Multi-value properties (assignees, labels)
 * put a row in every matching group. Empty groups are kept only with
 * `showEmptyGroups`, never for archived refs, and for status grouping only
 * for statuses inside the view's category scope.
 */
export function groupRows(
  rows: readonly TaskRowModel[],
  spec: Pick<TaskViewSpec, "groupBy" | "showEmptyGroups" | "filters">,
  index: RefIndex,
): TaskGroup[] {
  const { refs } = index
  const showEmpty = spec.showEmptyGroups

  switch (spec.groupBy) {
    case "none":
      return [{ key: "all", label: "", header: { kind: "none" }, rows: [...rows] }]

    case "status": {
      const scope = scopeCategories(spec)
      const buckets = refs.statuses.map((s) => ({
        key: s._id,
        label: s.name,
        header: { kind: "status", status: s } as const,
        archived: s.archived || (scope !== null && !scope.includes(s.category)),
      }))
      return collect(rows, buckets, (r) => [r.task.statusId], showEmpty)
    }

    case "priority": {
      const order: TaskPriority[] = [...PRIORITY_VALUES.filter((p) => p !== 0), 0]
      const buckets = order.map((p) => ({
        key: String(p),
        label: PRIORITY_LABELS[p],
        header: { kind: "priority", priority: p } as const,
        archived: false,
      }))
      return collect(rows, buckets, (r) => [String(r.task.priority)], showEmpty)
    }

    case "assignee": {
      const members = [...refs.members].sort((a, b) => a.name.localeCompare(b.name))
      const buckets: Bucket[] = [
        ...members.map((m) => ({ key: m._id, label: m.name, header: { kind: "assignee", member: m } as const, archived: false })),
        { key: NONE_KEY, label: "No assignee", header: { kind: "assignee", member: null }, archived: false },
      ]
      return collect(rows, buckets, (r) => (r.task.assigneeIds.length > 0 ? r.task.assigneeIds : [NONE_KEY]), showEmpty)
    }

    case "project": {
      const clientName = (p: ProjectRef) => index.clientById.get(p.clientId)?.name ?? ""
      const projects = [...refs.projects].sort(
        (a, b) => clientName(a).localeCompare(clientName(b)) || a.name.localeCompare(b.name),
      )
      const buckets: Bucket[] = [
        ...projects.map((p) => {
          const client = index.clientById.get(p.clientId) ?? null
          return {
            key: p._id,
            label: client ? `${client.name} › ${p.name}` : p.name,
            header: { kind: "project", project: p, client } as const,
                archived: p.archived,
          }
        }),
        { key: NONE_KEY, label: "No project", header: { kind: "project", project: null, client: null }, archived: false },
      ]
      return collect(rows, buckets, (r) => [r.task.projectId ?? NONE_KEY], showEmpty)
    }

    case "client": {
      const clients = [...refs.clients].sort((a, b) => a.name.localeCompare(b.name))
      const buckets: Bucket[] = [
        ...clients.map((c) => ({ key: c._id, label: c.name, header: { kind: "client", client: c } as const, archived: c.archived })),
        { key: NONE_KEY, label: "No client", header: { kind: "client", client: null }, archived: false },
      ]
      return collect(rows, buckets, (r) => [r.client?._id ?? NONE_KEY], showEmpty)
    }

    case "workCategory": {
      const buckets: Bucket[] = [
        ...refs.workCategories.map((c) => ({ key: c._id, label: c.name, header: { kind: "workCategory", category: c } as const, archived: c.archived })),
        { key: NONE_KEY, label: "No category", header: { kind: "workCategory", category: null }, archived: false },
      ]
      return collect(rows, buckets, (r) => [r.task.workCategoryId ?? NONE_KEY], showEmpty)
    }

    case "label": {
      const labels = [...refs.labels].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      const buckets: Bucket[] = [
        ...labels.map((l) => ({ key: l._id, label: l.name, header: { kind: "label", label: l } as const, archived: l.archived })),
        { key: NONE_KEY, label: "No label", header: { kind: "label", label: null }, archived: false },
      ]
      return collect(rows, buckets, (r) => (r.task.labelIds.length > 0 ? r.task.labelIds : [NONE_KEY]), showEmpty)
    }
  }
}

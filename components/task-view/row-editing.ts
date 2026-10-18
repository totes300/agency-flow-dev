import type { Id } from "@/convex/_generated/dataModel"
import { TASK_CATEGORIES, type TaskPriority, type TaskViewSpec } from "@/convex/tasks/model"
import { scopeCategories, type StatusRef, type TaskGroup } from "@/components/task-view/row-model"

/**
 * Row editing rules for the list (docs/prd-tasks-refactor.md §11.7, slice 4b):
 * when drag reorder is offered, which sort keys a drop lands between, and
 * what an inline "add task" row prefills. Pure, so the rules are unit-tested.
 */

// ─── Drag reorder ────────────────────────────────────────────────────────────

/**
 * Drag reorder is offered in the list when the view is in manual order
 * (`orderBy: "manual"`), with any grouping. A row only moves inside its own
 * group, so a drop never changes the grouped property: every group's rows are
 * a subsequence of the one global `sortKey` order, and a key between two
 * neighbours of the group is also a valid position in the global order.
 *
 * Filter chips and search stay allowed for the same reason: the visible rows
 * are an ordered subsequence of the global order, so placing a task between
 * two visible neighbours keeps every hidden row's relative order. The board
 * and every sorted order (priority, due date, …) have no manual position.
 */
export function canReorderList(spec: Pick<TaskViewSpec, "layout" | "orderBy">): boolean {
  return spec.layout === "list" && spec.orderBy === "manual"
}

export type ReorderNeighbours = { beforeKey?: string; afterKey?: string }

/**
 * Sort keys to place a row between after moving it from `from` to `to` in a
 * group whose rows have `keys` (in display order, the row at `from`
 * included). `undefined` neighbour = start / end of the order. Returns null
 * when nothing moves or no key fits: a neighbour above without a key (rows
 * without a key sort last), or neighbours whose keys are not strictly
 * increasing (duplicates) — `generateKeyBetween` would reject them.
 */
export function reorderNeighbours(
  keys: readonly (string | null)[],
  from: number,
  to: number,
): ReorderNeighbours | null {
  if (from === to || from < 0 || from >= keys.length || to < 0 || to >= keys.length) return null
  const rest = keys.filter((_, i) => i !== from)
  const before = to > 0 ? rest[to - 1] : undefined
  const after = to < rest.length ? rest[to] : undefined
  if (before === null) return null
  // A keyless row below: every row from there on is keyless, so "after `before`" is the position.
  const afterKey = after ?? undefined
  if (before !== undefined && afterKey !== undefined && !(before < afterKey)) return null
  return {
    ...(before !== undefined ? { beforeKey: before } : {}),
    ...(afterKey !== undefined ? { afterKey } : {}),
  }
}

// ─── Inline add ──────────────────────────────────────────────────────────────

/** What a row created from a group's inline "add task" row starts with (`tasks.create` args). */
export type InlineAddPrefill = {
  statusId?: Id<"statuses">
  priority?: TaskPriority
  projectId?: Id<"projects">
  assigneeIds?: Id<"users">[]
  workCategoryId?: Id<"workCategories">
  labelIds?: Id<"labels">[]
}

/**
 * The default status of the first category in the view's scope (Active →
 * unstarted "Next up", Backlog → "Inbox"), so a task created in a view lands
 * in it. Unscoped views use the server default (backlog).
 */
export function scopeDefaultStatusId(
  spec: Pick<TaskViewSpec, "filters">,
  statuses: readonly StatusRef[],
): Id<"statuses"> | undefined {
  const scope = scopeCategories(spec)
  if (scope === null) return undefined
  for (const category of TASK_CATEGORIES) {
    if (!scope.includes(category)) continue
    const active = statuses.filter((s) => s.category === category && !s.archived)
    const status = active.find((s) => s.isDefault) ?? active[0]
    if (status) return status._id
  }
  return undefined
}

/**
 * The create args for an inline "add task" row at the end of `group`, or
 * null when the row is not offered: the new task must land in the group it
 * was typed into. Prefills the group's value like the group "+" (status,
 * project, assignee) and the other groupings `tasks.create` can set
 * (priority, label; work category for admins — D5). A client group has no
 * single project to prefill, so it gets no add row. "No …" groups create the
 * task without the value (and with no assignee, so a project default does
 * not kick in). Members are auto-assigned by the server.
 */
export function inlineAddPrefill(
  group: TaskGroup,
  opts: { defaultStatusId: Id<"statuses"> | undefined; isAdmin: boolean },
): InlineAddPrefill | null {
  const status = opts.defaultStatusId ? { statusId: opts.defaultStatusId } : {}
  const h = group.header
  switch (h.kind) {
    case "none":
      return status
    case "status":
      return { statusId: h.status._id }
    case "priority":
      return { ...status, priority: h.priority }
    case "assignee":
      if (h.member) return { ...status, assigneeIds: [h.member._id] }
      return opts.isAdmin ? { ...status, assigneeIds: [] } : null
    case "project":
      return h.project ? { ...status, projectId: h.project._id } : status
    case "client":
      return h.client ? null : status
    case "workCategory":
      if (!h.category) return status
      return opts.isAdmin ? { ...status, workCategoryId: h.category._id } : null
    case "label":
      return h.label ? { ...status, labelIds: [h.label._id] } : status
  }
}

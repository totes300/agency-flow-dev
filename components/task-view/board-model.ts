import type { Id } from "@/convex/_generated/dataModel"
import { NONE_FILTER_VALUE, type TaskPriority } from "@/convex/tasks/model"
import type { GroupBy } from "@/components/task-view/view-state"
import type { TaskRowDTO } from "@/components/task-view/row-model"

/**
 * Board drag rules (§9 row 4). Dropping a card on another column changes the
 * grouping property through the slice-1 mutations. Pure.
 *
 * Member field policy (D5, §5.3): members cannot change project or work
 * category, so those boards are read-only for them; the client column is
 * derived from the project and never draggable. The server enforces the same
 * policy — this only avoids offering a drag that would be refused.
 */

export type BoardMove =
  | { kind: "status"; statusId: Id<"statuses"> }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "assignees"; assigneeIds: Id<"users">[] }
  | { kind: "labels"; labelIds: Id<"labels">[] }
  | { kind: "project"; projectId: Id<"projects"> | null }
  | { kind: "workCategory"; workCategoryId: Id<"workCategories"> | null }

export function canDragOnBoard(groupBy: Exclude<GroupBy, "none">, isAdmin: boolean): boolean {
  if (groupBy === "client") return false
  if (groupBy === "project" || groupBy === "workCategory") return isAdmin
  return true
}

const orNull = <T extends string>(key: string): T | null => (key === NONE_FILTER_VALUE ? null : (key as T))

/** Replaces `from` with `to` in a multi-value list; the "none" column clears it. */
function swap<T extends string>(current: readonly T[], from: string, to: string): T[] {
  if (to === NONE_FILTER_VALUE) return []
  const kept = current.filter((id) => id !== from && id !== to)
  return [...kept, to as T]
}

/**
 * The change a drop from column `fromKey` to `toKey` means, or null when
 * nothing changes. Multi-value properties (assignees, labels) swap the
 * source column's value for the target's and keep the others.
 */
export function boardMoveFor(
  groupBy: Exclude<GroupBy, "none">,
  task: TaskRowDTO,
  fromKey: string,
  toKey: string,
): BoardMove | null {
  if (fromKey === toKey) return null
  switch (groupBy) {
    case "status":
      return task.statusId === toKey ? null : { kind: "status", statusId: toKey as Id<"statuses"> }
    case "priority": {
      const priority = Number(toKey) as TaskPriority
      return task.priority === priority ? null : { kind: "priority", priority }
    }
    case "assignee":
      return { kind: "assignees", assigneeIds: swap(task.assigneeIds, fromKey, toKey) }
    case "label":
      return { kind: "labels", labelIds: swap(task.labelIds, fromKey, toKey) }
    case "project":
      return { kind: "project", projectId: orNull<Id<"projects">>(toKey) }
    case "workCategory":
      return { kind: "workCategory", workCategoryId: orNull<Id<"workCategories">>(toKey) }
    case "client":
      return null
  }
}

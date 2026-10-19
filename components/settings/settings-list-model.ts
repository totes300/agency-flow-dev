import type { StatusColorName } from "@/convex/lib/constants"
import { CATEGORY_LABELS, TASK_CATEGORIES, type TaskCategory } from "@/convex/tasks/model"

/**
 * Pure helpers for the status and label settings lists
 * (docs/prd-tasks-refactor.md §4.1, §4.2): grouping by category, turning a
 * drag (from index → to index) into the server's `move({ id, afterId })`
 * shape, and the matching local reorder used by the optimistic update.
 */

export type CategoryGroup<T> = {
  category: TaskCategory
  label: string
  rows: T[]
}

/** One group per category in workflow order (empty ones included), rows kept in input order. */
export function groupByCategory<T extends { category: TaskCategory }>(rows: readonly T[]): CategoryGroup<T>[] {
  return TASK_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rows: rows.filter((row) => row.category === category),
  }))
}

/**
 * The `afterId` for moving the item at `from` to index `to` in `ids`:
 * the id that ends up right before it, or null when it becomes first.
 * Returns undefined when nothing moves (or an index is out of range).
 */
export function afterIdForMove<Id extends string>(ids: readonly Id[], from: number, to: number): Id | null | undefined {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return undefined
  const rest = ids.filter((_, i) => i !== from)
  return to === 0 ? null : rest[to - 1]
}

/**
 * Local mirror of the server's `move`: `id` placed right after `afterId`,
 * or — when `afterId` is null — before the first other row `inScope`
 * accepts (its category's first row). Returns the input unchanged when the
 * target can't be found.
 */
export function reorderAfter<T extends { _id: string }>(
  rows: readonly T[],
  id: string,
  afterId: string | null,
  inScope: (row: T) => boolean = () => true,
): T[] {
  const moved = rows.find((row) => row._id === id)
  if (!moved) return [...rows]
  const rest = rows.filter((row) => row._id !== id)
  let at: number
  if (afterId === null) {
    at = rest.findIndex(inScope)
    if (at === -1) return [...rows]
  } else {
    const index = rest.findIndex((row) => row._id === afterId)
    if (index === -1) return [...rows]
    at = index + 1
  }
  rest.splice(at, 0, moved)
  return rest
}

/** "N tasks" usage text; a capped count reads "99+ tasks". */
export function formatTaskUsage(usage: number, capped: boolean): string {
  if (capped) return `${usage}+ tasks`
  return usage === 1 ? "1 task" : `${usage} tasks`
}

/** The colour a new status starts with in each category. */
export const NEW_STATUS_COLOR: Record<TaskCategory, StatusColorName> = {
  backlog: "gray",
  unstarted: "blue",
  started: "amber",
  completed: "green",
  canceled: "gray",
}

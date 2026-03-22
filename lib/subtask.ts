/**
 * Pure utility functions for subtask logic.
 * Extracted for testability — used by subtask components and Convex mutations.
 */

import type { Id } from "@/convex/_generated/dataModel"

// ─── Inheritance defaults ───────────────────────────────────────────────────────

export type ParentTaskFields = {
  projectId?: Id<"projects">
  billable: boolean
  workCategoryId?: Id<"workCategories">
  assigneeIds: Id<"users">[]
}

export type SubtaskDefaults = {
  projectId?: Id<"projects">
  billable: boolean
  workCategoryId?: Id<"workCategories">
  assigneeIds: Id<"users">[]
}

/**
 * Compute default field values for a new subtask based on parent task.
 * Per spec: projectId must match parent (mandatory), billable/category/assignee default to parent's.
 */
export function computeSubtaskDefaults(parent: ParentTaskFields): SubtaskDefaults {
  return {
    projectId: parent.projectId,
    billable: parent.billable,
    workCategoryId: parent.workCategoryId,
    assigneeIds: [...parent.assigneeIds],
  }
}

// ─── Sort order ─────────────────────────────────────────────────────────────────

/**
 * Compute new sortOrder values after a drag reorder.
 * Given an ordered list of IDs (new order), returns a map of id → sortOrder.
 * Uses simple integer indices (0, 1, 2, ...) for clean ordering.
 */
export function computeReorderMap(
  orderedIds: string[]
): Record<string, number> {
  const map: Record<string, number> = {}
  for (let i = 0; i < orderedIds.length; i++) {
    map[orderedIds[i]] = i
  }
  return map
}

/**
 * Compute the sortOrder for a newly appended subtask.
 * Returns max(existing sortOrders) + 1, or 0 if no existing subtasks.
 */
export function computeNextSortOrder(
  existingSortOrders: number[]
): number {
  if (existingSortOrders.length === 0) return 0
  return Math.max(...existingSortOrders) + 1
}

// ─── TipTap utilities — re-exported from shared module ─────────────────────────

export { extractPlainText, isTiptapEmpty } from "@/lib/tiptap-utils"

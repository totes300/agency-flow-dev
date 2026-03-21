/**
 * Pure utility functions for task detail modal.
 * Extracted for testability — used by task-detail-modal.tsx and related components.
 */

import type { Id } from "@/convex/_generated/dataModel"

// ─── URL helpers ────────────────────────────────────────────────────────────────

/**
 * Build a URL search string with the detail param set.
 * Preserves existing params (tab, filters, etc).
 */
export function buildDetailUrl(
  currentParams: URLSearchParams,
  taskId: Id<"tasks"> | null
): string {
  const params = new URLSearchParams(currentParams.toString())
  if (taskId) {
    params.set("detail", taskId)
  } else {
    params.delete("detail")
  }
  const str = params.toString()
  return str ? `?${str}` : ""
}

/**
 * Extract the task ID from the detail query param.
 * Returns null if not present or empty.
 */
export function parseDetailParam(
  searchParams: URLSearchParams
): string | null {
  const value = searchParams.get("detail")
  if (!value || !value.trim()) return null
  return value.trim()
}

// ─── Keyboard navigation ────────────────────────────────────────────────────────

/**
 * Given the current task ID and an ordered list of task IDs,
 * return the next or previous task ID for J/K navigation.
 *
 * Returns null if:
 * - taskIds is empty
 * - currentId is not in the list and direction doesn't matter
 * - at the boundary (first task + "prev", last task + "next")
 */
export function getAdjacentTaskId(
  currentId: string,
  taskIds: string[],
  direction: "next" | "prev"
): string | null {
  if (taskIds.length === 0) return null

  const currentIndex = taskIds.indexOf(currentId)

  // If current task not found in list, go to first or last depending on direction
  if (currentIndex === -1) {
    return direction === "next" ? taskIds[0] : taskIds[taskIds.length - 1]
  }

  if (direction === "next") {
    return currentIndex < taskIds.length - 1
      ? taskIds[currentIndex + 1]
      : null // already at last
  } else {
    return currentIndex > 0
      ? taskIds[currentIndex - 1]
      : null // already at first
  }
}

// ─── Activity feed merge ────────────────────────────────────────────────────────

export type ActivityEvent = {
  id: string
  kind: "audit"
  type: string
  userId: string
  userName?: string
  metadata: Record<string, unknown>
  createdAt: number
}

export type CommentEvent = {
  id: string
  kind: "comment"
  userId: string
  userName?: string
  userImageUrl?: string
  content: unknown // Tiptap JSON
  parentCommentId?: string
  parentUserName?: string
  parentPreview?: string
  createdAt: number
}

export type FeedItem = ActivityEvent | CommentEvent

/**
 * Merge activity log events and comments into a single chronological feed.
 * Sorted by createdAt ascending (oldest first).
 */
export function mergeActivityFeed(
  activities: Omit<ActivityEvent, "kind">[],
  comments: Omit<CommentEvent, "kind">[]
): FeedItem[] {
  const tagged: FeedItem[] = [
    ...activities.map((a) => ({ ...a, kind: "audit" as const })),
    ...comments.map((c) => ({ ...c, kind: "comment" as const })),
  ]
  return tagged.sort((a, b) => a.createdAt - b.createdAt)
}

// ─── Subtask validation ─────────────────────────────────────────────────────────

/**
 * Validate whether a task can have subtasks created under it.
 * Returns an error message or null if valid.
 */
export function validateSubtaskCreation(
  parentTaskId: string | null | undefined,
  parentParentTaskId: string | null | undefined
): string | null {
  if (!parentTaskId) return "Parent task ID is required"
  if (parentParentTaskId) return "Subtasks cannot have subtasks (max 1 level)"
  return null
}

/**
 * Compute subtask progress from a list of subtasks.
 * Returns { done, total, percent }.
 */
export function computeSubtaskProgress(
  subtasks: { statusType: string }[]
): { done: number; total: number; percent: number } {
  const total = subtasks.length
  if (total === 0) return { done: 0, total: 0, percent: 0 }
  const done = subtasks.filter((s) => s.statusType === "done").length
  return { done, total, percent: Math.round((done / total) * 100) }
}

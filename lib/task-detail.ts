/**
 * Pure helpers for task detail (drawer + full page): URL params, J/K
 * stepping, feed merge, sub-task progress. Extracted for testability.
 */

import type { Id } from "@/convex/_generated/dataModel"

// ─── URL helpers ────────────────────────────────────────────────────────────────

/** Search param carrying a comment deep-link alongside the open task. */
export const COMMENT_PARAM = "comment"

/** The drawer param (docs/prd-tasks-refactor.md §6.1): `?task=<identifier>` on any route. */
export const TASK_PARAM = "task"

/** Legacy drawer param (`?detail=<taskId>`). Still accepted; the drawer canonicalises it to `?task=`. */
export const LEGACY_DETAIL_PARAM = "detail"

/** Which task the URL opens: by identifier (`?task=`) or, from old links, by id (`?detail=`). */
export type TaskRef = { kind: "identifier"; identifier: string } | { kind: "id"; id: string }

/** The task the URL opens in the drawer, or null. `?task=` wins over `?detail=`. */
export function parseTaskRef(searchParams: URLSearchParams): TaskRef | null {
  const identifier = searchParams.get(TASK_PARAM)?.trim()
  if (identifier) return { kind: "identifier", identifier }
  const id = parseDetailParam(searchParams)
  return id ? { kind: "id", id } : null
}

/** True when the URL opens a task in the drawer (either param). */
export function isTaskDetailOpen(searchParams: URLSearchParams): boolean {
  return parseTaskRef(searchParams) !== null
}

/**
 * The search string that opens `target` in the drawer (or closes it for
 * null). Writes `?task=<identifier>`; a task without an identifier falls back
 * to `?detail=<id>`. Preserves the other params; the comment deep-link is
 * dropped unless `keepComment` (it only belongs to the navigation that set it).
 */
export function buildTaskUrl(
  currentParams: URLSearchParams,
  target: { id: string; identifier: string | null } | null,
  { keepComment = false }: { keepComment?: boolean } = {},
): string {
  const params = new URLSearchParams(currentParams.toString())
  if (!keepComment) params.delete(COMMENT_PARAM)
  params.delete(TASK_PARAM)
  params.delete(LEGACY_DETAIL_PARAM)
  // One drawer source at a time: opening a task (or closing the drawer) closes a proposal.
  params.delete(DRAFT_PARAM)
  params.delete(CHANGE_PARAM)
  if (target) {
    if (target.identifier) params.set(TASK_PARAM, target.identifier)
    else params.set(LEGACY_DETAIL_PARAM, target.id)
  }
  const str = params.toString()
  return str ? `?${str}` : ""
}

// ─── Proposal sources (email-triage B7, D15) ────────────────────────────────────

/** Opens a pending `createTask` proposal as a Draft in the drawer: `?draft=<proposalId>`. */
export const DRAFT_PARAM = "draft"

/** Opens a pending `updateTask` proposal on its task: `?change=<proposalId>`. */
export const CHANGE_PARAM = "change"

/** A proposal the drawer shows instead of a task. */
export type ProposalRef = { kind: "draft" | "change"; proposalId: string }

/** The proposal the URL opens in the drawer, or null. A task param wins (one source at a time). */
export function parseProposalRef(searchParams: URLSearchParams): ProposalRef | null {
  if (parseTaskRef(searchParams)) return null
  const draft = searchParams.get(DRAFT_PARAM)?.trim()
  if (draft) return { kind: "draft", proposalId: draft }
  const change = searchParams.get(CHANGE_PARAM)?.trim()
  if (change) return { kind: "change", proposalId: change }
  return null
}

/**
 * The search string that opens `target` (a proposal) in the drawer, or
 * closes it for null. Drops any open task (and its comment deep-link);
 * keeps every other param.
 */
export function buildProposalUrl(currentParams: URLSearchParams, target: ProposalRef | null): string {
  const params = new URLSearchParams(currentParams.toString())
  params.delete(DRAFT_PARAM)
  params.delete(CHANGE_PARAM)
  if (target) {
    params.delete(TASK_PARAM)
    params.delete(LEGACY_DETAIL_PARAM)
    params.delete(COMMENT_PARAM)
    params.set(target.kind === "draft" ? DRAFT_PARAM : CHANGE_PARAM, target.proposalId)
  }
  const str = params.toString()
  return str ? `?${str}` : ""
}

/**
 * Legacy builder: opens a task by id (`?detail=<id>`), for callers that only
 * know the id. The drawer resolves it and rewrites the URL to `?task=`.
 */
export function buildDetailUrl(
  currentParams: URLSearchParams,
  taskId: Id<"tasks"> | null
): string {
  return buildTaskUrl(currentParams, taskId ? { id: taskId, identifier: null } : null)
}

/** The full-page route of a task (`/tasks/ARLO-21`, §6.1). */
export function taskPagePath(identifier: string, commentId?: string | null): string {
  const path = `/tasks/${encodeURIComponent(identifier)}`
  return commentId ? `${path}?${COMMENT_PARAM}=${encodeURIComponent(commentId)}` : path
}

/**
 * Absolute deep link to a task's detail on /tasks, optionally anchored to a
 * comment (inbox row click). By id; the drawer canonicalises it.
 */
export function buildTaskDeepLink(
  taskId: string,
  commentId?: string | null
): string {
  const params = new URLSearchParams()
  params.set(LEGACY_DETAIL_PARAM, taskId)
  if (commentId) params.set(COMMENT_PARAM, commentId)
  return `/tasks?${params.toString()}`
}

/** Extract the comment deep-link id, or null. */
export function parseCommentParam(searchParams: URLSearchParams): string | null {
  const value = searchParams.get(COMMENT_PARAM)
  if (!value || !value.trim()) return null
  return value.trim()
}

/**
 * Extract the task ID from the legacy `?detail=` param.
 * Returns null if not present or empty.
 */
export function parseDetailParam(
  searchParams: URLSearchParams
): string | null {
  const value = searchParams.get(LEGACY_DETAIL_PARAM)
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
  resolvedAt?: number
  resolvedBy?: string
  resolvedByName?: string
  createdAt: number
  updatedAt?: number
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

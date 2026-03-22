/**
 * Pure business logic for comment read receipts.
 * Extracted for testability — mirrors the server-side logic in convex/comments.ts.
 */

export type Comment = {
  id: string
  userId: string
  createdAt: number
}

/**
 * Compute the unread comment count for a user on a task.
 *
 * Business rules:
 * 1. Only comments by OTHER users count as unread (never your own)
 * 2. Only comments created AFTER the user's lastSeenAt timestamp count
 * 3. If the user has never seen the task, ALL other-user comments are unread
 * 4. If lastSeenAt is 0 or null, treat as "never seen"
 * 5. The total count includes ALL comments (including your own)
 */
export function computeUnreadCount(
  comments: Comment[],
  currentUserId: string,
  lastSeenAt: number | null,
): { total: number; unread: number } {
  const total = comments.length
  const seenTimestamp = lastSeenAt ?? 0

  const unread = comments.filter(
    (c) => c.userId !== currentUserId && c.createdAt > seenTimestamp,
  ).length

  return { total, unread }
}

/**
 * Determine if a comment should be highlighted as "new" in the feed.
 * A comment is new if:
 * 1. It was written by someone other than the current user
 * 2. It was created after the user's lastSeenAt timestamp
 */
export function isCommentUnread(
  comment: Comment,
  currentUserId: string,
  lastSeenAt: number | null,
): boolean {
  if (comment.userId === currentUserId) return false
  return comment.createdAt > (lastSeenAt ?? 0)
}

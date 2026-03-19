import { describe, expect, it } from "vitest"
import { computeUnreadCount, isCommentUnread, type Comment } from "./comments"

// ─── Test data ──────────────────────────────────────────────────────────────────

const USER_ME = "user_me"
const USER_ADAM = "user_adam"
const USER_EMMA = "user_emma"

const T = {
  t1: 1000,
  t2: 2000,
  t3: 3000,
  t4: 4000,
  t5: 5000,
}

function comment(id: string, userId: string, createdAt: number): Comment {
  return { id, userId, createdAt }
}

// ─── computeUnreadCount ─────────────────────────────────────────────────────────

describe("computeUnreadCount", () => {
  // ─── Basic counting ───────────────────────────────────────────────────────

  it("returns 0/0 for empty comments", () => {
    expect(computeUnreadCount([], USER_ME, null)).toEqual({ total: 0, unread: 0 })
  })

  it("counts all comments in total, including own", () => {
    const comments = [
      comment("c1", USER_ME, T.t1),
      comment("c2", USER_ADAM, T.t2),
      comment("c3", USER_EMMA, T.t3),
    ]
    const result = computeUnreadCount(comments, USER_ME, null)
    expect(result.total).toBe(3)
  })

  // ─── Own comments are never unread ────────────────────────────────────────

  it("never counts own comments as unread", () => {
    const comments = [
      comment("c1", USER_ME, T.t1),
      comment("c2", USER_ME, T.t2),
      comment("c3", USER_ME, T.t3),
    ]
    expect(computeUnreadCount(comments, USER_ME, null)).toEqual({ total: 3, unread: 0 })
  })

  it("never counts own comments as unread even with lastSeenAt=0", () => {
    const comments = [comment("c1", USER_ME, T.t3)]
    expect(computeUnreadCount(comments, USER_ME, 0)).toEqual({ total: 1, unread: 0 })
  })

  // ─── Never seen (lastSeenAt = null) ───────────────────────────────────────

  it("all other-user comments are unread when never seen (null)", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t1),
      comment("c2", USER_EMMA, T.t2),
      comment("c3", USER_ME, T.t3),
    ]
    expect(computeUnreadCount(comments, USER_ME, null)).toEqual({ total: 3, unread: 2 })
  })

  it("all other-user comments are unread when never seen (0)", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t1),
      comment("c2", USER_EMMA, T.t2),
    ]
    expect(computeUnreadCount(comments, USER_ME, 0)).toEqual({ total: 2, unread: 2 })
  })

  // ─── Partial read ─────────────────────────────────────────────────────────

  it("only counts comments after lastSeenAt as unread", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t1), // before lastSeenAt → read
      comment("c2", USER_EMMA, T.t2), // before lastSeenAt → read
      comment("c3", USER_ADAM, T.t3), // after lastSeenAt → unread
      comment("c4", USER_EMMA, T.t4), // after lastSeenAt → unread
    ]
    expect(computeUnreadCount(comments, USER_ME, T.t2)).toEqual({ total: 4, unread: 2 })
  })

  it("comment at exact lastSeenAt timestamp is NOT unread (already seen)", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t2),
    ]
    expect(computeUnreadCount(comments, USER_ME, T.t2)).toEqual({ total: 1, unread: 0 })
  })

  it("comment 1ms after lastSeenAt IS unread", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t2 + 1),
    ]
    expect(computeUnreadCount(comments, USER_ME, T.t2)).toEqual({ total: 1, unread: 1 })
  })

  // ─── Fully caught up ─────────────────────────────────────────────────────

  it("returns 0 unread when all comments are before lastSeenAt", () => {
    const comments = [
      comment("c1", USER_ADAM, T.t1),
      comment("c2", USER_EMMA, T.t2),
    ]
    expect(computeUnreadCount(comments, USER_ME, T.t5)).toEqual({ total: 2, unread: 0 })
  })

  // ─── Mixed scenario (real-world) ──────────────────────────────────────────

  it("handles real-world mixed scenario correctly", () => {
    // User opened task at t3, saw 2 comments. Then Adam and Emma each posted.
    const comments = [
      comment("c1", USER_ADAM, T.t1),  // read (before lastSeenAt)
      comment("c2", USER_ME, T.t2),    // own → never unread
      comment("c3", USER_ADAM, T.t4),  // unread (after lastSeenAt, other user)
      comment("c4", USER_ME, T.t4),    // own → never unread
      comment("c5", USER_EMMA, T.t5),  // unread (after lastSeenAt, other user)
    ]
    expect(computeUnreadCount(comments, USER_ME, T.t3)).toEqual({ total: 5, unread: 2 })
  })
})

// ─── isCommentUnread ────────────────────────────────────────────────────────────

describe("isCommentUnread", () => {
  it("own comment is never unread", () => {
    expect(isCommentUnread(comment("c1", USER_ME, T.t5), USER_ME, null)).toBe(false)
  })

  it("own comment is never unread even if after lastSeenAt", () => {
    expect(isCommentUnread(comment("c1", USER_ME, T.t5), USER_ME, T.t1)).toBe(false)
  })

  it("other-user comment before lastSeenAt is read", () => {
    expect(isCommentUnread(comment("c1", USER_ADAM, T.t1), USER_ME, T.t3)).toBe(false)
  })

  it("other-user comment after lastSeenAt is unread", () => {
    expect(isCommentUnread(comment("c1", USER_ADAM, T.t5), USER_ME, T.t3)).toBe(true)
  })

  it("other-user comment at exact lastSeenAt is NOT unread", () => {
    expect(isCommentUnread(comment("c1", USER_ADAM, T.t3), USER_ME, T.t3)).toBe(false)
  })

  it("other-user comment with null lastSeenAt is unread", () => {
    expect(isCommentUnread(comment("c1", USER_ADAM, T.t1), USER_ME, null)).toBe(true)
  })

  it("other-user comment with 0 lastSeenAt is unread", () => {
    expect(isCommentUnread(comment("c1", USER_ADAM, T.t1), USER_ME, 0)).toBe(true)
  })
})

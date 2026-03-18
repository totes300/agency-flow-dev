import { describe, expect, it } from "vitest"
import {
  buildDetailUrl,
  parseDetailParam,
  getAdjacentTaskId,
  mergeActivityFeed,
  validateSubtaskCreation,
  computeSubtaskProgress,
} from "./task-detail"

// ─── buildDetailUrl ─────────────────────────────────────────────────────────────

describe("buildDetailUrl", () => {
  it("adds detail param to empty search", () => {
    const params = new URLSearchParams("")
    expect(buildDetailUrl(params, "abc123" as any)).toBe("?detail=abc123")
  })

  it("preserves existing params", () => {
    const params = new URLSearchParams("tab=backlog&search=hello")
    const result = buildDetailUrl(params, "xyz" as any)
    expect(result).toContain("tab=backlog")
    expect(result).toContain("search=hello")
    expect(result).toContain("detail=xyz")
  })

  it("removes detail param when taskId is null", () => {
    const params = new URLSearchParams("detail=old&tab=backlog")
    const result = buildDetailUrl(params, null)
    expect(result).not.toContain("detail")
    expect(result).toContain("tab=backlog")
  })

  it("replaces existing detail param", () => {
    const params = new URLSearchParams("detail=old")
    const result = buildDetailUrl(params, "new" as any)
    expect(result).toBe("?detail=new")
    expect(result).not.toContain("old")
  })

  it("returns empty string when removing last param", () => {
    const params = new URLSearchParams("detail=old")
    expect(buildDetailUrl(params, null)).toBe("")
  })

  it("does not mutate the original params", () => {
    const params = new URLSearchParams("tab=all")
    buildDetailUrl(params, "task1" as any)
    expect(params.get("detail")).toBeNull()
  })
})

// ─── parseDetailParam ───────────────────────────────────────────────────────────

describe("parseDetailParam", () => {
  it("extracts detail param", () => {
    const params = new URLSearchParams("detail=task_abc")
    expect(parseDetailParam(params)).toBe("task_abc")
  })

  it("returns null when param missing", () => {
    const params = new URLSearchParams("tab=backlog")
    expect(parseDetailParam(params)).toBeNull()
  })

  it("returns null for empty value", () => {
    const params = new URLSearchParams("detail=")
    expect(parseDetailParam(params)).toBeNull()
  })

  it("returns null for whitespace-only value", () => {
    const params = new URLSearchParams("detail=   ")
    expect(parseDetailParam(params)).toBeNull()
  })

  it("trims whitespace", () => {
    const params = new URLSearchParams("detail= task_abc ")
    expect(parseDetailParam(params)).toBe("task_abc")
  })
})

// ─── getAdjacentTaskId ──────────────────────────────────────────────────────────

describe("getAdjacentTaskId", () => {
  const ids = ["task_a", "task_b", "task_c", "task_d"]

  // ─── Next direction ───────────────────────────────────────────────────────
  it("returns next task", () => {
    expect(getAdjacentTaskId("task_b", ids, "next")).toBe("task_c")
  })

  it("returns null at last task (next)", () => {
    expect(getAdjacentTaskId("task_d", ids, "next")).toBeNull()
  })

  it("returns first task for next from first", () => {
    expect(getAdjacentTaskId("task_a", ids, "next")).toBe("task_b")
  })

  // ─── Prev direction ───────────────────────────────────────────────────────
  it("returns previous task", () => {
    expect(getAdjacentTaskId("task_c", ids, "prev")).toBe("task_b")
  })

  it("returns null at first task (prev)", () => {
    expect(getAdjacentTaskId("task_a", ids, "prev")).toBeNull()
  })

  it("returns last task for prev from last", () => {
    expect(getAdjacentTaskId("task_d", ids, "prev")).toBe("task_c")
  })

  // ─── Edge cases ───────────────────────────────────────────────────────────
  it("returns null for empty list", () => {
    expect(getAdjacentTaskId("task_a", [], "next")).toBeNull()
  })

  it("returns first when current not in list (next)", () => {
    expect(getAdjacentTaskId("task_unknown", ids, "next")).toBe("task_a")
  })

  it("returns last when current not in list (prev)", () => {
    expect(getAdjacentTaskId("task_unknown", ids, "prev")).toBe("task_d")
  })

  it("returns null for single-item list at boundary (next)", () => {
    expect(getAdjacentTaskId("task_a", ["task_a"], "next")).toBeNull()
  })

  it("returns null for single-item list at boundary (prev)", () => {
    expect(getAdjacentTaskId("task_a", ["task_a"], "prev")).toBeNull()
  })
})

// ─── mergeActivityFeed ──────────────────────────────────────────────────────────

describe("mergeActivityFeed", () => {
  it("merges and sorts by createdAt ascending", () => {
    const activities = [
      { id: "a1", type: "status_changed", userId: "u1", metadata: {}, createdAt: 1000 },
      { id: "a2", type: "assignee_added", userId: "u1", metadata: {}, createdAt: 3000 },
    ]
    const comments = [
      { id: "c1", userId: "u2", content: {}, createdAt: 2000 },
    ]

    const feed = mergeActivityFeed(activities, comments)

    expect(feed).toHaveLength(3)
    expect(feed[0].id).toBe("a1")
    expect(feed[0].kind).toBe("audit")
    expect(feed[1].id).toBe("c1")
    expect(feed[1].kind).toBe("comment")
    expect(feed[2].id).toBe("a2")
    expect(feed[2].kind).toBe("audit")
  })

  it("returns empty array for empty inputs", () => {
    expect(mergeActivityFeed([], [])).toEqual([])
  })

  it("handles activities only", () => {
    const activities = [
      { id: "a1", type: "task_created", userId: "u1", metadata: {}, createdAt: 100 },
    ]
    const feed = mergeActivityFeed(activities, [])
    expect(feed).toHaveLength(1)
    expect(feed[0].kind).toBe("audit")
  })

  it("handles comments only", () => {
    const comments = [
      { id: "c1", userId: "u1", content: { type: "doc" }, createdAt: 100 },
    ]
    const feed = mergeActivityFeed([], comments)
    expect(feed).toHaveLength(1)
    expect(feed[0].kind).toBe("comment")
  })

  it("preserves all fields on audit events", () => {
    const activities = [{
      id: "a1",
      type: "status_changed",
      userId: "u1",
      userName: "Adam",
      metadata: { from: "Backlog", to: "In Progress" },
      createdAt: 500,
    }]
    const feed = mergeActivityFeed(activities, [])
    const item = feed[0]
    expect(item.kind).toBe("audit")
    if (item.kind === "audit") {
      expect(item.type).toBe("status_changed")
      expect(item.userName).toBe("Adam")
      expect(item.metadata).toEqual({ from: "Backlog", to: "In Progress" })
    }
  })

  it("preserves all fields on comment events", () => {
    const comments = [{
      id: "c1",
      userId: "u2",
      userName: "Emma",
      userAvatarColor: "#EC4899",
      content: { type: "doc", content: [] },
      createdAt: 600,
    }]
    const feed = mergeActivityFeed([], comments)
    const item = feed[0]
    expect(item.kind).toBe("comment")
    if (item.kind === "comment") {
      expect(item.userName).toBe("Emma")
      expect(item.userAvatarColor).toBe("#EC4899")
      expect(item.content).toEqual({ type: "doc", content: [] })
    }
  })

  it("handles same-timestamp items (stable order)", () => {
    const activities = [
      { id: "a1", type: "status_changed", userId: "u1", metadata: {}, createdAt: 1000 },
    ]
    const comments = [
      { id: "c1", userId: "u1", content: {}, createdAt: 1000 },
    ]
    const feed = mergeActivityFeed(activities, comments)
    expect(feed).toHaveLength(2)
    // Both present, order is stable (activities first since they're first in concat)
    expect(feed[0].id).toBe("a1")
    expect(feed[1].id).toBe("c1")
  })
})

// ─── validateSubtaskCreation ────────────────────────────────────────────────────

describe("validateSubtaskCreation", () => {
  it("returns null for valid parent task", () => {
    expect(validateSubtaskCreation("task_abc", null)).toBeNull()
  })

  it("returns null for valid parent task (undefined parentParent)", () => {
    expect(validateSubtaskCreation("task_abc", undefined)).toBeNull()
  })

  it("rejects missing parent task ID", () => {
    expect(validateSubtaskCreation(null, null)).toBe("Parent task ID is required")
  })

  it("rejects empty parent task ID", () => {
    expect(validateSubtaskCreation(undefined, null)).toBe("Parent task ID is required")
  })

  it("rejects nested subtask (max 1 level)", () => {
    expect(validateSubtaskCreation("task_child", "task_parent")).toBe(
      "Subtasks cannot have subtasks (max 1 level)"
    )
  })
})

// ─── computeSubtaskProgress ─────────────────────────────────────────────────────

describe("computeSubtaskProgress", () => {
  it("computes 0/0 for empty array", () => {
    expect(computeSubtaskProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  it("computes progress for mixed statuses", () => {
    const subtasks = [
      { statusType: "done" },
      { statusType: "in_progress" },
      { statusType: "done" },
      { statusType: "backlog" },
    ]
    expect(computeSubtaskProgress(subtasks)).toEqual({ done: 2, total: 4, percent: 50 })
  })

  it("computes 100% when all done", () => {
    const subtasks = [
      { statusType: "done" },
      { statusType: "done" },
    ]
    expect(computeSubtaskProgress(subtasks)).toEqual({ done: 2, total: 2, percent: 100 })
  })

  it("computes 0% when none done", () => {
    const subtasks = [
      { statusType: "backlog" },
      { statusType: "in_progress" },
    ]
    expect(computeSubtaskProgress(subtasks)).toEqual({ done: 0, total: 2, percent: 0 })
  })

  it("rounds percentage", () => {
    const subtasks = [
      { statusType: "done" },
      { statusType: "backlog" },
      { statusType: "backlog" },
    ]
    // 1/3 = 33.33... → 33
    expect(computeSubtaskProgress(subtasks)).toEqual({ done: 1, total: 3, percent: 33 })
  })

  it("handles single subtask done", () => {
    expect(computeSubtaskProgress([{ statusType: "done" }])).toEqual({
      done: 1, total: 1, percent: 100,
    })
  })

  it("handles single subtask not done", () => {
    expect(computeSubtaskProgress([{ statusType: "review" }])).toEqual({
      done: 0, total: 1, percent: 0,
    })
  })
})

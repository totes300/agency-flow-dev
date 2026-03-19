import { describe, expect, it } from "vitest"
import {
  computeSubtaskDefaults,
  computeReorderMap,
  computeNextSortOrder,
  isTiptapEmpty,
} from "./subtask"
import type { Id } from "@/convex/_generated/dataModel"

// ─── Helpers ────────────────────────────────────────────────────────────────────

const PROJECT_A = "project_a" as Id<"projects">
const CAT_A = "cat_a" as Id<"workCategories">
const USER_A = "user_a" as Id<"users">
const USER_B = "user_b" as Id<"users">

// ─── computeSubtaskDefaults ─────────────────────────────────────────────────────

describe("computeSubtaskDefaults", () => {
  it("inherits all fields from parent", () => {
    const parent = {
      projectId: PROJECT_A,
      billable: true,
      workCategoryId: CAT_A,
      assigneeIds: [USER_A, USER_B],
    }
    const defaults = computeSubtaskDefaults(parent)
    expect(defaults.projectId).toBe(PROJECT_A)
    expect(defaults.billable).toBe(true)
    expect(defaults.workCategoryId).toBe(CAT_A)
    expect(defaults.assigneeIds).toEqual([USER_A, USER_B])
  })

  it("handles parent with no project", () => {
    const parent = {
      projectId: undefined,
      billable: false,
      workCategoryId: undefined,
      assigneeIds: [],
    }
    const defaults = computeSubtaskDefaults(parent)
    expect(defaults.projectId).toBeUndefined()
    expect(defaults.billable).toBe(false)
    expect(defaults.workCategoryId).toBeUndefined()
    expect(defaults.assigneeIds).toEqual([])
  })

  it("returns a copy of assigneeIds (not same reference)", () => {
    const parent = {
      projectId: PROJECT_A,
      billable: true,
      workCategoryId: CAT_A,
      assigneeIds: [USER_A],
    }
    const defaults = computeSubtaskDefaults(parent)
    defaults.assigneeIds.push(USER_B)
    expect(parent.assigneeIds).toEqual([USER_A]) // original unchanged
  })

  it("inherits billable=false", () => {
    const parent = {
      projectId: PROJECT_A,
      billable: false,
      workCategoryId: CAT_A,
      assigneeIds: [USER_A],
    }
    expect(computeSubtaskDefaults(parent).billable).toBe(false)
  })
})

// ─── computeReorderMap ──────────────────────────────────────────────────────────

describe("computeReorderMap", () => {
  it("assigns 0-based indices", () => {
    const map = computeReorderMap(["a", "b", "c"])
    expect(map).toEqual({ a: 0, b: 1, c: 2 })
  })

  it("handles single item", () => {
    expect(computeReorderMap(["x"])).toEqual({ x: 0 })
  })

  it("handles empty array", () => {
    expect(computeReorderMap([])).toEqual({})
  })

  it("reflects new order after drag", () => {
    // Original: a,b,c → drag c to first: c,a,b
    const map = computeReorderMap(["c", "a", "b"])
    expect(map).toEqual({ c: 0, a: 1, b: 2 })
  })
})

// ─── computeNextSortOrder ───────────────────────────────────────────────────────

describe("computeNextSortOrder", () => {
  it("returns 0 for empty list", () => {
    expect(computeNextSortOrder([])).toBe(0)
  })

  it("returns max + 1", () => {
    expect(computeNextSortOrder([0, 1, 2])).toBe(3)
  })

  it("handles gaps", () => {
    expect(computeNextSortOrder([0, 5, 10])).toBe(11)
  })

  it("handles single item", () => {
    expect(computeNextSortOrder([0])).toBe(1)
  })

  it("handles unordered input", () => {
    expect(computeNextSortOrder([3, 1, 7, 2])).toBe(8)
  })
})

// ─── isTiptapEmpty ──────────────────────────────────────────────────────────────

describe("isTiptapEmpty", () => {
  it("returns true for null", () => {
    expect(isTiptapEmpty(null)).toBe(true)
  })

  it("returns true for undefined", () => {
    expect(isTiptapEmpty(undefined)).toBe(true)
  })

  it("returns true for empty object", () => {
    expect(isTiptapEmpty({})).toBe(true)
  })

  it("returns true for empty doc", () => {
    expect(isTiptapEmpty({ type: "doc", content: [] })).toBe(true)
  })

  it("returns true for doc with single empty paragraph", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [{ type: "paragraph" }],
    })).toBe(true)
  })

  it("returns true for doc with single paragraph with empty content", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [{ type: "paragraph", content: [] }],
    })).toBe(true)
  })

  it("returns false for doc with text content", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "hello" }],
      }],
    })).toBe(false)
  })

  it("returns false for doc with multiple paragraphs", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
      ],
    })).toBe(false)
  })

  it("returns false for doc with heading", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [{
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      }],
    })).toBe(false)
  })

  it("returns false for doc with bullet list", () => {
    expect(isTiptapEmpty({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
        }],
      }],
    })).toBe(false)
  })

  it("returns true for non-doc type", () => {
    expect(isTiptapEmpty({ type: "paragraph", content: [] })).toBe(true)
  })
})

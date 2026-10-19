import { describe, expect, it } from "vitest"
import { generateKeyBetween } from "fractional-indexing"
import type { Id, TableNames } from "@/convex/_generated/dataModel"
import { SYSTEM_VIEWS, type TaskViewSpec } from "@/convex/tasks/model"
import { type StatusRef, type TaskGroup } from "@/components/task-view/row-model"
import {
  canReorderList,
  inlineAddPrefill,
  reorderNeighbours,
  scopeDefaultStatusId,
} from "@/components/task-view/row-editing"

const id = <T extends TableNames>(s: string) => s as Id<T>

function status(_id: string, category: StatusRef["category"], extra: Partial<StatusRef> = {}): StatusRef {
  return {
    _id: id(_id),
    name: _id,
    description: null,
    color: "gray",
    category,
    position: "a0",
    isDefault: false,
    icon: { kind: "ring" },
    archived: false,
    ...extra,
  }
}

const STATUSES: StatusRef[] = [
  status("inbox", "backlog", { isDefault: true }),
  status("nextUp", "unstarted", { isDefault: true }),
  status("progress", "started", { isDefault: true }),
  status("review", "started"),
  status("done", "completed", { isDefault: true }),
]

const tasksViews = SYSTEM_VIEWS.tasks
const spec = (overrides: Partial<TaskViewSpec> = {}): TaskViewSpec => ({ ...tasksViews.active.spec, ...overrides })

function group(header: TaskGroup["header"]): TaskGroup {
  return { key: "g", label: "Group", header, rows: [] }
}

describe("canReorderList", () => {
  it("offers drag reorder only in a list in manual order", () => {
    expect(canReorderList(spec({ orderBy: "manual" }))).toBe(true)
    expect(canReorderList(spec({ orderBy: "manual", groupBy: "assignee" }))).toBe(true)
    expect(canReorderList(spec({ orderBy: "priority" }))).toBe(false)
    expect(canReorderList(spec({ orderBy: "dueDate" }))).toBe(false)
    expect(canReorderList(spec({ orderBy: "manual", layout: "board" }))).toBe(false)
  })

  it("is off in the system views' default (priority) order", () => {
    for (const view of Object.values(tasksViews)) expect(canReorderList(view.spec)).toBe(false)
  })
})

describe("reorderNeighbours", () => {
  const keys = ["a0", "a1", "a2", "a3"]

  it("moves down: between the old next row and the one after it", () => {
    expect(reorderNeighbours(keys, 0, 2)).toEqual({ beforeKey: "a2", afterKey: "a3" })
  })

  it("moves up: between the row above the target and the target", () => {
    expect(reorderNeighbours(keys, 3, 1)).toEqual({ beforeKey: "a0", afterKey: "a1" })
  })

  it("to the top has no key above, to the bottom none below", () => {
    expect(reorderNeighbours(keys, 2, 0)).toEqual({ afterKey: "a0" })
    expect(reorderNeighbours(keys, 0, 3)).toEqual({ beforeKey: "a3" })
  })

  it("returns null when nothing moves or an index is out of range", () => {
    expect(reorderNeighbours(keys, 1, 1)).toBeNull()
    expect(reorderNeighbours(keys, -1, 1)).toBeNull()
    expect(reorderNeighbours(keys, 0, 4)).toBeNull()
  })

  it("places after the last keyed row when the rows below have no key", () => {
    expect(reorderNeighbours(["a0", "a1", null, null], 0, 1)).toEqual({ beforeKey: "a1" })
  })

  it("refuses a position below a row without a key", () => {
    expect(reorderNeighbours(["a0", null, null], 0, 2)).toBeNull()
  })

  it("refuses neighbours whose keys are not strictly increasing", () => {
    expect(reorderNeighbours(["a0", "a1", "a1", "a2"], 3, 2)).toBeNull()
  })

  it("keeps hidden rows in order: a filtered drop is valid in the full order", () => {
    // Full order a..f; the visible (filtered) rows are b, d, f.
    const full = ["a", "b", "c", "d", "e", "f"]
    const keyOf: Record<string, string> = {}
    let prev: string | null = null
    for (const t of full) prev = keyOf[t] = generateKeyBetween(prev, null)
    const visible = ["b", "d", "f"]

    // Drag f to the top of the visible rows.
    const neighbours = reorderNeighbours(visible.map((t) => keyOf[t]), 2, 0)
    expect(neighbours).toEqual({ afterKey: keyOf.b })
    keyOf.f = generateKeyBetween(neighbours!.beforeKey ?? null, neighbours!.afterKey ?? null)

    const sorted = [...full].sort((x, y) => (keyOf[x] < keyOf[y] ? -1 : 1))
    expect(sorted.filter((t) => visible.includes(t))).toEqual(["f", "b", "d"])
    // The hidden rows keep their order relative to each other and to b, d.
    expect(sorted.filter((t) => t !== "f")).toEqual(["a", "b", "c", "d", "e"])
  })
})

describe("scopeDefaultStatusId", () => {
  it("uses the default status of the first category in the view's scope", () => {
    expect(scopeDefaultStatusId(tasksViews.active.spec, STATUSES)).toBe("nextUp")
    expect(scopeDefaultStatusId(tasksViews.backlog.spec, STATUSES)).toBe("inbox")
  })

  it("leaves unscoped views to the server default", () => {
    expect(scopeDefaultStatusId(tasksViews.all.spec, STATUSES)).toBeUndefined()
  })

  it("skips archived statuses and falls back to the first active one", () => {
    const statuses = [
      status("old", "unstarted", { isDefault: true, archived: true }),
      status("todo", "unstarted"),
      status("progress", "started", { isDefault: true }),
    ]
    expect(scopeDefaultStatusId(tasksViews.active.spec, statuses)).toBe("todo")
    expect(scopeDefaultStatusId(tasksViews.active.spec, [statuses[0], statuses[2]])).toBe("progress")
  })
})

describe("inlineAddPrefill", () => {
  const admin = { defaultStatusId: id<"statuses">("nextUp"), isAdmin: true }
  const member = { ...admin, isAdmin: false }
  const member1 = { _id: id<"users">("u1"), name: "Ádám", email: null, imageUrl: null, role: "admin" as const }

  it("ungrouped lists create in the view's default status", () => {
    expect(inlineAddPrefill(group({ kind: "none" }), admin)).toEqual({ statusId: "nextUp" })
    expect(inlineAddPrefill(group({ kind: "none" }), { defaultStatusId: undefined, isAdmin: true })).toEqual({})
  })

  it("a status group creates in its status", () => {
    expect(inlineAddPrefill(group({ kind: "status", status: STATUSES[3] }), member)).toEqual({ statusId: "review" })
  })

  it("prefills priority, assignee, project and label groups", () => {
    expect(inlineAddPrefill(group({ kind: "priority", priority: 2 }), member)).toEqual({ statusId: "nextUp", priority: 2 })
    expect(inlineAddPrefill(group({ kind: "assignee", member: member1 }), member)).toEqual({
      statusId: "nextUp",
      assigneeIds: ["u1"],
    })
    const project = { _id: id<"projects">("p1"), name: "Site", code: "ARLO", clientId: id<"clients">("c1"), archived: false }
    expect(inlineAddPrefill(group({ kind: "project", project, client: null }), member)).toEqual({
      statusId: "nextUp",
      projectId: "p1",
    })
    const label = { _id: id<"labels">("l1"), name: "Bug", color: "red", position: "a0", archived: false }
    expect(inlineAddPrefill(group({ kind: "label", label }), member)).toEqual({ statusId: "nextUp", labelIds: ["l1"] })
  })

  it("“No …” groups create without the value; No assignee is admin-only and pins no assignee", () => {
    expect(inlineAddPrefill(group({ kind: "project", project: null, client: null }), member)).toEqual({ statusId: "nextUp" })
    expect(inlineAddPrefill(group({ kind: "label", label: null }), member)).toEqual({ statusId: "nextUp" })
    expect(inlineAddPrefill(group({ kind: "client", client: null }), member)).toEqual({ statusId: "nextUp" })
    expect(inlineAddPrefill(group({ kind: "assignee", member: null }), admin)).toEqual({ statusId: "nextUp", assigneeIds: [] })
    expect(inlineAddPrefill(group({ kind: "assignee", member: null }), member)).toBeNull()
  })

  it("work category groups prefill for admins only (D5)", () => {
    const category = { _id: id<"workCategories">("w1"), name: "Design", color: "blue", sortOrder: 0, archived: false }
    expect(inlineAddPrefill(group({ kind: "workCategory", category }), admin)).toEqual({
      statusId: "nextUp",
      workCategoryId: "w1",
    })
    expect(inlineAddPrefill(group({ kind: "workCategory", category }), member)).toBeNull()
    expect(inlineAddPrefill(group({ kind: "workCategory", category: null }), member)).toEqual({ statusId: "nextUp" })
  })

  it("a client group has no single project, so it offers no add row", () => {
    const client = { _id: id<"clients">("c1"), name: "Arlo", prefix: null, usePrefix: false, archived: false }
    expect(inlineAddPrefill(group({ kind: "client", client }), admin)).toBeNull()
  })
})

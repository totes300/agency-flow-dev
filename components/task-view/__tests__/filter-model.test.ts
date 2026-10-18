import { describe, expect, it } from "vitest"
import type { Id, TableNames } from "@/convex/_generated/dataModel"
import { NONE_FILTER_VALUE } from "@/convex/tasks/model"
import {
  applyChips,
  applySearch,
  facetOptions,
  removeChip,
  toggleChipValue,
  valueLabel,
} from "@/components/task-view/filter-model"
import { boardMoveFor, canDragOnBoard } from "@/components/task-view/board-model"
import { buildRowModels, indexRefs, type TaskRowDTO, type WorkspaceRefs } from "@/components/task-view/row-model"
import type { ListFilter } from "@/components/task-view/view-state"

const id = <T extends TableNames>(s: string) => s as Id<T>

const refs: WorkspaceRefs = {
  me: id<"users">("u1"),
  orgTaskKey: "KON",
  statuses: [
    { _id: id("sNext"), name: "Next up", description: null, color: "blue", category: "unstarted", position: "a0", isDefault: true, icon: { kind: "ring" }, archived: false },
    { _id: id("sProg"), name: "In progress", description: null, color: "amber", category: "started", position: "a0", isDefault: true, icon: { kind: "pie", fill: 0.5 }, archived: false },
    { _id: id("sOld"), name: "Old", description: null, color: "gray", category: "started", position: "a1", isDefault: false, icon: { kind: "pie", fill: 0.6 }, archived: true },
  ],
  labels: [
    { _id: id("lBug"), name: "Bug", color: "red", position: "a0", archived: false },
    { _id: id("lFb"), name: "Client feedback", color: "orange", position: "a1", archived: false },
  ],
  projects: [
    { _id: id("pArlo"), name: "Webshop", code: "ARLO", clientId: id("cArlo"), archived: false },
    { _id: id("pNord"), name: "Website", code: "NORD", clientId: id("cNord"), archived: false },
  ],
  clients: [
    { _id: id("cArlo"), name: "Arlo Coffee", prefix: null, archived: false },
    { _id: id("cNord"), name: "Nordlys", prefix: null, archived: false },
  ],
  members: [
    { _id: id("u1"), name: "Ádám Tóth", email: null, imageUrl: null, role: "admin" },
    { _id: id("u2"), name: "Bence Kovács", email: null, imageUrl: null, role: "member" },
  ],
  workCategories: [],
} as unknown as WorkspaceRefs

function dto(overrides: Omit<Partial<TaskRowDTO>, "_id"> & { _id: string }): TaskRowDTO {
  return {
    identifier: null, title: overrides._id, statusId: id("sNext"), statusCategory: "unstarted", priority: 0,
    projectId: null, clientId: null, workCategoryId: null, billable: true, assigneeIds: [], labelIds: [],
    parentTaskId: null, sortKey: null, startDate: null, dueDate: null, estimateMinutes: null, trackedMinutes: 0,
    commentCount: 0, lastCommentAt: null, subtaskCount: 0, subtaskDoneCount: 0, hasDescription: false,
    lastActivityAt: 0, lastActivity: null, completedAt: null, archivedAt: null, createdAt: 0, createdBy: id("u1"),
    updatedAt: 0,
    ...overrides,
    _id: id<"tasks">(overrides._id),
  }
}

const index = indexRefs(refs)
const rows = buildRowModels(
  [
    dto({ _id: "t1", title: "Landing page", identifier: "ARLO-21", projectId: id("pArlo"), assigneeIds: [id("u1")], labelIds: [id("lBug")], priority: 1 }),
    dto({ _id: "t2", title: "Newsletter flow", projectId: id("pArlo"), assigneeIds: [id("u2")], statusId: id("sProg"), priority: 2 }),
    dto({ _id: "t3", title: "Sitemap", projectId: id("pNord"), assigneeIds: [id("u1"), id("u2")], labelIds: [id("lBug"), id("lFb")], priority: 2 }),
    dto({ _id: "t4", title: "Internal", statusId: id("sProg") }),
  ],
  { t3: { unreadComments: 2, hasUnseenChanges: false, inMyToday: false } },
  index,
)
const ids = (xs: ReadonlyArray<{ task: { _id: string } }>) => xs.map((r) => r.task._id)
const counts = (opts: ReturnType<typeof facetOptions>) => Object.fromEntries(opts.map((o) => [o.label, o.count]))

describe("search", () => {
  it("matches title or identifier, case-insensitively", () => {
    expect(ids(applySearch(rows, "  LANDING "))).toEqual(["t1"])
    expect(ids(applySearch(rows, "arlo-21"))).toEqual(["t1"])
    expect(ids(applySearch(rows, ""))).toHaveLength(4)
  })
})

describe("chips", () => {
  it("apply the shared matcher, resolving the client through the project", () => {
    const client: ListFilter = { property: "client", operator: "is", values: ["cArlo"] }
    expect(ids(applyChips(rows, [client], "u1"))).toEqual(["t1", "t2"])
    expect(ids(applyChips(rows, [{ property: "client", operator: "is", values: [NONE_FILTER_VALUE] }], "u1"))).toEqual(["t4"])
    expect(ids(applyChips(rows, [{ property: "assignee", operator: "is", values: ["me"] }], "u1"))).toEqual(["t1", "t3"])
    expect(ids(applyChips(rows, [{ property: "newComments", operator: "is", values: ["true"] }], "u1"))).toEqual(["t3"])
    // Chips AND together; values inside one chip OR.
    expect(
      ids(applyChips(rows, [client, { property: "priority", operator: "is", values: ["1", "2"] }, { property: "label", operator: "is", values: ["lBug"] }], "u1")),
    ).toEqual(["t1"])
  })

  it("toggle values, drop a chip with its last value, keep single-value fields single", () => {
    let chips = toggleChipValue([], "status", "sNext", "u1")
    expect(chips).toEqual([{ property: "status", operator: "is", values: ["sNext"] }])
    chips = toggleChipValue(chips, "status", "sProg", "u1")
    expect(chips[0].values).toEqual(["sNext", "sProg"])
    chips = toggleChipValue(toggleChipValue(chips, "status", "sNext", "u1"), "status", "sProg", "u1")
    expect(chips).toEqual([])
    const nc = toggleChipValue(toggleChipValue([], "newComments", "true", "u1"), "newComments", "false", "u1")
    expect(nc).toEqual([{ property: "newComments", operator: "is", values: ["false"] }])
    // A saved "me" value toggles off as the caller's id.
    expect(toggleChipValue([{ property: "assignee", operator: "is", values: ["me"] }], "assignee", "u1", "u1")).toEqual([])
    const a: ListFilter = { property: "priority", operator: "is", values: ["1"] }
    expect(removeChip([a], a)).toEqual([])
  })
})

describe("facets", () => {
  it("count the rows passing the OTHER chips; hide absent values and archived refs", () => {
    expect(counts(facetOptions(rows, [], "status", index, "u1"))).toEqual({ "Next up": 2, "In progress": 2 })
    expect(counts(facetOptions(rows, [], "label", index, "u1"))).toEqual({ Bug: 2, "Client feedback": 1, "No label": 2 })
    expect(counts(facetOptions(rows, [], "assignee", index, "u1"))).toEqual({ "Ádám Tóth (you)": 2, "Bence Kovács": 2, "No assignee": 1 })

    // Picking a client narrows the project facet to that client's projects.
    const byClient: ListFilter[] = [{ property: "client", operator: "is", values: ["cArlo"] }]
    expect(counts(facetOptions(rows, byClient, "project", index, "u1"))).toEqual({ "Arlo Coffee › Webshop": 2 })
    // …but the client facet itself still offers every client.
    const clientFacet = facetOptions(rows, byClient, "client", index, "u1")
    expect(counts(clientFacet)).toEqual({ "Arlo Coffee": 2, Nordlys: 1, "No client": 1 })
    expect(clientFacet.filter((o) => o.selected).map((o) => o.key)).toEqual(["cArlo"])
  })

  it("keeps a selected value at zero and offers the new-comments facet", () => {
    const chips: ListFilter[] = [
      { property: "priority", operator: "is", values: ["4"] },
    ]
    expect(facetOptions(rows, chips, "priority", index, "u1").find((o) => o.key === "4")).toMatchObject({ count: 0, selected: true })
    expect(counts(facetOptions(rows, [], "newComments", index, "u1"))).toEqual({ "Has new comments": 1, "No new comments": 3 })
  })

  it("labels chip values", () => {
    expect(valueLabel("assignee", "me", index, "u1")).toBe("Ádám Tóth (you)")
    expect(valueLabel("project", NONE_FILTER_VALUE, index, "u1")).toBe("No project")
    expect(valueLabel("status", "sProg", index, "u1")).toBe("In progress")
  })
})

describe("board moves", () => {
  const task = rows[2].task // t3: assignees u1 + u2, labels Bug + Client feedback, project NORD

  it("changes the grouped property", () => {
    expect(boardMoveFor("status", task, "sNext", "sProg")).toEqual({ kind: "status", statusId: "sProg" })
    expect(boardMoveFor("status", task, "sNext", "sNext")).toBeNull()
    expect(boardMoveFor("priority", task, "2", "1")).toEqual({ kind: "priority", priority: 1 })
    expect(boardMoveFor("project", task, "pNord", "none")).toEqual({ kind: "project", projectId: null })
    expect(boardMoveFor("workCategory", task, "none", "wDesign")).toEqual({ kind: "workCategory", workCategoryId: "wDesign" })
    expect(boardMoveFor("client", task, "cNord", "cArlo")).toBeNull()
  })

  it("swaps one value of a multi-value property; the none column clears it", () => {
    expect(boardMoveFor("assignee", task, "u2", "u3")).toEqual({ kind: "assignees", assigneeIds: ["u1", "u3"] })
    expect(boardMoveFor("assignee", task, "u2", "u1")).toEqual({ kind: "assignees", assigneeIds: ["u1"] })
    expect(boardMoveFor("assignee", task, "u1", "none")).toEqual({ kind: "assignees", assigneeIds: [] })
    expect(boardMoveFor("label", rows[3].task, "none", "lBug")).toEqual({ kind: "labels", labelIds: ["lBug"] })
  })

  it("follows the member field policy", () => {
    expect(canDragOnBoard("status", false)).toBe(true)
    expect(canDragOnBoard("assignee", false)).toBe(true)
    expect(canDragOnBoard("project", false)).toBe(false)
    expect(canDragOnBoard("workCategory", false)).toBe(false)
    expect(canDragOnBoard("project", true)).toBe(true)
    expect(canDragOnBoard("client", true)).toBe(false)
  })
})

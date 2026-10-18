import { describe, expect, it } from "vitest"
import type { Id, TableNames } from "@/convex/_generated/dataModel"
import { SYSTEM_VIEWS } from "@/convex/tasks/model"
import {
  buildRowModels,
  groupRows,
  indexRefs,
  sortRows,
  type TaskRowDTO,
  type WorkspaceRefs,
} from "@/components/task-view/row-model"

const id = <T extends TableNames>(s: string) => s as Id<T>

const refs: WorkspaceRefs = {
  me: id<"users">("u1"),
  orgTaskKey: "KON",
  statuses: [
    { _id: id("sBacklog"), name: "Inbox", description: null, color: "gray", category: "backlog", position: "a0", isDefault: true, icon: { kind: "dashedRing" }, archived: false },
    { _id: id("sNext"), name: "Next up", description: null, color: "blue", category: "unstarted", position: "a0", isDefault: true, icon: { kind: "ring" }, archived: false },
    { _id: id("sProg"), name: "In progress", description: null, color: "amber", category: "started", position: "a0", isDefault: true, icon: { kind: "pie", fill: 0.5 }, archived: false },
    { _id: id("sDone"), name: "Done", description: null, color: "green", category: "completed", position: "a0", isDefault: true, icon: { kind: "check" }, archived: false },
  ],
  labels: [],
  projects: [],
  clients: [],
  members: [
    { _id: id("u1"), name: "Ádám Tóth", email: null, imageUrl: null, role: "admin" },
    { _id: id("u2"), name: "Bence Kovács", email: null, imageUrl: null, role: "member" },
  ],
  workCategories: [],
}

function dto(overrides: Omit<Partial<TaskRowDTO>, "_id"> & { _id: string }): TaskRowDTO {
  return {
    identifier: null,
    title: overrides._id,
    statusId: id("sNext"),
    statusCategory: "unstarted",
    priority: 0,
    projectId: null,
    clientId: null,
    workCategoryId: null,
    billable: true,
    assigneeIds: [],
    labelIds: [],
    parentTaskId: null,
    sortKey: null,
    startDate: null,
    dueDate: null,
    estimateMinutes: null,
    trackedMinutes: 0,
    commentCount: 0,
    lastCommentAt: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    hasDescription: false,
    lastActivityAt: 0,
    lastActivity: null,
    completedAt: null,
    archivedAt: null,
    createdAt: 0,
    createdBy: id("u1"),
    updatedAt: 0,
    ...overrides,
    _id: id<"tasks">(overrides._id),
  }
}

const index = indexRefs(refs)

describe("row model", () => {
  it("resolves refs and the sparse per-user state", () => {
    const [row] = buildRowModels(
      [dto({ _id: "t1", assigneeIds: [id("u2"), id("gone")] })],
      { t1: { unreadComments: 2, hasUnseenChanges: true, inMyToday: false } },
      index,
    )
    expect(row.status?.name).toBe("Next up")
    expect(row.assignees.map((a) => a.name)).toEqual(["Bence Kovács"])
    expect(row.perUser.unreadComments).toBe(2)
    const [plain] = buildRowModels([dto({ _id: "t2" })], {}, index)
    expect(plain.perUser).toEqual({ unreadComments: 0, hasUnseenChanges: false, inMyToday: false })
  })

  it("orders by priority with no-priority last, ties by sort key", () => {
    const rows = buildRowModels(
      [
        dto({ _id: "none", priority: 0, sortKey: "a0" }),
        dto({ _id: "low", priority: 4, sortKey: "a1" }),
        dto({ _id: "urgentB", priority: 1, sortKey: "a3" }),
        dto({ _id: "urgentA", priority: 1, sortKey: "a2" }),
      ],
      {},
      index,
    )
    expect(sortRows(rows, "priority").map((r) => r.task._id)).toEqual(["urgentA", "urgentB", "low", "none"])
  })

  it("groups by status in workflow order and hides empty groups", () => {
    const rows = buildRowModels(
      [dto({ _id: "a", statusId: id("sProg") }), dto({ _id: "b", statusId: id("sNext") })],
      {},
      index,
    )
    const groups = groupRows(rows, SYSTEM_VIEWS.tasks.active.spec, index)
    expect(groups.map((g) => g.label)).toEqual(["Next up", "In progress"])
  })

  it("shows empty status groups only inside the view's category scope", () => {
    const groups = groupRows([], { ...SYSTEM_VIEWS.tasks.active.spec, showEmptyGroups: true }, index)
    expect(groups.map((g) => g.label)).toEqual(["Next up", "In progress"])
  })

  it("puts a multi-assignee task in each assignee's group, unassigned last", () => {
    const rows = buildRowModels(
      [dto({ _id: "both", assigneeIds: [id("u1"), id("u2")] }), dto({ _id: "nobody" })],
      {},
      index,
    )
    const groups = groupRows(rows, { groupBy: "assignee", showEmptyGroups: false, filters: [] }, index)
    expect(groups.map((g) => [g.label, g.rows.map((r) => r.task._id)])).toEqual([
      ["Ádám Tóth", ["both"]],
      ["Bence Kovács", ["both"]],
      ["No assignee", ["nobody"]],
    ])
  })
})

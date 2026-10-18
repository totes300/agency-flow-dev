import { describe, expect, it } from "vitest"
import type { Id, TableNames } from "@/convex/_generated/dataModel"
import { addDaysToDateString } from "@/convex/lib/todayPlan"
import { formatDateToYMD } from "@/lib/format"
import { buildRowModels, indexRefs, type TaskRowDTO, type WorkspaceRefs } from "@/components/task-view/row-model"
import {
  MY_WORK_SPEC,
  buildMyWorkBoard,
  defaultStatusOf,
  doneDayLabel,
  myWorkMoveFor,
  weekStartOf,
} from "@/components/task-view/my-work-model"

const id = <T extends TableNames>(s: string) => s as Id<T>

const refs: WorkspaceRefs = {
  me: id<"users">("u1"),
  orgTaskKey: "KON",
  statuses: [
    { _id: id("sBacklog"), name: "Inbox", description: null, color: "gray", category: "backlog", position: "a0", isDefault: true, icon: { kind: "dashedRing" }, archived: false },
    { _id: id("sNext"), name: "Next up", description: null, color: "blue", category: "unstarted", position: "a0", isDefault: true, icon: { kind: "ring" }, archived: false },
    { _id: id("sProg"), name: "In progress", description: null, color: "amber", category: "started", position: "a0", isDefault: true, icon: { kind: "pie", fill: 0.5 }, archived: false },
    { _id: id("sReview"), name: "Client review", description: null, color: "violet", category: "started", position: "a1", isDefault: false, icon: { kind: "pie", fill: 0.75 }, archived: false },
    { _id: id("sDone"), name: "Done", description: null, color: "green", category: "completed", position: "a0", isDefault: true, icon: { kind: "check" }, archived: false },
    { _id: id("sCanceled"), name: "Canceled", description: null, color: "gray", category: "canceled", position: "a0", isDefault: true, icon: { kind: "cross" }, archived: false },
  ],
  labels: [],
  projects: [],
  clients: [],
  members: [{ _id: id("u1"), name: "Ádám Tóth", email: null, imageUrl: null, role: "admin" }],
  workCategories: [],
}
const index = indexRefs(refs)
const statuses = refs.statuses

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
    assigneeIds: [id("u1")],
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
const rows = (...dtos: TaskRowDTO[]) => buildRowModels(dtos, {}, index)

/** Local noon on a YYYY-MM-DD day (the board buckets completions by the client's calendar). */
function at(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

const TODAY = "2026-10-21" // a Wednesday
const ids = (col: { rows: { task: { _id: string } }[] }) => col.rows.map((r) => r.task._id)

describe("my work board — preset", () => {
  it("is the Assigned view as a board, scoped to started + completed work", () => {
    expect(MY_WORK_SPEC.layout).toBe("board")
    expect(MY_WORK_SPEC.filters).toEqual([
      { property: "assignee", operator: "is", values: ["me"] },
      { property: "statusCategory", operator: "is", values: ["started", "completed"] },
    ])
    expect(MY_WORK_SPEC.visibleProperties).not.toContain("assignee")
  })

  it("weeks start on Monday; done days read Today / Yesterday / weekday", () => {
    expect(weekStartOf("2026-10-21")).toBe("2026-10-19")
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19")
    expect(weekStartOf("2026-10-25")).toBe("2026-10-19") // Sunday belongs to the week before
    expect(doneDayLabel(TODAY, TODAY)).toBe("Today")
    expect(doneDayLabel("2026-10-20", TODAY)).toBe("Yesterday")
    expect(doneDayLabel("2026-10-19", TODAY)).toBe("Monday")
  })

  it("default status per category skips archived statuses", () => {
    expect(defaultStatusOf(statuses, "started")?._id).toBe("sProg")
    const archived = statuses.map((s) => (s._id === "sProg" ? { ...s, archived: true } : s))
    expect(defaultStatusOf(archived, "started")?._id).toBe("sReview")
  })
})

describe("my work board — columns", () => {
  it("In progress wins over Today; Today keeps the plan order; Done is this week's completions, newest first", () => {
    const listRows = rows(
      dto({ _id: "prog", statusId: id("sProg"), statusCategory: "started", priority: 3 }),
      dto({ _id: "review", statusId: id("sReview"), statusCategory: "started", priority: 1 }),
      dto({ _id: "doneToday", statusId: id("sDone"), statusCategory: "completed", completedAt: at(TODAY) }),
      dto({ _id: "doneMon", statusId: id("sDone"), statusCategory: "completed", completedAt: at("2026-10-19") }),
      dto({ _id: "doneMon2", statusId: id("sDone"), statusCategory: "completed", completedAt: at("2026-10-19") - 1000 }),
      dto({ _id: "doneLastWeek", statusId: id("sDone"), statusCategory: "completed", completedAt: at("2026-10-18") }),
    )
    const todayRows = rows(
      dto({ _id: "planB" }),
      dto({ _id: "planStarted", statusId: id("sProg"), statusCategory: "started" }),
      dto({ _id: "planA", statusId: id("sBacklog"), statusCategory: "backlog" }),
    )
    const board = buildMyWorkBoard({ listRows, todayRows, statuses, today: TODAY })
    const [inProgress, today, done] = board.columns
    expect(board.columns.map((c) => c.key)).toEqual(["inProgress", "today", "done"])
    expect(board.columns.map((c) => c.label)).toEqual(["In progress", "Today", "Done this week"])
    // Priority order (urgent first); the planned started task joins In progress, not Today.
    expect(ids(inProgress)).toEqual(["review", "prog", "planStarted"])
    expect(ids(today)).toEqual(["planB", "planA"])
    expect([...board.todayIds]).toEqual(["planB", "planA"])
    expect(ids(done)).toEqual(["doneToday", "doneMon", "doneMon2"])
    expect([...board.dividers.entries()]).toEqual([
      ["doneToday", "Today"],
      ["doneMon", "Monday"],
    ])
    expect(today.header).toEqual({ kind: "today" })
    expect(inProgress.header.kind === "status" && inProgress.header.status._id).toBe("sProg")
    expect(done.header.kind === "status" && done.header.status._id).toBe("sDone")
  })

  it("leaves out canceled, closed plans and sub-tasks", () => {
    const listRows = rows(
      dto({ _id: "canceled", statusId: id("sCanceled"), statusCategory: "canceled", completedAt: at(TODAY) }),
      dto({ _id: "sub", statusId: id("sProg"), statusCategory: "started", parentTaskId: id("parent") }),
    )
    const todayRows = rows(dto({ _id: "closedPlan", statusId: id("sDone"), statusCategory: "completed", completedAt: at(TODAY) }))
    const board = buildMyWorkBoard({ listRows, todayRows, statuses, today: TODAY })
    expect(board.columns.map(ids)).toEqual([[], [], []])
  })

  it("buckets completions by the client's calendar day", () => {
    const now = new Date()
    const today = formatDateToYMD(now)
    const [row] = rows(dto({ _id: "d", statusId: id("sDone"), statusCategory: "completed", completedAt: now.getTime() }))
    const board = buildMyWorkBoard({ listRows: [row], todayRows: [], statuses, today })
    expect(ids(board.columns[2])).toEqual(["d"])
    const lastWeek = buildMyWorkBoard({ listRows: [row], todayRows: [], statuses, today: addDaysToDateString(today, 7) })
    expect(ids(lastWeek.columns[2])).toEqual([])
  })
})

describe("my work board — drops", () => {
  const [open] = rows(dto({ _id: "open" }))
  const [started] = rows(dto({ _id: "started", statusId: id("sReview"), statusCategory: "started" }))
  const [done] = rows(dto({ _id: "done", statusId: id("sDone"), statusCategory: "completed" }))

  it("→ In progress starts, → Done completes (org defaults), same column or same category is a no-op", () => {
    expect(myWorkMoveFor(open, "today", "inProgress", statuses)).toEqual({ kind: "status", statusId: "sProg" })
    expect(myWorkMoveFor(started, "inProgress", "done", statuses)).toEqual({ kind: "status", statusId: "sDone" })
    expect(myWorkMoveFor(done, "done", "inProgress", statuses)).toEqual({ kind: "status", statusId: "sProg" })
    expect(myWorkMoveFor(open, "today", "today", statuses)).toBeNull()
    expect(myWorkMoveFor(started, "today", "inProgress", statuses)).toBeNull()
    expect(myWorkMoveFor(done, "inProgress", "done", statuses)).toBeNull()
  })

  it("→ Today plans it; started or finished work goes back to the default not-started status first", () => {
    expect(myWorkMoveFor(open, "inProgress", "today", statuses)).toEqual({ kind: "plan", resetStatusId: null })
    expect(myWorkMoveFor(started, "inProgress", "today", statuses)).toEqual({ kind: "plan", resetStatusId: "sNext" })
    expect(myWorkMoveFor(done, "done", "today", statuses)).toEqual({ kind: "plan", resetStatusId: "sNext" })
  })
})

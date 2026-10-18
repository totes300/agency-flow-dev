import { describe, expect, it } from "vitest"
import type { Id } from "@/convex/_generated/dataModel"
import { indexRefs, type TaskRowDTO, type WorkspaceRefs } from "@/components/task-view/row-model"
import {
  buildTodaySections,
  moveInOrder,
  pickerGroups,
  plannedOnLabel,
  todayHeading,
  todayOrderedIds,
  type TodayListResult,
} from "@/components/my-tasks/today-model"

const t = (s: string) => s as Id<"tasks">
const TODAY = "2026-10-18" // a Sunday

const refs = {
  me: "u1",
  orgTaskKey: "KON",
  statuses: [],
  labels: [],
  projects: [],
  clients: [],
  members: [],
  workCategories: [],
} as unknown as WorkspaceRefs

function dto(_id: string, extra: Partial<TaskRowDTO> = {}): TaskRowDTO {
  return {
    _id: t(_id), title: _id, statusCategory: "unstarted", dueDate: null, assigneeIds: [], labelIds: [],
    parentTaskId: null, archivedAt: null, ...extra,
  } as TaskRowDTO
}

describe("today sections", () => {
  const result = {
    date: TODAY,
    rows: [dto("a"), dto("b"), dto("c"), dto("d", { statusCategory: "completed" })],
    today: [{ taskId: t("b"), todaySortKey: "a0" }, { taskId: t("a"), todaySortKey: null }],
    carried: [{ taskId: t("c"), plannedOn: "2026-10-16" }],
    doneToday: [t("d")],
    perUser: { b: { unreadComments: 2, hasUnseenChanges: false, inMyToday: true } },
    truncated: false,
  } as unknown as TodayListResult

  it("splits rows into carried / today (server order) / done", () => {
    const sections = buildTodaySections(result, indexRefs(refs))
    expect(sections.today.map((r) => r.task._id)).toEqual(["b", "a"])
    expect(sections.today[0].perUser.unreadComments).toBe(2)
    expect(sections.carried.map((c) => [c.row.task._id, c.plannedOn])).toEqual([["c", "2026-10-16"]])
    expect(sections.done.map((r) => r.task._id)).toEqual(["d"])
  })

  it("orders ids for J/K, skipping collapsed sections", () => {
    const sections = buildTodaySections(result, indexRefs(refs))
    expect(todayOrderedIds(sections, { carried: false, done: true })).toEqual(["c", "b", "a"])
    expect(todayOrderedIds(sections, { carried: true, done: false })).toEqual(["b", "a", "d"])
  })
})

describe("moveInOrder", () => {
  it("moves one id and refuses no-ops", () => {
    expect(moveInOrder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
    expect(moveInOrder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
    expect(moveInOrder(["a", "b"], 1, 1)).toBeNull()
    expect(moveInOrder(["a", "b"], 0, 5)).toBeNull()
  })
})

describe("labels", () => {
  it("says when a carried task was planned", () => {
    expect(plannedOnLabel("2026-10-17", TODAY)).toBe("yesterday")
    expect(plannedOnLabel("2026-10-16", TODAY)).toBe("Fri")
    expect(plannedOnLabel("2026-10-12", TODAY)).toBe("Mon")
    expect(plannedOnLabel("2026-10-09", TODAY)).toBe("Oct 9")
  })

  it("formats the Today heading", () => {
    expect(todayHeading(TODAY)).toBe("Sunday, October 18")
  })
})

describe("pickerGroups", () => {
  it("suggests due soon / overdue, started and carried; skips what is already today", () => {
    const groups = pickerGroups(
      [
        dto("due-soon", { dueDate: "2026-10-21" }),
        dto("due-later", { dueDate: "2026-10-30" }),
        dto("overdue", { dueDate: "2026-10-01" }),
        dto("started", { statusCategory: "started" }),
        dto("carried"),
        dto("plain"),
        dto("in-today", { statusCategory: "started" }),
      ],
      { today: TODAY, todayIds: new Set([t("in-today")]), carriedIds: new Set([t("carried")]) },
    )
    expect(groups.suggested.map((r) => r._id)).toEqual(["due-soon", "overdue", "started", "carried"])
    expect(groups.rest.map((r) => r._id)).toEqual(["due-later", "plain"])
  })
})

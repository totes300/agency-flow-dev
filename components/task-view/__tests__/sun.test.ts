import { describe, expect, it } from "vitest"
import type { Id } from "@/convex/_generated/dataModel"
import { DEFAULT_PER_USER_STATE, type TaskRowDTO, type TaskRowModel } from "@/components/task-view/row-model"
import {
  ASSIGN_FIRST_LABEL,
  addedToTodayMessage,
  bulkAddedMessage,
  sunStateFor,
  sunTargets,
  whoseToday,
} from "@/components/task-view/sun"

const u = (s: string) => s as Id<"users">
const ME = u("me")
const BOB = u("bob")
const REKA = u("reka")
const members = new Map([
  [ME, { name: "Ádám Tóth" }],
  [BOB, { name: "Bob Smith" }],
  [REKA, { name: "Réka Nagy" }],
])

function row(task: Partial<TaskRowDTO>, extra: Partial<TaskRowModel> = {}): Pick<TaskRowModel, "task" | "isClosed" | "perUser"> {
  return {
    task: { _id: "t1" as Id<"tasks">, assigneeIds: [], parentTaskId: null, archivedAt: null, ...task } as TaskRowDTO,
    isClosed: false,
    perUser: DEFAULT_PER_USER_STATE,
    ...extra,
  }
}

describe("sun targets (D9)", () => {
  it("member → own day; admin → every assignee; nobody without assignees", () => {
    expect(sunTargets([BOB, ME], { me: ME, isAdmin: false })).toEqual([ME])
    expect(sunTargets([BOB, REKA, BOB], { me: ME, isAdmin: true })).toEqual([BOB, REKA])
    expect(sunTargets([], { me: ME, isAdmin: true })).toEqual([])
  })

  it("names whose today it is", () => {
    expect(whoseToday([ME], ME, members)).toBe("your")
    expect(whoseToday([BOB], ME, members)).toBe("Bob's")
    expect(whoseToday([BOB, ME], ME, members)).toBe("your and Bob's")
    expect(whoseToday([BOB, REKA], ME, members)).toBe("Bob and Réka's")
    expect(whoseToday([BOB, REKA, ME], ME, members)).toBe("3 people's")
  })
})

describe("sunStateFor", () => {
  const admin = { me: ME, isAdmin: true }
  const member = { me: ME, isAdmin: false }

  it("is hidden on sub-tasks, closed and archived tasks", () => {
    expect(sunStateFor(row({ assigneeIds: [ME], parentTaskId: "p" as Id<"tasks"> }), member, {}, members).kind).toBe("hidden")
    expect(sunStateFor(row({ assigneeIds: [ME] }, { isClosed: true }), member, {}, members).kind).toBe("hidden")
    expect(sunStateFor(row({ assigneeIds: [ME], archivedAt: 1 }), member, {}, members).kind).toBe("hidden")
  })

  it("is disabled with 'Assign first' without assignees", () => {
    expect(sunStateFor(row({}), admin, {}, members)).toEqual({ kind: "disabled", label: ASSIGN_FIRST_LABEL })
  })

  it("is on only when every target has the task today", () => {
    const task = { assigneeIds: [BOB, REKA] }
    expect(sunStateFor(row(task), admin, { t1: [BOB] }, members)).toMatchObject({
      kind: "off",
      label: "Add to Bob and Réka's today (T)",
      targets: [BOB, REKA],
    })
    expect(sunStateFor(row(task), admin, { t1: [REKA, BOB] }, members).kind).toBe("on")
    // A member's sun is their own day, whoever else is planned.
    expect(sunStateFor(row({ assigneeIds: [BOB, ME] }), member, { t1: [BOB] }, members)).toMatchObject({
      kind: "off",
      label: "Add to your today (T)",
    })
  })

  it("falls back to the row's own inMyToday before the plan map loads", () => {
    const r = row({ assigneeIds: [ME] }, { perUser: { ...DEFAULT_PER_USER_STATE, inMyToday: true } })
    expect(sunStateFor(r, member, undefined, members).kind).toBe("on")
  })
})

describe("toast copy", () => {
  it("single add", () => {
    expect(addedToTodayMessage({ added: [BOB], alreadyPlanned: [] }, ME, members)).toBe("Added to Bob's today")
    expect(addedToTodayMessage({ added: [], alreadyPlanned: [ME] }, ME, members)).toBe("Already in your today")
  })

  it("bulk: added N · skipped M (no assignee)", () => {
    expect(bulkAddedMessage({ added: 3, alreadyPlanned: 0, skippedNoAssignee: 2, skipped: 0 })).toBe(
      "Added 3 to today · 2 skipped (no assignee)",
    )
    expect(bulkAddedMessage({ added: 1, alreadyPlanned: 1, skippedNoAssignee: 0, skipped: 1 })).toBe(
      "Added 1 to today · 1 already planned · 1 skipped",
    )
  })
})

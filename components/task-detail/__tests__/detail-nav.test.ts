import { describe, expect, it } from "vitest"
import type { Id } from "@/convex/_generated/dataModel"
import { navLabelFor, navPosition, readDetailNavList, setDetailNavList } from "@/components/task-detail/detail-nav"
import { taskMatchesRef } from "@/components/task-detail/use-drawer-task"

const id = (s: string) => s as Id<"tasks">

describe("navPosition (full-page J/K)", () => {
  const entries = [
    { id: id("a"), identifier: "KON-1" },
    { id: id("b"), identifier: "KON-2" },
    { id: id("c"), identifier: null },
  ]

  it("gives index, total and neighbours without wrap-around", () => {
    expect(navPosition(entries, id("a"))).toEqual({ index: 0, total: 3, prev: null, next: entries[1] })
    expect(navPosition(entries, id("b"))).toEqual({ index: 1, total: 3, prev: entries[0], next: entries[2] })
    expect(navPosition(entries, id("c"))).toEqual({ index: 2, total: 3, prev: entries[1], next: null })
  })

  it("is null when the task is not in the list", () => {
    expect(navPosition(entries, id("z"))).toBeNull()
  })
})

describe("detail nav list storage", () => {
  it("round-trips through sessionStorage", () => {
    const list = { from: { label: "My Tasks", href: "/my-tasks?tab=assigned" }, entries: [{ id: id("a"), identifier: "KON-1" }] }
    setDetailNavList(list)
    expect(readDetailNavList()).toEqual(list)
    expect(JSON.parse(window.sessionStorage.getItem("task-detail-nav") ?? "null")).toEqual(list)
  })
})

describe("navLabelFor", () => {
  it("names the list routes", () => {
    expect(navLabelFor("/tasks")).toBe("Tasks")
    expect(navLabelFor("/my-tasks")).toBe("My Tasks")
    expect(navLabelFor("/projects/abc")).toBe("Project")
    expect(navLabelFor("/somewhere")).toBe("Back")
  })
})

describe("taskMatchesRef (drawer keeps the resolved task while the URL is canonicalised)", () => {
  const task = { _id: id("a"), identifier: "ARLO-21" }

  it("matches by id or by identifier ignoring case", () => {
    expect(taskMatchesRef(task, { kind: "id", id: "a" })).toBe(true)
    expect(taskMatchesRef(task, { kind: "identifier", identifier: "arlo-21" })).toBe(true)
    expect(taskMatchesRef(task, { kind: "identifier", identifier: "ARLO-22" })).toBe(false)
    expect(taskMatchesRef({ _id: id("a"), identifier: null }, { kind: "identifier", identifier: "ARLO-21" })).toBe(false)
  })
})

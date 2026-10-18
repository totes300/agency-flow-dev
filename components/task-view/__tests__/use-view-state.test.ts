import { describe, expect, it } from "vitest"
import { DEFAULT_VISIBLE_PROPERTIES, SYSTEM_VIEWS } from "@/convex/tasks/model"
import {
  baseSpecFor,
  diffOverrides,
  isSpecModified,
  parseOverrides,
  resolveViewKey,
  specFromSearchParams,
  systemViewsFor,
  toSearchString,
  writeViewParams,
} from "@/components/task-view/view-state"

const params = (s: string) => new URLSearchParams(s)

describe("view key (URL → system view)", () => {
  it("lists the /tasks system views in order", () => {
    expect(systemViewsFor("tasks")).toEqual([
      { key: "active", name: "Active" },
      { key: "backlog", name: "Backlog" },
      { key: "all", name: "All tasks" },
    ])
  })

  it("falls back to the surface default for a missing or unknown view", () => {
    expect(resolveViewKey("tasks", null)).toBe("active")
    expect(resolveViewKey("tasks", "nope")).toBe("active")
    expect(resolveViewKey("tasks", "toString")).toBe("active")
    expect(resolveViewKey("tasks", "backlog")).toBe("backlog")
  })

  it("uses the system view's spec as the base", () => {
    expect(baseSpecFor("tasks", "backlog")).toBe(SYSTEM_VIEWS.tasks.backlog.spec)
    expect(baseSpecFor("tasks", "garbage")).toBe(SYSTEM_VIEWS.tasks.active.spec)
  })
})

describe("URL → spec", () => {
  const base = SYSTEM_VIEWS.tasks.active.spec

  it("returns the base spec when the URL carries no overrides", () => {
    expect(specFromSearchParams(params("detail=abc"), base)).toEqual(base)
  })

  it("applies valid overrides on top of the view's spec", () => {
    const spec = specFromSearchParams(params("group=assignee&order=dueDate&props=title,due&sub=1&empty=1"), base)
    expect(spec).toEqual({
      ...base,
      groupBy: "assignee",
      orderBy: "dueDate",
      visibleProperties: ["title", "due"],
      showSubtasks: true,
      showEmptyGroups: true,
    })
    // Filters are the view's scope and never come from the URL in slice 3.
    expect(spec.filters).toBe(base.filters)
  })

  it("ignores invalid values", () => {
    expect(parseOverrides(params("group=planet&order=random&sub=yes&empty=2&props=bogus,,"))).toEqual({})
  })

  it("keeps valid properties, drops unknown ones and duplicates", () => {
    expect(parseOverrides(params("props=due,bogus,due,time")).visibleProperties).toEqual(["due", "time"])
    expect(parseOverrides(params("props=")).visibleProperties).toEqual([])
  })
})

describe("spec → URL", () => {
  it("writes only what differs from the view's spec", () => {
    const base = SYSTEM_VIEWS.tasks.all.spec
    const next = writeViewParams(params(""), "tasks", "all", { ...base, orderBy: "title" })
    expect(next.toString()).toBe("view=all&order=title")
  })

  it("omits the default view and clears overrides equal to the spec", () => {
    const base = SYSTEM_VIEWS.tasks.active.spec
    const next = writeViewParams(params("view=active&order=title&group=priority"), "tasks", "active", base)
    expect(toSearchString(next)).toBe("")
  })

  it("preserves params it does not own", () => {
    const base = SYSTEM_VIEWS.tasks.backlog.spec
    const next = writeViewParams(params("detail=t1&order=title"), "tasks", "backlog", base)
    expect(next.get("detail")).toBe("t1")
    expect(next.get("view")).toBe("backlog")
    expect(next.has("order")).toBe(false)
  })

  it("round-trips: spec → URL → spec", () => {
    const base = SYSTEM_VIEWS.tasks.backlog.spec
    const spec = {
      ...base,
      groupBy: "none" as const,
      orderBy: "createdAt" as const,
      visibleProperties: ["priority", "title", "labels"] as typeof base.visibleProperties,
      showSubtasks: true,
      showEmptyGroups: true,
    }
    const url = writeViewParams(params(""), "tasks", "backlog", spec)
    expect(specFromSearchParams(url, baseSpecFor("tasks", url.get("view")!))).toEqual(spec)
  })

  it("serialises boolean overrides as 1/0", () => {
    const base = SYSTEM_VIEWS.tasks.all.spec
    const url = writeViewParams(params(""), "tasks", "all", { ...base, showSubtasks: true, showEmptyGroups: true })
    expect(url.get("sub")).toBe("1")
    expect(url.get("empty")).toBe("1")
    expect(diffOverrides({ ...base, showSubtasks: true }, base)).toEqual({ showSubtasks: true })
  })
})

describe("modified detection", () => {
  const base = SYSTEM_VIEWS.tasks.active.spec

  it("is unmodified for the plain view", () => {
    expect(isSpecModified(base, base)).toBe(false)
    expect(isSpecModified({ ...base, visibleProperties: [...DEFAULT_VISIBLE_PROPERTIES] }, base)).toBe(false)
  })

  it("is modified when any display field differs", () => {
    expect(isSpecModified({ ...base, orderBy: "title" }, base)).toBe(true)
    expect(isSpecModified({ ...base, groupBy: "none" }, base)).toBe(true)
    expect(isSpecModified({ ...base, showEmptyGroups: true }, base)).toBe(true)
    expect(isSpecModified({ ...base, visibleProperties: [...base.visibleProperties].reverse() }, base)).toBe(true)
  })

  it("matches what the URL carries", () => {
    expect(isSpecModified(specFromSearchParams(params("order=title"), base), base)).toBe(true)
    expect(isSpecModified(specFromSearchParams(params("order=priority"), base), base)).toBe(false)
  })
})

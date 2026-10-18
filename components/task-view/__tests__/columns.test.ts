import { describe, expect, it } from "vitest"
import { DEFAULT_VISIBLE_PROPERTIES, SYSTEM_VIEWS, type TaskViewSpec } from "@/convex/tasks/model"
import {
  COLUMNS,
  gridTemplateFor,
  tableMinWidthFor,
  visibleColumnKeys,
} from "@/components/task-view/column-rules"

type Spec = Pick<TaskViewSpec, "visibleProperties" | "groupBy">
const spec = (groupBy: TaskViewSpec["groupBy"], visibleProperties = DEFAULT_VISIBLE_PROPERTIES): Spec => ({
  groupBy,
  visibleProperties,
})

describe("column registry (§6.3)", () => {
  it("has every registry key once, in prototype order", () => {
    expect(COLUMNS.map((c) => c.key)).toEqual([
      "priority", "id", "statusIcon", "title", "status", "category", "labels",
      "client", "assignee", "due", "estimate", "time", "created", "activity",
    ])
  })

  it("default columns follow prototype v4 (no ID, labels, estimate, created, activity)", () => {
    expect(visibleColumnKeys(spec("none"))).toEqual([
      "priority", "title", "status", "category", "client", "assignee", "due", "time",
    ])
  })
})

describe("U3 visibility rules", () => {
  it("grouped by status → status becomes an icon before the title", () => {
    const keys = visibleColumnKeys(spec("status"))
    expect(keys).not.toContain("status")
    expect(keys.indexOf("statusIcon")).toBe(keys.indexOf("title") - 1)
  })

  it("grouped by status with Status hidden → no status icon either", () => {
    const keys = visibleColumnKeys(spec("status", DEFAULT_VISIBLE_PROPERTIES.filter((p) => p !== "status")))
    expect(keys).not.toContain("status")
    expect(keys).not.toContain("statusIcon")
  })

  it("grouped by project or client → no Client column", () => {
    expect(visibleColumnKeys(spec("project"))).not.toContain("client")
    expect(visibleColumnKeys(spec("client"))).not.toContain("client")
  })

  it("grouped by assignee → no Assignee column", () => {
    expect(visibleColumnKeys(spec("assignee"))).not.toContain("assignee")
  })

  it("grouped by priority / category / label → that column is not repeated", () => {
    expect(visibleColumnKeys(spec("priority"))).not.toContain("priority")
    expect(visibleColumnKeys(spec("workCategory"))).not.toContain("category")
    const withLabels = [...DEFAULT_VISIBLE_PROPERTIES, "labels" as const]
    expect(visibleColumnKeys(spec("label", withLabels))).not.toContain("labels")
    expect(visibleColumnKeys(spec("none", withLabels))).toContain("labels")
  })

  it("the status column stays when not grouped by status", () => {
    for (const groupBy of ["none", "priority", "assignee", "project"] as const) {
      const keys = visibleColumnKeys(spec(groupBy))
      expect(keys).toContain("status")
      expect(keys).not.toContain("statusIcon")
    }
  })

  it("title is always shown, even when not listed", () => {
    expect(visibleColumnKeys(spec("none", []))).toEqual(["title"])
  })

  it("statusIcon in visibleProperties has no effect on its own", () => {
    expect(visibleColumnKeys(spec("none", ["statusIcon", "title"]))).toEqual(["title"])
  })

  it("no task ID unless the view turns it on", () => {
    expect(visibleColumnKeys(spec("status"))).not.toContain("id")
    expect(visibleColumnKeys(spec("none", ["id", "title"]))).toEqual(["id", "title"])
  })

  it("system views: Active by status, Backlog by project (no Client)", () => {
    const active = visibleColumnKeys(SYSTEM_VIEWS.tasks.active.spec)
    expect(active).toContain("statusIcon")
    expect(active).toContain("client")
    const backlog = visibleColumnKeys(SYSTEM_VIEWS.tasks.backlog.spec)
    expect(backlog).toContain("status")
    expect(backlog).not.toContain("client")
  })

  it("My Tasks Assigned hides the Assignee column (§11.2)", () => {
    expect(visibleColumnKeys(SYSTEM_VIEWS.myTasks.assigned.spec)).not.toContain("assignee")
  })
})

describe("grid template", () => {
  it("one track per visible column, in order", () => {
    expect(gridTemplateFor(["priority", "statusIcon", "title", "time"])).toBe("22px 18px minmax(250px,1fr) 76px")
  })

  it("min width = track minimums + 12px gaps + row padding", () => {
    // 22 + 250 + 76 = 348, 2 gaps = 24, padding 40 + 12
    expect(tableMinWidthFor(["priority", "title", "time"])).toBe(348 + 24 + 52)
  })
})

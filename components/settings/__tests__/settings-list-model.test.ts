import { describe, expect, it } from "vitest"
import { afterIdForMove, formatTaskUsage, groupByCategory, reorderAfter } from "../settings-list-model"

describe("groupByCategory", () => {
  it("returns every category in workflow order, rows kept in input order", () => {
    const rows = [
      { _id: "a", category: "started" as const },
      { _id: "b", category: "backlog" as const },
      { _id: "c", category: "started" as const },
    ]
    const groups = groupByCategory(rows)
    expect(groups.map((g) => g.category)).toEqual(["backlog", "unstarted", "started", "completed", "canceled"])
    expect(groups.map((g) => g.label)).toEqual(["Backlog", "Unstarted", "Started", "Completed", "Canceled"])
    expect(groups[0].rows.map((r) => r._id)).toEqual(["b"])
    expect(groups[1].rows).toEqual([])
    expect(groups[2].rows.map((r) => r._id)).toEqual(["a", "c"])
  })
})

describe("afterIdForMove", () => {
  const ids = ["a", "b", "c", "d"]

  it("moving down lands after the row now at the target index", () => {
    expect(afterIdForMove(ids, 0, 2)).toBe("c")
    expect(afterIdForMove(ids, 1, 3)).toBe("d")
  })

  it("moving up lands after the row before the target", () => {
    expect(afterIdForMove(ids, 3, 1)).toBe("a")
    expect(afterIdForMove(ids, 2, 1)).toBe("a")
  })

  it("moving to the top is null (first)", () => {
    expect(afterIdForMove(ids, 2, 0)).toBeNull()
  })

  it("no move or out of range is undefined", () => {
    expect(afterIdForMove(ids, 1, 1)).toBeUndefined()
    expect(afterIdForMove(ids, 5, 1)).toBeUndefined()
    expect(afterIdForMove(ids, 1, -1)).toBeUndefined()
  })

  it("agrees with reorderAfter", () => {
    for (let from = 0; from < ids.length; from++) {
      for (let to = 0; to < ids.length; to++) {
        const afterId = afterIdForMove(ids, from, to)
        if (afterId === undefined) continue
        const expected = ids.filter((_, i) => i !== from)
        expected.splice(to, 0, ids[from])
        const rows = ids.map((_id) => ({ _id }))
        expect(reorderAfter(rows, ids[from], afterId).map((r) => r._id)).toEqual(expected)
      }
    }
  })
})

describe("reorderAfter", () => {
  const rows = [
    { _id: "x1", group: "x" },
    { _id: "y1", group: "y" },
    { _id: "y2", group: "y" },
    { _id: "y3", group: "y" },
    { _id: "z1", group: "z" },
  ]

  it("null afterId moves to the first row of its scope", () => {
    const moved = rows.find((r) => r._id === "y3")!
    const result = reorderAfter(rows, "y3", null, (r) => r.group === moved.group)
    expect(result.map((r) => r._id)).toEqual(["x1", "y3", "y1", "y2", "z1"])
  })

  it("places the row right after afterId", () => {
    expect(reorderAfter(rows, "y1", "y3").map((r) => r._id)).toEqual(["x1", "y2", "y3", "y1", "z1"])
  })

  it("leaves the rows unchanged when a target is missing", () => {
    expect(reorderAfter(rows, "nope", null).map((r) => r._id)).toEqual(rows.map((r) => r._id))
    expect(reorderAfter(rows, "y1", "nope").map((r) => r._id)).toEqual(rows.map((r) => r._id))
    expect(reorderAfter(rows, "x1", null, (r) => r.group === "x").map((r) => r._id)).toEqual(rows.map((r) => r._id))
  })
})

describe("formatTaskUsage", () => {
  it("pluralizes and caps", () => {
    expect(formatTaskUsage(0, false)).toBe("0 tasks")
    expect(formatTaskUsage(1, false)).toBe("1 task")
    expect(formatTaskUsage(12, false)).toBe("12 tasks")
    expect(formatTaskUsage(99, true)).toBe("99+ tasks")
  })
})

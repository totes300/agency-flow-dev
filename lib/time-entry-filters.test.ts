import { describe, it, expect } from "vitest"
import { FilterOperator, type Filter } from "@/lib/filter-types"
import {
  applyTimeEntryFilters,
  parseTimeEntryFilters,
  serializeTimeEntryFilters,
  type FilterableTimeEntry,
} from "./time-entry-filters"

function filter(
  type: string,
  operator: FilterOperator,
  value: string[],
): Filter {
  return { id: `${type}-test`, type, operator, value }
}

// ─── Codec ───────────────────────────────────────────────────────────────────

describe("serialize/parse round-trip", () => {
  it("round-trips a multi-facet filter set", () => {
    const filters: Filter[] = [
      filter("member", FilterOperator.IS_ANY_OF, ["u1", "u2"]),
      filter("status", FilterOperator.IS_NOT, ["closed"]),
      filter("category", FilterOperator.IS, ["c1"]),
    ]
    const serialized = serializeTimeEntryFilters(filters)
    expect(serialized).toBe("member.any.u1,u2;status.not.closed;category.is.c1")
    const parsed = parseTimeEntryFilters(serialized!)
    expect(parsed.map((f) => [f.type, f.operator, f.value])).toEqual([
      ["member", FilterOperator.IS_ANY_OF, ["u1", "u2"]],
      ["status", FilterOperator.IS_NOT, ["closed"]],
      ["category", FilterOperator.IS, ["c1"]],
    ])
  })

  it("drops empty-value and unknown-facet filters on serialize", () => {
    const filters: Filter[] = [
      filter("member", FilterOperator.IS, []),
      filter("dueDate", FilterOperator.IS, ["2026-01-01"]),
    ]
    expect(serializeTimeEntryFilters(filters)).toBeUndefined()
  })

  it("parse skips malformed segments instead of throwing", () => {
    const parsed = parseTimeEntryFilters(
      "garbage;member.is;member.bogusop.u1;status.is.open",
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0].type).toBe("status")
    expect(parsed[0].value).toEqual(["open"])
  })

  it("parse of null/empty returns []", () => {
    expect(parseTimeEntryFilters(null)).toEqual([])
    expect(parseTimeEntryFilters("")).toEqual([])
  })

  it("parsed ids are deterministic across round-trips", () => {
    const a = parseTimeEntryFilters("member.is.u1;status.is.open")
    const b = parseTimeEntryFilters("member.is.u1;status.is.open")
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id))
  })
})

// ─── Apply ───────────────────────────────────────────────────────────────────

function entry(
  overrides: Partial<FilterableTimeEntry> & { userId: string },
): FilterableTimeEntry {
  return {
    isBillable: true,
    closeStatus: undefined,
    workCategoryId: undefined,
    ...overrides,
  }
}

const rows: FilterableTimeEntry[] = [
  // open, member u1, category c1
  entry({ userId: "u1", workCategoryId: "c1" }),
  // draft (close with a draft invoice), member u2, category c2
  entry({ userId: "u2", workCategoryId: "c2", closeStatus: "draft" }),
  // closed (final close), member u1, no category
  entry({ userId: "u1", closeStatus: "final" }),
  // non-billable, member u2, category c1
  entry({ userId: "u2", workCategoryId: "c1", isBillable: false }),
]

describe("applyTimeEntryFilters", () => {
  it("returns entries untouched with no active filters", () => {
    expect(applyTimeEntryFilters(rows, [])).toBe(rows)
    expect(
      applyTimeEntryFilters(rows, [filter("member", FilterOperator.IS, [])]),
    ).toBe(rows)
  })

  it("member include", () => {
    const out = applyTimeEntryFilters(rows, [
      filter("member", FilterOperator.IS, ["u1"]),
    ])
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.userId === "u1")).toBe(true)
  })

  it("member exclude", () => {
    const out = applyTimeEntryFilters(rows, [
      filter("member", FilterOperator.IS_NOT, ["u1"]),
    ])
    expect(out).toHaveLength(2)
    expect(out.every((e) => e.userId === "u2")).toBe(true)
  })

  it("status matches entryStatus vocabulary", () => {
    const open = applyTimeEntryFilters(rows, [
      filter("status", FilterOperator.IS, ["open"]),
    ])
    expect(open).toHaveLength(1)
    expect(open[0].userId).toBe("u1")

    const locked = applyTimeEntryFilters(rows, [
      filter("status", FilterOperator.IS_ANY_OF, ["draft", "closed"]),
    ])
    expect(locked).toHaveLength(2)

    const nonBillable = applyTimeEntryFilters(rows, [
      filter("status", FilterOperator.IS, ["non_billable"]),
    ])
    expect(nonBillable).toHaveLength(1)
    expect(nonBillable[0].isBillable).toBe(false)
  })

  it("category include misses entries without a category", () => {
    const out = applyTimeEntryFilters(rows, [
      filter("category", FilterOperator.IS, ["c1"]),
    ])
    expect(out).toHaveLength(2)
  })

  it("filters AND together across facets", () => {
    const out = applyTimeEntryFilters(rows, [
      filter("member", FilterOperator.IS, ["u2"]),
      filter("status", FilterOperator.IS, ["non_billable"]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].userId).toBe("u2")
    expect(out[0].isBillable).toBe(false)
  })
})

import { describe, it, expect } from "vitest"
import {
  startOfWeek,
  addDays,
  sameWeek,
  formatIsoWeek,
  parseIsoWeek,
  formatRange,
  buildMonthGrid,
  weekRange,
  formatYMD,
} from "./use-week-picker"

// ─── startOfWeek ───────────────────────────────────────────────────────────────

describe("startOfWeek", () => {
  it("returns the same Monday for any day in the week", () => {
    // 2026-04-21 is a Tuesday → Monday is 2026-04-20
    expect(formatYMD(startOfWeek(new Date(2026, 3, 21)))).toBe("2026-04-20")
    expect(formatYMD(startOfWeek(new Date(2026, 3, 26)))).toBe("2026-04-20")
    expect(formatYMD(startOfWeek(new Date(2026, 3, 20)))).toBe("2026-04-20")
  })

  it("treats Sunday as the last day of the previous week", () => {
    // 2026-04-26 is a Sunday → still in the week starting 2026-04-20
    expect(formatYMD(startOfWeek(new Date(2026, 3, 26)))).toBe("2026-04-20")
  })

  it("returns Monday across a US DST spring-forward boundary", () => {
    // 2026-03-08 (Sun) is DST start in the US. The week's Monday is 2026-03-02.
    expect(formatYMD(startOfWeek(new Date(2026, 2, 8)))).toBe("2026-03-02")
  })

  it("returns Monday across a US DST fall-back boundary", () => {
    // 2026-11-01 (Sun) is DST end. Week's Monday is 2026-10-26.
    expect(formatYMD(startOfWeek(new Date(2026, 9, 31)))).toBe("2026-10-26")
  })
})

// ─── ISO week roundtrip ────────────────────────────────────────────────────────

describe("formatIsoWeek / parseIsoWeek roundtrip", () => {
  it("formats a typical mid-year week", () => {
    expect(formatIsoWeek(new Date(2026, 3, 20))).toBe("2026-W17")
  })

  it("roundtrips on a typical week", () => {
    const monday = new Date(2026, 3, 20)
    const parsed = parseIsoWeek(formatIsoWeek(monday))
    expect(parsed).not.toBeNull()
    expect(formatYMD(parsed!)).toBe("2026-04-20")
  })

  it("handles 2025-W01 (year-boundary week starting Dec 30 2024)", () => {
    const parsed = parseIsoWeek("2025-W01")
    expect(parsed).not.toBeNull()
    expect(formatYMD(parsed!)).toBe("2024-12-30")
    expect(formatIsoWeek(parsed!)).toBe("2025-W01")
  })

  it("handles 2026-W53 — 2026 is an ISO long year (53 weeks)", () => {
    const parsed = parseIsoWeek("2026-W53")
    expect(parsed).not.toBeNull()
    expect(formatYMD(parsed!)).toBe("2026-12-28")
    expect(formatIsoWeek(parsed!)).toBe("2026-W53")
  })

  it("rejects 2025-W53 — 2025 only has 52 ISO weeks", () => {
    expect(parseIsoWeek("2025-W53")).toBeNull()
  })

  it("rejects malformed tokens", () => {
    expect(parseIsoWeek("2026-17")).toBeNull()
    expect(parseIsoWeek("2026-W7")).toBeNull()
    expect(parseIsoWeek("not-a-week")).toBeNull()
    expect(parseIsoWeek("2026-W00")).toBeNull()
    expect(parseIsoWeek("2026-W54")).toBeNull()
  })
})

// ─── sameWeek ──────────────────────────────────────────────────────────────────

describe("sameWeek", () => {
  it("returns true for two days in the same ISO week", () => {
    expect(sameWeek(new Date(2026, 3, 20), new Date(2026, 3, 24))).toBe(true)
  })

  it("returns false for adjacent weeks", () => {
    expect(sameWeek(new Date(2026, 3, 26), new Date(2026, 3, 27))).toBe(false)
  })

  it("returns true across timezone-shift hours within the same ISO week", () => {
    // Same calendar week, different hours (DST shift).
    const a = new Date(2026, 2, 9, 1) // Mon 1am DST
    const b = new Date(2026, 2, 13, 23) // Fri 11pm
    expect(sameWeek(a, b)).toBe(true)
  })

  it("treats year-boundary weeks correctly", () => {
    // 2024-12-30 (Mon) and 2025-01-01 (Wed) share ISO week 2025-W01.
    expect(sameWeek(new Date(2024, 11, 30), new Date(2025, 0, 1))).toBe(true)
  })
})

// ─── formatRange ───────────────────────────────────────────────────────────────

describe("formatRange", () => {
  it("formats a same-month range", () => {
    expect(
      formatRange(new Date(2026, 3, 20), new Date(2026, 3, 24)),
    ).toBe("Apr 20 – 24, 2026")
  })

  it("formats a cross-month range", () => {
    expect(
      formatRange(new Date(2026, 2, 30), new Date(2026, 3, 5)),
    ).toBe("Mar 30 – Apr 5, 2026")
  })

  it("formats a cross-year range", () => {
    expect(
      formatRange(new Date(2025, 11, 29), new Date(2026, 0, 4)),
    ).toBe("Dec 29, 2025 – Jan 4, 2026")
  })
})

// ─── buildMonthGrid ────────────────────────────────────────────────────────────

describe("buildMonthGrid", () => {
  it("returns 6 rows × 7 days = 42 cells", () => {
    const grid = buildMonthGrid(
      new Date(2026, 3, 1),
      startOfWeek(new Date(2026, 3, 20)),
      new Date(2026, 3, 22),
    )
    expect(grid.rows).toHaveLength(6)
    for (const row of grid.rows) {
      expect(row.cells).toHaveLength(7)
    }
  })

  it("includes prior-month overflow on the first row", () => {
    // April 2026 starts on a Wednesday (April 1) → grid first day is Mar 30.
    const grid = buildMonthGrid(
      new Date(2026, 3, 1),
      startOfWeek(new Date(2026, 3, 20)),
      new Date(2026, 3, 22),
    )
    const firstCell = grid.rows[0].cells[0]
    expect(firstCell.inMonth).toBe(false)
    expect(formatYMD(firstCell.date)).toBe("2026-03-30")
  })

  it("includes next-month overflow on the last row", () => {
    const grid = buildMonthGrid(
      new Date(2026, 3, 1),
      startOfWeek(new Date(2026, 3, 20)),
      new Date(2026, 3, 22),
    )
    const lastCell = grid.rows[5].cells[6]
    expect(lastCell.inMonth).toBe(false)
  })

  it("marks today and the selected week", () => {
    const today = new Date(2026, 3, 22)
    const grid = buildMonthGrid(
      new Date(2026, 3, 1),
      startOfWeek(today),
      today,
    )
    const allCells = grid.rows.flatMap((r) => r.cells)
    const todayCells = allCells.filter((c) => c.isToday)
    expect(todayCells).toHaveLength(1)
    expect(formatYMD(todayCells[0].date)).toBe("2026-04-22")

    const selectedRows = grid.rows.filter((r) => r.isSelectedWeek)
    expect(selectedRows).toHaveLength(1)
    expect(formatYMD(selectedRows[0].weekStart)).toBe("2026-04-20")
  })
})

// ─── weekRange / addDays ───────────────────────────────────────────────────────

describe("weekRange", () => {
  it("returns 5 days when weekend is hidden", () => {
    const r = weekRange(new Date(2026, 3, 20), false)
    expect(r.days).toEqual([
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
    ])
    expect(r.startDate).toBe("2026-04-20")
    expect(r.endDate).toBe("2026-04-24")
  })

  it("returns 7 days when weekend is included", () => {
    const r = weekRange(new Date(2026, 3, 20), true)
    expect(r.days).toHaveLength(7)
    expect(r.endDate).toBe("2026-04-26")
  })
})

describe("addDays", () => {
  it("crosses month boundaries", () => {
    expect(formatYMD(addDays(new Date(2026, 3, 30), 2))).toBe("2026-05-02")
  })
  it("crosses year boundaries", () => {
    expect(formatYMD(addDays(new Date(2025, 11, 31), 1))).toBe("2026-01-01")
  })
})

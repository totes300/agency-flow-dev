import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { anchorStartedAt, reanchorStartedAt, getYMDInTimezone } from "./workday"

// ─── anchorStartedAt ──────────────────────────────────────────────────────────

describe("anchorStartedAt", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("anchors to selected date at current HH:MM minus duration", () => {
    // 2026-04-26 10:00:00 local
    vi.setSystemTime(new Date(2026, 3, 26, 10, 0, 0, 0))
    const result = anchorStartedAt("2026-04-26", 60)
    // 10:00 - 60min = 09:00 of Apr 26
    const d = new Date(result)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)
    expect(d.getDate()).toBe(26)
    expect(d.getHours()).toBe(9)
    expect(d.getMinutes()).toBe(0)
  })

  it("clamps to midnight of selected date when duration would cross backward", () => {
    // 2026-04-26 00:10 local — logging 60min should NOT spill into Apr 25
    vi.setSystemTime(new Date(2026, 3, 26, 0, 10, 0, 0))
    const result = anchorStartedAt("2026-04-26", 60)
    const d = new Date(result)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)
    expect(d.getDate()).toBe(26)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
  })

  it("anchors to a past date keeping current HH:MM", () => {
    // Today is Apr 26 14:30, user logs for Apr 25
    vi.setSystemTime(new Date(2026, 3, 26, 14, 30, 0, 0))
    const result = anchorStartedAt("2026-04-25", 30)
    // anchor = Apr 25 14:30 - 30min = Apr 25 14:00
    const d = new Date(result)
    expect(d.getDate()).toBe(25)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(0)
  })

  it("falls back to now-duration on malformed selectedDate", () => {
    vi.setSystemTime(new Date(2026, 3, 26, 10, 0, 0, 0))
    const result = anchorStartedAt("not-a-date", 60)
    expect(result).toBe(new Date(2026, 3, 26, 10, 0, 0, 0).getTime() - 60 * 60_000)
  })
})

// ─── reanchorStartedAt ────────────────────────────────────────────────────────

describe("reanchorStartedAt", () => {
  it("preserves time-of-day across a date move", () => {
    // Original: Apr 25 14:30 local
    const original = new Date(2026, 3, 25, 14, 30, 0, 0).getTime()
    const moved = reanchorStartedAt(original, "2026-04-26")
    const d = new Date(moved)
    expect(d.getDate()).toBe(26)
    expect(d.getHours()).toBe(14)
    expect(d.getMinutes()).toBe(30)
  })

  it("returns input unchanged on malformed date", () => {
    const original = new Date(2026, 3, 25, 14, 30, 0, 0).getTime()
    expect(reanchorStartedAt(original, "garbage")).toBe(original)
  })

  it("handles cross-month moves", () => {
    const original = new Date(2026, 3, 30, 9, 0, 0, 0).getTime()
    const moved = reanchorStartedAt(original, "2026-05-01")
    const d = new Date(moved)
    expect(d.getMonth()).toBe(4)
    expect(d.getDate()).toBe(1)
    expect(d.getHours()).toBe(9)
  })
})

// ─── getYMDInTimezone ─────────────────────────────────────────────────────────

describe("getYMDInTimezone", () => {
  it("returns the date in the given timezone", () => {
    // 2026-04-26 04:00 UTC → 2026-04-26 in Europe/Budapest, 2026-04-25 in LA
    const ms = Date.UTC(2026, 3, 26, 4, 0, 0)
    expect(getYMDInTimezone(new Date(ms), "Europe/Budapest")).toBe("2026-04-26")
    expect(getYMDInTimezone(new Date(ms), "America/Los_Angeles")).toBe("2026-04-25")
  })

  it("handles UTC", () => {
    const ms = Date.UTC(2026, 3, 26, 12, 0, 0)
    expect(getYMDInTimezone(new Date(ms), "UTC")).toBe("2026-04-26")
  })
})

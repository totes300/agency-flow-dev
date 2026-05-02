import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  anchorStartedAt,
  reanchorStartedAt,
  getYMDInTimezone,
  tzWallToEpoch,
  getHMSInTimezone,
} from "./workday"

// ─── tzWallToEpoch ────────────────────────────────────────────────────────────

describe("tzWallToEpoch", () => {
  it("treats wall time as UTC when tz is UTC", () => {
    const ms = tzWallToEpoch(2026, 4, 26, 12, 0, 0, "UTC")
    expect(ms).toBe(Date.UTC(2026, 3, 26, 12, 0, 0))
  })

  it("anchors noon in NY to a moment whose date in NY is the input date", () => {
    const ms = tzWallToEpoch(2026, 5, 2, 12, 0, 0, "America/New_York")
    expect(getYMDInTimezone(new Date(ms), "America/New_York")).toBe("2026-05-02")
    expect(getHMSInTimezone(ms, "America/New_York").hour).toBe(12)
  })

  it("preserves the date in tz for sub-hour-offset zones (Asia/Kolkata UTC+5:30)", () => {
    const ms = tzWallToEpoch(2026, 5, 2, 14, 30, 0, "Asia/Kolkata")
    expect(getYMDInTimezone(new Date(ms), "Asia/Kolkata")).toBe("2026-05-02")
    expect(getHMSInTimezone(ms, "Asia/Kolkata").hour).toBe(14)
  })
})

// ─── anchorStartedAt ──────────────────────────────────────────────────────────

describe("anchorStartedAt", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("anchors at real now when selectedDate is today in org tz", () => {
    // 18:00 NY on 2026-05-02 = 22:00 UTC
    const nowMs = Date.UTC(2026, 4, 2, 22, 0, 0)
    vi.setSystemTime(new Date(nowMs))
    const ms = anchorStartedAt("2026-05-02", 60, "America/New_York")
    // "Just now" + 60min duration → started 17:00 NY today
    expect(getYMDInTimezone(new Date(ms), "America/New_York")).toBe("2026-05-02")
    expect(getHMSInTimezone(ms, "America/New_York").hour).toBe(17)
    expect(ms).toBe(nowMs - 60 * 60_000)
  })

  it("anchors at noon for past dates (no real moment to use)", () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 2, 22, 0, 0)))
    const ms = anchorStartedAt("2026-04-26", 60, "America/New_York")
    // 60min before noon NY = 11:00 NY, still on 2026-04-26 in NY
    expect(getYMDInTimezone(new Date(ms), "America/New_York")).toBe("2026-04-26")
    expect(getHMSInTimezone(ms, "America/New_York").hour).toBe(11)
  })

  it("clamps to midnight of selected date in tz when duration would overflow (past)", () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 2, 22, 0, 0)))
    const ms = anchorStartedAt("2026-04-26", 24 * 60 + 100, "America/New_York")
    expect(getYMDInTimezone(new Date(ms), "America/New_York")).toBe("2026-04-26")
    const hms = getHMSInTimezone(ms, "America/New_York")
    expect(hms.hour).toBe(0)
    expect(hms.minute).toBe(0)
  })

  it("clamps to midnight of selected date in tz when duration would overflow (today)", () => {
    // Today 06:00 NY, log 8h → naive: -2h yesterday, must clamp to midnight today.
    const sixAmNy = Date.UTC(2026, 4, 2, 10, 0, 0) // 06:00 NY EDT = 10:00 UTC
    vi.setSystemTime(new Date(sixAmNy))
    const ms = anchorStartedAt("2026-05-02", 8 * 60, "America/New_York")
    expect(getYMDInTimezone(new Date(ms), "America/New_York")).toBe("2026-05-02")
  })

  it("guarantees the server's date↔startedAt invariant regardless of UTC offset", () => {
    // 18:00 NY on 2026-05-02. Across this instant, the date varies by tz.
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 2, 22, 0, 0)))
    for (const tz of ["America/New_York", "Europe/Budapest", "Asia/Tokyo", "UTC"]) {
      for (const dur of [1, 60, 480, 720]) {
        const ms = anchorStartedAt("2026-05-02", dur, tz)
        expect(getYMDInTimezone(new Date(ms), tz)).toBe("2026-05-02")
      }
    }
  })

  it("falls back to now-duration on malformed selectedDate", () => {
    vi.useRealTimers()
    const before = Date.now()
    const result = anchorStartedAt("not-a-date", 60, "UTC")
    const after = Date.now()
    expect(result).toBeGreaterThanOrEqual(before - 60 * 60_000)
    expect(result).toBeLessThanOrEqual(after - 60 * 60_000)
  })
})

// ─── reanchorStartedAt ────────────────────────────────────────────────────────

describe("reanchorStartedAt", () => {
  it("preserves time-of-day in org tz across a date move", () => {
    const original = tzWallToEpoch(2026, 4, 25, 14, 30, 0, "America/New_York")
    const moved = reanchorStartedAt(original, "2026-04-26", "America/New_York")
    expect(getYMDInTimezone(new Date(moved), "America/New_York")).toBe("2026-04-26")
    const hms = getHMSInTimezone(moved, "America/New_York")
    expect(hms.hour).toBe(14)
    expect(hms.minute).toBe(30)
  })

  it("returns input unchanged on malformed date", () => {
    const original = Date.UTC(2026, 3, 25, 14, 30, 0)
    expect(reanchorStartedAt(original, "garbage", "UTC")).toBe(original)
  })

  it("handles cross-month moves", () => {
    const original = tzWallToEpoch(2026, 4, 30, 9, 0, 0, "Europe/Budapest")
    const moved = reanchorStartedAt(original, "2026-05-01", "Europe/Budapest")
    expect(getYMDInTimezone(new Date(moved), "Europe/Budapest")).toBe("2026-05-01")
    expect(getHMSInTimezone(moved, "Europe/Budapest").hour).toBe(9)
  })
})

// ─── getYMDInTimezone ─────────────────────────────────────────────────────────

describe("getYMDInTimezone", () => {
  it("returns the date in the given timezone", () => {
    const ms = Date.UTC(2026, 3, 26, 4, 0, 0)
    expect(getYMDInTimezone(new Date(ms), "Europe/Budapest")).toBe("2026-04-26")
    expect(getYMDInTimezone(new Date(ms), "America/Los_Angeles")).toBe("2026-04-25")
  })

  it("handles UTC", () => {
    const ms = Date.UTC(2026, 3, 26, 12, 0, 0)
    expect(getYMDInTimezone(new Date(ms), "UTC")).toBe("2026-04-26")
  })
})

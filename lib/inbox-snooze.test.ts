import { describe, expect, it } from "vitest"
import { computeSnoozePresets, zonedNineAmEpoch } from "./inbox-snooze"

const TZ = "Europe/Budapest"

describe("zonedNineAmEpoch", () => {
  it("converts 9 AM CEST (summer, UTC+2) correctly", () => {
    // 2026-07-02 09:00 Europe/Budapest = 07:00 UTC
    expect(zonedNineAmEpoch("2026-07-02", TZ)).toBe(Date.UTC(2026, 6, 2, 7, 0))
  })

  it("converts 9 AM CET (winter, UTC+1) correctly", () => {
    // 2026-01-15 09:00 Europe/Budapest = 08:00 UTC
    expect(zonedNineAmEpoch("2026-01-15", TZ)).toBe(Date.UTC(2026, 0, 15, 8, 0))
  })

  it("handles the spring-forward DST transition day (2026-03-29)", () => {
    // Clocks jump 02:00 → 03:00 that night; 09:00 is CEST (UTC+2) = 07:00 UTC
    expect(zonedNineAmEpoch("2026-03-29", TZ)).toBe(Date.UTC(2026, 2, 29, 7, 0))
  })

  it("handles the fall-back DST transition day (2026-10-25)", () => {
    // Clocks fall 03:00 → 02:00 that night; 09:00 is CET (UTC+1) = 08:00 UTC
    expect(zonedNineAmEpoch("2026-10-25", TZ)).toBe(Date.UTC(2026, 9, 25, 8, 0))
  })

  it("works in UTC", () => {
    expect(zonedNineAmEpoch("2026-07-02", "UTC")).toBe(Date.UTC(2026, 6, 2, 9, 0))
  })
})

describe("computeSnoozePresets", () => {
  // Wed 2026-07-01 12:00 Budapest (CEST) = 10:00 UTC
  const NOW = Date.UTC(2026, 6, 1, 10, 0)

  it("later today is now + 3h", () => {
    const [laterToday] = computeSnoozePresets(TZ, NOW)
    expect(laterToday.key).toBe("later_today")
    expect(laterToday.until).toBe(NOW + 3 * 60 * 60 * 1000)
  })

  it("tomorrow lands on the next calendar day at 9 AM org time", () => {
    const presets = computeSnoozePresets(TZ, NOW)
    const tomorrow = presets.find((p) => p.key === "tomorrow")!
    // 2026-07-02 09:00 CEST = 07:00 UTC
    expect(tomorrow.until).toBe(Date.UTC(2026, 6, 2, 7, 0))
  })

  it("next week lands on next Monday 9 AM org time", () => {
    const presets = computeSnoozePresets(TZ, NOW)
    const nextWeek = presets.find((p) => p.key === "next_week")!
    // Wed Jul 1 → this week's Monday is Jun 29 → next Monday is Jul 6
    expect(nextWeek.until).toBe(Date.UTC(2026, 6, 6, 7, 0))
  })

  it("late-evening 'tomorrow' still resolves via the org timezone, not UTC", () => {
    // 2026-07-01 23:30 Budapest = 21:30 UTC; UTC date is still Jul 1 but
    // Budapest date is Jul 1 too — now try 00:30 Budapest Jul 2 = 22:30 UTC Jul 1:
    // Budapest "today" = Jul 2, so tomorrow = Jul 3.
    const lateNow = Date.UTC(2026, 6, 1, 22, 30)
    const presets = computeSnoozePresets(TZ, lateNow)
    const tomorrow = presets.find((p) => p.key === "tomorrow")!
    expect(tomorrow.until).toBe(Date.UTC(2026, 6, 3, 7, 0))
  })

  it("snoozing across the fall-back weekend targets Monday at CET", () => {
    // Fri 2026-10-23 12:00 Budapest (CEST, UTC+2) = 10:00 UTC.
    // Next Monday is Oct 26 — AFTER the Oct 25 fall-back → 9 AM CET = 08:00 UTC.
    const friday = Date.UTC(2026, 9, 23, 10, 0)
    const presets = computeSnoozePresets(TZ, friday)
    const nextWeek = presets.find((p) => p.key === "next_week")!
    expect(nextWeek.until).toBe(Date.UTC(2026, 9, 26, 8, 0))
  })
})

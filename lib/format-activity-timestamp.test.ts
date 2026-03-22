import { describe, expect, it } from "vitest"
import { formatActivityTimestamp } from "./format"

// Fixed "now": 2026-03-19T14:30:00Z
const NOW = new Date("2026-03-19T14:30:00.000Z").getTime()

function minutesAgo(mins: number): number { return NOW - mins * 60000 }
function hoursAgo(hours: number): number { return NOW - hours * 3600000 }

describe("formatActivityTimestamp", () => {
  // ─── Just now / minutes ───────────────────────────────────────────────────

  it("returns 'Just now' for < 1 minute ago", () => {
    expect(formatActivityTimestamp(NOW - 30000, NOW)).toBe("Just now")
  })

  it("returns 'Just now' for exactly now", () => {
    expect(formatActivityTimestamp(NOW, NOW)).toBe("Just now")
  })

  it("returns '1 min' for exactly 1 minute ago", () => {
    expect(formatActivityTimestamp(minutesAgo(1), NOW)).toBe("1 min")
  })

  it("returns '5 mins' for 5 minutes ago", () => {
    expect(formatActivityTimestamp(minutesAgo(5), NOW)).toBe("5 mins")
  })

  it("returns '59 mins' for 59 minutes ago", () => {
    expect(formatActivityTimestamp(minutesAgo(59), NOW)).toBe("59 mins")
  })

  // ─── Today ────────────────────────────────────────────────────────────────

  it("returns 'Today at X:XX' for 2 hours ago", () => {
    const result = formatActivityTimestamp(hoursAgo(2), NOW)
    expect(result).toMatch(/^Today at \d{1,2}:\d{2}\s*(am|pm)$/i)
  })

  // ─── Yesterday ────────────────────────────────────────────────────────────

  it("returns 'Yesterday at X:XX' for yesterday", () => {
    const yesterday = new Date("2026-03-18T20:36:00.000Z").getTime()
    const result = formatActivityTimestamp(yesterday, NOW)
    expect(result).toMatch(/^Yesterday at \d{1,2}:\d{2}\s*(am|pm)$/i)
  })

  // ─── Older dates ──────────────────────────────────────────────────────────

  it("returns 'Mar 15 at X:XX' for older dates", () => {
    const older = new Date("2026-03-15T10:00:00.000Z").getTime()
    const result = formatActivityTimestamp(older, NOW)
    expect(result).toMatch(/^Mar 15 at \d{1,2}:\d{2}\s*(am|pm)$/i)
  })

  it("returns 'Dec 24 at X:XX' for much older dates", () => {
    const older = new Date("2025-12-24T18:58:00.000Z").getTime()
    const result = formatActivityTimestamp(older, NOW)
    expect(result).toMatch(/^Dec 24 at \d{1,2}:\d{2}\s*(am|pm)$/i)
  })
})

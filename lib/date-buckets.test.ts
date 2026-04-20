import { describe, it, expect } from "vitest"
import {
  bucketKey,
  bucketLabel,
  mondayOfWeek,
  resolveDateRangePreset,
  todayInTimezone,
} from "./date-buckets"

// ─── mondayOfWeek ────────────────────────────────────────────────────────────

describe("mondayOfWeek", () => {
  it("returns same date when already Monday", () => {
    // 2026-04-13 is a Monday
    expect(mondayOfWeek("2026-04-13")).toBe("2026-04-13")
  })
  it("returns the Monday for a Sunday in the same week", () => {
    // 2026-04-19 is a Sunday; Monday of that week is 2026-04-13
    expect(mondayOfWeek("2026-04-19")).toBe("2026-04-13")
  })
  it("handles year boundary (Dec 30 + Jan 3 same Monday key)", () => {
    // Jan 3, 2026 is a Saturday; Monday of that week is Dec 29, 2025
    expect(mondayOfWeek("2026-01-03")).toBe("2025-12-29")
    expect(mondayOfWeek("2025-12-30")).toBe("2025-12-29")
    expect(mondayOfWeek("2025-12-29")).toBe("2025-12-29")
  })
})

// ─── bucketKey ───────────────────────────────────────────────────────────────

describe("bucketKey — day", () => {
  it("returns the date itself", () => {
    expect(bucketKey("2026-04-06", "day")).toBe("2026-04-06")
  })
})

describe("bucketKey — week", () => {
  it("Mon and Sun of the same week share the key", () => {
    expect(bucketKey("2026-04-13", "week")).toBe("2026-04-13")
    expect(bucketKey("2026-04-19", "week")).toBe("2026-04-13")
  })
  it("spans year boundary deterministically", () => {
    // 2025-12-30 (Tue) and 2026-01-03 (Sat) are the same ISO week
    expect(bucketKey("2025-12-30", "week")).toBe("2025-12-29")
    expect(bucketKey("2026-01-03", "week")).toBe("2025-12-29")
  })
})

describe("bucketKey — month", () => {
  it("Dec 31 and Jan 1 live in different buckets", () => {
    expect(bucketKey("2026-12-31", "month")).toBe("2026-12")
    expect(bucketKey("2027-01-01", "month")).toBe("2027-01")
  })
})

// ─── bucketLabel ─────────────────────────────────────────────────────────────

describe("bucketLabel — day", () => {
  const tz = "UTC"
  const now = new Date("2026-04-19T12:00:00Z")

  it('labels today as "Today"', () => {
    expect(bucketLabel("2026-04-19", "day", tz, now)).toBe("Today")
  })
  it('labels yesterday as "Yesterday"', () => {
    expect(bucketLabel("2026-04-18", "day", tz, now)).toBe("Yesterday")
  })
  it("labels older dates with weekday + short date", () => {
    // 2026-04-06 is a Monday
    expect(bucketLabel("2026-04-06", "day", tz, now)).toBe("Mon, Apr 6, 2026")
  })
})

describe("bucketLabel — week", () => {
  it("formats same-month weeks", () => {
    // Monday 2026-04-13 → Sunday 2026-04-19
    expect(bucketLabel("2026-04-15", "week", "UTC")).toBe("Apr 13–19, 2026")
  })
  it("formats cross-month weeks", () => {
    // Monday 2026-04-27 → Sunday 2026-05-03
    expect(bucketLabel("2026-04-29", "week", "UTC")).toBe("Apr 27 – May 3, 2026")
  })
  it("formats cross-year weeks", () => {
    // Monday 2025-12-29 → Sunday 2026-01-04
    expect(bucketLabel("2025-12-31", "week", "UTC")).toBe(
      "Dec 29, 2025 – Jan 4, 2026",
    )
  })
})

describe("bucketLabel — month", () => {
  it("formats month + year", () => {
    expect(bucketLabel("2026-04-01", "month", "UTC")).toBe("April 2026")
  })
})

// ─── resolveDateRangePreset ─────────────────────────────────────────────────

describe("resolveDateRangePreset", () => {
  const tz = "UTC"

  it("returns null for all", () => {
    expect(resolveDateRangePreset("all", tz, new Date("2026-04-19T12:00Z"))).toBeNull()
  })

  it("returns null for custom", () => {
    expect(resolveDateRangePreset("custom", tz, new Date("2026-04-19T12:00Z"))).toBeNull()
  })

  it("this_week on a Sunday resolves to the Monday 6 days prior", () => {
    // 2026-04-19 is a Sunday
    const r = resolveDateRangePreset("this_week", tz, new Date("2026-04-19T12:00Z"))
    expect(r).toEqual({ from: "2026-04-13", to: "2026-04-19" })
  })

  it("this_week anchored on a Monday", () => {
    const r = resolveDateRangePreset("this_week", tz, new Date("2026-04-13T12:00Z"))
    expect(r).toEqual({ from: "2026-04-13", to: "2026-04-19" })
  })

  it("last_week goes to prior Monday–Sunday", () => {
    const r = resolveDateRangePreset("last_week", tz, new Date("2026-04-19T12:00Z"))
    expect(r).toEqual({ from: "2026-04-06", to: "2026-04-12" })
  })

  it("this_month returns first-to-last of current month", () => {
    const r = resolveDateRangePreset("this_month", tz, new Date("2026-04-19T12:00Z"))
    expect(r).toEqual({ from: "2026-04-01", to: "2026-04-30" })
  })

  it("last_month in January resolves to prior December", () => {
    const r = resolveDateRangePreset("last_month", tz, new Date("2026-01-15T12:00Z"))
    expect(r).toEqual({ from: "2025-12-01", to: "2025-12-31" })
  })

  it("this_year returns Jan 1 to Dec 31", () => {
    const r = resolveDateRangePreset("this_year", tz, new Date("2026-04-19T12:00Z"))
    expect(r).toEqual({ from: "2026-01-01", to: "2026-12-31" })
  })
})

describe("todayInTimezone", () => {
  it("returns date in target timezone, not local", () => {
    // 2026-04-19T23:30 UTC is still April 19 in UTC but April 20 in Tokyo
    const now = new Date("2026-04-19T23:30:00Z")
    expect(todayInTimezone("UTC", now)).toBe("2026-04-19")
    expect(todayInTimezone("Asia/Tokyo", now)).toBe("2026-04-20")
  })
})

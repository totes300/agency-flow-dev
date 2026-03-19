import { describe, expect, it } from "vitest"
import {
  getDayLabel,
  collapseConsecutive,
  groupActivityByDay,
  type RawEvent,
} from "./activity-grouping"

// ─── Helpers ────────────────────────────────────────────────────────────────────

// Fixed "now" for deterministic tests: 2026-03-19T12:00:00Z
const NOW = new Date("2026-03-19T12:00:00Z").getTime()
const TODAY_MORNING = new Date("2026-03-19T09:00:00Z").getTime()
const YESTERDAY = new Date("2026-03-18T15:00:00Z").getTime()
const TWO_DAYS_AGO = new Date("2026-03-17T10:00:00Z").getTime()
const LAST_WEEK = new Date("2026-03-12T10:00:00Z").getTime()

function event(id: string, type: string, createdAt: number, userName = "Adam"): RawEvent {
  return { id, type, userName, metadata: {}, createdAt }
}

// ─── getDayLabel ────────────────────────────────────────────────────────────────

describe("getDayLabel", () => {
  it("returns 'Today' for today's timestamp", () => {
    expect(getDayLabel(TODAY_MORNING, NOW)).toBe("Today")
  })

  it("returns 'Yesterday' for yesterday's timestamp", () => {
    expect(getDayLabel(YESTERDAY, NOW)).toBe("Yesterday")
  })

  it("returns formatted date for older timestamps", () => {
    const label = getDayLabel(TWO_DAYS_AGO, NOW)
    expect(label).toContain("Mar")
    expect(label).toContain("17")
  })

  it("returns formatted date for last week", () => {
    const label = getDayLabel(LAST_WEEK, NOW)
    expect(label).toContain("Mar")
    expect(label).toContain("12")
  })
})

// ─── collapseConsecutive ────────────────────────────────────────────────────────

describe("collapseConsecutive", () => {
  it("returns empty for empty input", () => {
    expect(collapseConsecutive([])).toEqual([])
  })

  it("returns single event as-is", () => {
    const events = [event("e1", "status_changed", 1000)]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("single")
  })

  it("does not collapse different consecutive types", () => {
    const events = [
      event("e1", "status_changed", 1000),
      event("e2", "category_changed", 2000),
      event("e3", "due_date_changed", 3000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(3)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })

  it("collapses 3 consecutive same-type events", () => {
    const events = [
      event("e1", "status_changed", 1000),
      event("e2", "status_changed", 2000),
      event("e3", "status_changed", 3000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe("collapsed")
    if (result[0].kind === "collapsed") {
      expect(result[0].latestEvent.id).toBe("e3") // last one shown
      expect(result[0].hiddenCount).toBe(2)
      expect(result[0].type).toBe("status_changed")
    }
  })

  it("collapses 2 consecutive same-type events", () => {
    const events = [
      event("e1", "status_changed", 1000),
      event("e2", "status_changed", 2000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(1)
    if (result[0].kind === "collapsed") {
      expect(result[0].hiddenCount).toBe(1)
    }
  })

  it("handles mixed: collapse in the middle", () => {
    const events = [
      event("e1", "category_changed", 1000),
      event("e2", "status_changed", 2000),
      event("e3", "status_changed", 3000),
      event("e4", "status_changed", 4000),
      event("e5", "due_date_changed", 5000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(3)
    expect(result[0].kind).toBe("single") // category
    expect(result[1].kind).toBe("collapsed") // 3x status
    expect(result[2].kind).toBe("single") // due date
    if (result[1].kind === "collapsed") {
      expect(result[1].hiddenCount).toBe(2)
      expect(result[1].latestEvent.id).toBe("e4")
    }
  })

  it("does NOT collapse non-consecutive same-type events", () => {
    const events = [
      event("e1", "status_changed", 1000),
      event("e2", "category_changed", 2000),
      event("e3", "status_changed", 3000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(3)
    expect(result.every((r) => r.kind === "single")).toBe(true)
  })

  it("handles multiple separate collapse groups", () => {
    const events = [
      event("e1", "status_changed", 1000),
      event("e2", "status_changed", 2000),
      event("e3", "category_changed", 3000),
      event("e4", "category_changed", 4000),
    ]
    const result = collapseConsecutive(events)
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe("collapsed")
    expect(result[1].kind).toBe("collapsed")
  })
})

// ─── groupActivityByDay ─────────────────────────────────────────────────────────

describe("groupActivityByDay", () => {
  it("returns empty for empty input", () => {
    expect(groupActivityByDay([], NOW)).toEqual([])
  })

  it("groups events into today", () => {
    const events = [
      event("e1", "status_changed", TODAY_MORNING),
      event("e2", "category_changed", TODAY_MORNING + 1000),
    ]
    const groups = groupActivityByDay(events, NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("Today")
    expect(groups[0].events).toHaveLength(2)
  })

  it("groups into today and yesterday", () => {
    const events = [
      event("e1", "status_changed", YESTERDAY),
      event("e2", "category_changed", TODAY_MORNING),
    ]
    const groups = groupActivityByDay(events, NOW)
    expect(groups).toHaveLength(2)
    // Newest day first
    expect(groups[0].label).toBe("Today")
    expect(groups[1].label).toBe("Yesterday")
  })

  it("newest day first, newest event first within day", () => {
    const events = [
      event("e1", "a", TODAY_MORNING),
      event("e2", "b", TODAY_MORNING + 60000),
      event("e3", "c", TODAY_MORNING + 120000),
    ]
    const groups = groupActivityByDay(events, NOW)
    expect(groups[0].label).toBe("Today")
    // Events within day are newest first
    const firstEvent = groups[0].events[0]
    expect(firstEvent.kind).toBe("single")
    if (firstEvent.kind === "single") {
      expect(firstEvent.event.id).toBe("e3") // newest
    }
  })

  it("collapses consecutive same-type within a day", () => {
    const events = [
      event("e1", "status_changed", TODAY_MORNING),
      event("e2", "status_changed", TODAY_MORNING + 1000),
      event("e3", "status_changed", TODAY_MORNING + 2000),
    ]
    const groups = groupActivityByDay(events, NOW)
    expect(groups).toHaveLength(1)
    // After reversing within day, these are still consecutive → collapsed
    expect(groups[0].events).toHaveLength(1)
    expect(groups[0].events[0].kind).toBe("collapsed")
  })

  it("groups across multiple days correctly", () => {
    const events = [
      event("e1", "a", LAST_WEEK),
      event("e2", "b", TWO_DAYS_AGO),
      event("e3", "c", YESTERDAY),
      event("e4", "d", TODAY_MORNING),
    ]
    const groups = groupActivityByDay(events, NOW)
    expect(groups).toHaveLength(4)
    expect(groups[0].label).toBe("Today")
    expect(groups[1].label).toBe("Yesterday")
    // The other two are older dates
  })
})

import { describe, it, expect } from "vitest"
import { groupTimeEntries, type GroupableEntry } from "./time-entry-grouping"

type Entry = GroupableEntry

function entry(p: Partial<Entry> & { _id: string; date: string }): Entry {
  return {
    userId: "u1",
    userName: "Alice",
    taskId: "t1",
    taskTitle: "Task A",
    durationMinutes: 60,
    ...p,
  }
}

function createdMap(ids: string[]): Map<string, number> {
  // Synthesize "earliest first" ordering so the highest id stands as newest.
  const m = new Map<string, number>()
  ids.forEach((id, i) => m.set(id, ids.length - i))
  return m
}

const TZ = "UTC"
const NOW = new Date("2026-04-19T12:00:00Z")

// ─── Day axis ────────────────────────────────────────────────────────────────

describe("groupTimeEntries — day axis", () => {
  it("groups same-day entries into one bucket, sums minutes", () => {
    const entries = [
      entry({ _id: "a", date: "2026-04-19", durationMinutes: 30 }),
      entry({ _id: "b", date: "2026-04-19", durationMinutes: 60 }),
    ]
    const groups = groupTimeEntries(entries, "day", TZ, createdMap(["a", "b"]), NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe("2026-04-19")
    expect(groups[0].label).toBe("Today")
    expect(groups[0].totalMinutes).toBe(90)
    expect(groups[0].icon).toBe("calendar")
  })

  it("sorts groups by date DESC", () => {
    const entries = [
      entry({ _id: "old", date: "2026-04-06" }),
      entry({ _id: "new", date: "2026-04-19" }),
    ]
    const groups = groupTimeEntries(entries, "day", TZ, createdMap(["old", "new"]), NOW)
    expect(groups.map((g) => g.key)).toEqual(["2026-04-19", "2026-04-06"])
  })

  it("within-group sort uses createdAt DESC as tiebreaker on same date", () => {
    const entries = [
      entry({ _id: "first", date: "2026-04-19" }),
      entry({ _id: "second", date: "2026-04-19" }),
    ]
    // "second" has higher createdAt because it comes later in the id list
    const map = new Map([
      ["first", 1],
      ["second", 2],
    ])
    const groups = groupTimeEntries(entries, "day", TZ, map, NOW)
    expect(groups[0].entries.map((e) => e._id)).toEqual(["second", "first"])
  })
})

// ─── Week axis ───────────────────────────────────────────────────────────────

describe("groupTimeEntries — week axis", () => {
  it("Mon and Sun of same week land in the same bucket", () => {
    const entries = [
      entry({ _id: "mon", date: "2026-04-13" }),
      entry({ _id: "sun", date: "2026-04-19" }),
    ]
    const groups = groupTimeEntries(entries, "week", TZ, createdMap(["mon", "sun"]), NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe("2026-04-13")
  })
})

// ─── Month axis ──────────────────────────────────────────────────────────────

describe("groupTimeEntries — month axis", () => {
  it("splits entries across month boundary into different buckets", () => {
    const entries = [
      entry({ _id: "dec", date: "2026-12-31" }),
      entry({ _id: "jan", date: "2027-01-01" }),
    ]
    const groups = groupTimeEntries(entries, "month", TZ, createdMap(["dec", "jan"]), NOW)
    expect(groups.map((g) => g.key)).toEqual(["2027-01", "2026-12"])
  })
})

// ─── Member axis ─────────────────────────────────────────────────────────────

describe("groupTimeEntries — member axis", () => {
  it("groups by userId, labels with userName, sorts alpha ASC", () => {
    const entries = [
      entry({ _id: "1", date: "2026-04-19", userId: "uB", userName: "Bob" }),
      entry({ _id: "2", date: "2026-04-19", userId: "uA", userName: "Alice" }),
      entry({ _id: "3", date: "2026-04-18", userId: "uA", userName: "Alice" }),
    ]
    const groups = groupTimeEntries(entries, "member", TZ, createdMap(["1", "2", "3"]), NOW)
    expect(groups.map((g) => g.label)).toEqual(["Alice", "Bob"])
    expect(groups[0].entries).toHaveLength(2)
    expect(groups[0].icon).toBeNull()
  })
})

// ─── Task axis ───────────────────────────────────────────────────────────────

describe("groupTimeEntries — task axis", () => {
  it("groups by taskId, labels with taskTitle, sorts alpha ASC", () => {
    const entries = [
      entry({ _id: "1", date: "2026-04-19", taskId: "t2", taskTitle: "Beta" }),
      entry({ _id: "2", date: "2026-04-19", taskId: "t1", taskTitle: "Alpha" }),
    ]
    const groups = groupTimeEntries(entries, "task", TZ, createdMap(["1", "2"]), NOW)
    expect(groups.map((g) => g.label)).toEqual(["Alpha", "Beta"])
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe("groupTimeEntries — edge cases", () => {
  it("returns empty array for empty input", () => {
    expect(groupTimeEntries([], "day", TZ, new Map(), NOW)).toEqual([])
  })

  it("missing createdAt falls back to 0 without crashing", () => {
    const entries = [
      entry({ _id: "x", date: "2026-04-19" }),
      entry({ _id: "y", date: "2026-04-19" }),
    ]
    // map intentionally missing both ids
    const groups = groupTimeEntries(entries, "day", TZ, new Map(), NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].entries).toHaveLength(2)
  })
})

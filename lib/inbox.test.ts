import { describe, expect, it } from "vitest"
import {
  groupInbox,
  typeClass,
  groupVerb,
  formatActorNames,
  type InboxRowBase,
  type NotificationType,
} from "./inbox"

const TZ = "Europe/Budapest"
// Wed 2026-07-01 12:00 Budapest (CEST) = 10:00 UTC
const NOW = Date.UTC(2026, 6, 1, 10, 0)

let seq = 0
function row(overrides: Partial<InboxRowBase> & { createdAt: number }): InboxRowBase {
  seq += 1
  return {
    _id: `n${seq}`,
    type: "comment",
    inboxState: "unread",
    previewText: "preview",
    taskId: "task1",
    taskTitle: "Task One",
    actorId: "actorA",
    actorName: "Anna",
    ...overrides,
  }
}

function grouped(rows: InboxRowBase[]) {
  // groupInbox expects rows desc by createdAt, like listInbox returns
  return groupInbox([...rows].sort((a, b) => b.createdAt - a.createdAt), TZ, NOW)
}

describe("typeClass", () => {
  it("collapses the comment family, keeps the rest", () => {
    const cases: Array<[NotificationType, string]> = [
      ["comment", "comment"],
      ["comment_reply", "comment"],
      ["mention_comment", "comment"],
      ["assigned", "assigned"],
      ["mention_description", "mention_description"],
    ]
    for (const [input, expected] of cases) {
      expect(typeClass(input)).toBe(expected)
    }
  })
})

describe("groupInbox — week sections", () => {
  it("labels current week 'This week' and previous 'Last week'", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000 }), // Wed this week
      row({ createdAt: Date.UTC(2026, 5, 26, 10, 0) }), // Fri Jun 26 = last week
    ])
    expect(sections.map((s) => s.label)).toEqual(["This week", "Last week"])
  })

  it("labels older weeks with the date-range style", () => {
    const sections = grouped([
      row({ createdAt: Date.UTC(2026, 5, 10, 10, 0) }), // Wed Jun 10
    ])
    expect(sections[0].label).toBe("Jun 8–14, 2026")
  })

  it("assigns week boundary rows by ORG timezone, not UTC", () => {
    // Sunday Jun 28 23:30 Budapest = 21:30 UTC Jun 28 (still last week in both)
    // Monday Jun 29 00:30 Budapest = 22:30 UTC Jun 28 — UTC says Sunday,
    // Budapest says Monday → must land in "This week"
    const sections = grouped([row({ createdAt: Date.UTC(2026, 5, 28, 22, 30) })])
    expect(sections[0].label).toBe("This week")
  })
})

describe("groupInbox — grouping", () => {
  it("groups same task + typeClass, splits different typeClasses", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000, type: "comment" }),
      row({ createdAt: NOW - 2000, type: "mention_comment" }),
      row({ createdAt: NOW - 3000, type: "assigned" }),
    ])
    expect(sections).toHaveLength(1)
    const keys = sections[0].groups.map((g) => g.key)
    expect(keys).toEqual(["task1:comment", "task1:assigned"])
    expect(sections[0].groups[0].memberIds).toHaveLength(2)
  })

  it("splits the same typeClass across different tasks", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000, taskId: "task1" }),
      row({ createdAt: NOW - 2000, taskId: "task2", taskTitle: "Task Two" }),
    ])
    expect(sections[0].groups.map((g) => g.taskId)).toEqual(["task1", "task2"])
  })

  it("latest row wins (preview/type), actors stack unique in recency order", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000, actorId: "a2", actorName: "Bela", previewText: "newest" }),
      row({ createdAt: NOW - 2000, actorId: "a1", actorName: "Anna" }),
      row({ createdAt: NOW - 3000, actorId: "a2", actorName: "Bela" }),
    ])
    const g = sections[0].groups[0]
    expect(g.latest.previewText).toBe("newest")
    expect(g.actors.map((a) => a.actorName)).toEqual(["Bela", "Anna"])
  })

  it("aggregates unread: any unread member marks the group unread", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000, inboxState: "read" }),
      row({ createdAt: NOW - 2000, inboxState: "unread" }),
    ])
    const g = sections[0].groups[0]
    expect(g.unread).toBe(true)
    expect(g.unreadMemberIds).toHaveLength(1)
    expect(g.memberIds).toHaveLength(2)
  })

  it("an all-read group is not unread", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000, inboxState: "read" }),
      row({ createdAt: NOW - 2000, inboxState: "read" }),
    ])
    expect(sections[0].groups[0].unread).toBe(false)
  })

  it("same task in two different weeks produces two groups", () => {
    const sections = grouped([
      row({ createdAt: NOW - 1000 }),
      row({ createdAt: Date.UTC(2026, 5, 26, 10, 0) }),
    ])
    expect(sections).toHaveLength(2)
    expect(sections[0].groups).toHaveLength(1)
    expect(sections[1].groups).toHaveLength(1)
  })
})

describe("groupVerb", () => {
  it("uses the latest row's type within the comment class", () => {
    const mk = (type: NotificationType) =>
      grouped([row({ createdAt: NOW - 1000, type })])[0].groups[0]
    expect(groupVerb(mk("comment"))).toBe("commented in")
    expect(groupVerb(mk("comment_reply"))).toBe("replied to your comment in")
    expect(groupVerb(mk("mention_comment"))).toBe("mentioned you in")
    expect(groupVerb(mk("assigned"))).toBe("assigned you to")
    expect(groupVerb(mk("mention_description"))).toBe("mentioned you in")
  })
})

describe("formatActorNames", () => {
  const actor = (name: string) => ({ actorId: name, actorName: name })

  it("formats 1, 2, and many actors", () => {
    expect(formatActorNames([actor("Maddie")])).toBe("Maddie")
    expect(formatActorNames([actor("Maddie"), actor("Frances")])).toBe("Maddie, Frances")
    expect(
      formatActorNames([actor("Maddie"), actor("Frances"), actor("Anna")]),
    ).toBe("Maddie, Frances and 1 other")
    expect(
      formatActorNames([actor("Maddie"), actor("Frances"), actor("Anna"), actor("Bela")]),
    ).toBe("Maddie, Frances and 2 others")
  })
})

/**
 * Pure inbox grouping — server stays one-row-per-event, grouping is
 * presentation (≤200 rows, already in memory).
 *
 * Sections: ISO week of createdAt in the ORG timezone ("This week",
 * "Last week", then "Apr 13–19, 2026" style). Within a section, rows
 * collapse by (taskId, typeClass) into one group row.
 */

import {
  bucketKey,
  bucketLabel,
  mondayOfWeek,
  todayInTimezone,
} from "@/lib/date-buckets"

export type NotificationType =
  | "mention_comment"
  | "mention_description"
  | "assigned"
  | "comment"
  | "comment_reply"

/** Grouping class: the three comment-family types collapse into "comment". */
export type TypeClass = "comment" | "assigned" | "mention_description"

export function typeClass(type: NotificationType): TypeClass {
  switch (type) {
    case "comment":
    case "comment_reply":
    case "mention_comment":
      return "comment"
    case "assigned":
      return "assigned"
    case "mention_description":
      return "mention_description"
  }
}

/** Structural minimum groupInbox needs — the enriched query row satisfies it. */
export type InboxRowBase = {
  _id: string
  type: NotificationType
  inboxState: "unread" | "read" | "archived" | "snoozed"
  createdAt: number
  previewText: string
  taskId: string
  commentId?: string | null
  taskTitle: string
  actorId: string
  actorName: string
  actorImageUrl?: string | null
}

export type InboxActor = {
  actorId: string
  actorName: string
  actorImageUrl?: string | null
}

export type InboxGroup<R extends InboxRowBase> = {
  key: string // `${taskId}:${typeClass}` — unique within a section
  taskId: R["taskId"]
  taskTitle: string
  typeClass: TypeClass
  /** The newest row — drives sentence type, preview, timestamp, deep-link. */
  latest: R
  /** Unique actors in recency order (stacked avatars: max 3 + "+N"). */
  actors: InboxActor[]
  unread: boolean
  /** All member row ids — group actions apply mutations to all of them. */
  memberIds: R["_id"][]
  unreadMemberIds: R["_id"][]
}

export type WeekSection<R extends InboxRowBase> = {
  key: string // Monday-of-week YYYY-MM-DD
  label: string
  groups: InboxGroup<R>[]
}

/**
 * Group rows (already sorted desc by createdAt) into week sections of
 * (taskId, typeClass) groups. `now` is injected for testability.
 */
export function groupInbox<R extends InboxRowBase>(
  rows: R[],
  timezone: string,
  now: number,
): WeekSection<R>[] {
  const today = todayInTimezone(timezone, new Date(now))
  const thisMonday = mondayOfWeek(today)
  const lastMonday = mondayOfWeek(addDaysYmd(thisMonday, -7))

  const sections: WeekSection<R>[] = []
  const sectionByKey = new Map<string, WeekSection<R>>()
  const groupByKey = new Map<string, InboxGroup<R>>()

  for (const row of rows) {
    const day = todayInTimezone(timezone, new Date(row.createdAt))
    const weekKey = bucketKey(day, "week")

    let section = sectionByKey.get(weekKey)
    if (!section) {
      section = {
        key: weekKey,
        label:
          weekKey === thisMonday
            ? "This week"
            : weekKey === lastMonday
              ? "Last week"
              : bucketLabel(weekKey, "week", timezone),
        groups: [],
      }
      sectionByKey.set(weekKey, section)
      sections.push(section)
    }

    const groupKey = `${weekKey}:${row.taskId}:${typeClass(row.type)}`
    let group = groupByKey.get(groupKey)
    if (!group) {
      group = {
        key: `${row.taskId}:${typeClass(row.type)}`,
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        typeClass: typeClass(row.type),
        latest: row, // rows arrive desc — first seen is the newest
        actors: [],
        unread: false,
        memberIds: [],
        unreadMemberIds: [],
      }
      groupByKey.set(groupKey, group)
      section.groups.push(group)
    }

    group.memberIds.push(row._id)
    if (row.inboxState === "unread") {
      group.unread = true
      group.unreadMemberIds.push(row._id)
    }
    if (!group.actors.some((a) => a.actorId === row.actorId)) {
      group.actors.push({
        actorId: row.actorId,
        actorName: row.actorName,
        actorImageUrl: row.actorImageUrl,
      })
    }
  }

  return sections
}

/**
 * Row sentence: verb phrase between the actor names and the task title.
 * The comment class narrows by the group's LATEST row type.
 */
export function groupVerb<R extends InboxRowBase>(group: InboxGroup<R>): string {
  switch (group.typeClass) {
    case "assigned":
      return "assigned you to"
    case "mention_description":
      return "mentioned you in"
    case "comment":
      switch (group.latest.type) {
        case "mention_comment":
          return "mentioned you in"
        case "comment_reply":
          return "replied to your comment in"
        default:
          return "commented in"
      }
  }
}

/** "Maddie" / "Maddie, Frances" / "Maddie, Frances and 2 others". */
export function formatActorNames(actors: InboxActor[]): string {
  const names = actors.map((a) => a.actorName)
  if (names.length <= 2) return names.join(", ")
  return `${names[0]}, ${names[1]} and ${names.length - 2} ${
    names.length - 2 === 1 ? "other" : "others"
  }`
}

function addDaysYmd(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

import { bucketKey, bucketLabel } from "@/lib/date-buckets"
import type { DateGrouping } from "@/lib/date-buckets"

/** Minimal shape a time entry must satisfy to be groupable. */
export type GroupableEntry = {
  _id: string
  userId: string
  userName: string
  taskId: string
  taskTitle: string
  date: string
  durationMinutes: number
}

export type TimeEntryGroupAxis = DateGrouping | "member" | "task"

export type TimeEntryGroup<T extends GroupableEntry> = {
  /** Stable key unique to the axis value (date string, userId, or taskId). */
  key: string
  /** Human-readable header label ("Today", "Apr 13–19, 2026", member/task name). */
  label: string
  /** `calendar` for date groupings; `null` for member/task (no icon). */
  icon: "calendar" | null
  entries: T[]
  totalMinutes: number
}

function isDateGrouping(g: TimeEntryGroupAxis): g is DateGrouping {
  return g === "day" || g === "week" || g === "month"
}

/**
 * Pure grouping helper for project-time entries.
 *
 * - Date axes (day/week/month) key by `bucketKey` and label via `bucketLabel`.
 * - `member`/`task` axes key by userId / taskId; label is the user name or task title.
 * - Within-group sort: `date` DESC, then `createdAtMap` DESC (matches the flat
 *   sort order the server returns so grouped and flat views agree).
 * - Between-group sort: date axes sort DESC by bucket key; member/task axes
 *   sort alpha ASC by label.
 *
 * `createdAtMap` is a stable-ordering tiebreaker the caller supplies (since
 * the row type may or may not carry `createdAt`). If an entry isn't in the
 * map, it falls back to 0 — fine for pre-sorted inputs.
 */
export function groupTimeEntries<T extends GroupableEntry>(
  entries: T[],
  grouping: TimeEntryGroupAxis,
  orgTimezone: string,
  createdAtMap: Map<string, number>,
  now?: Date,
): TimeEntryGroup<T>[] {
  const buckets = new Map<string, { label: string; entries: T[] }>()

  for (const e of entries) {
    let key: string
    let label: string
    if (isDateGrouping(grouping)) {
      key = bucketKey(e.date, grouping)
      label = bucketLabel(e.date, grouping, orgTimezone, now)
    } else if (grouping === "member") {
      key = e.userId
      label = e.userName
    } else {
      key = e.taskId
      label = e.taskTitle
    }
    const existing = buckets.get(key)
    if (existing) existing.entries.push(e)
    else buckets.set(key, { label, entries: [e] })
  }

  const groups: TimeEntryGroup<T>[] = []
  for (const [key, { label, entries: bucket }] of buckets.entries()) {
    const sorted = [...bucket].sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      const aCreated = createdAtMap.get(a._id) ?? 0
      const bCreated = createdAtMap.get(b._id) ?? 0
      return bCreated - aCreated
    })
    const totalMinutes = sorted.reduce((sum, e) => sum + e.durationMinutes, 0)
    groups.push({
      key,
      label,
      icon: isDateGrouping(grouping) ? "calendar" : null,
      entries: sorted,
      totalMinutes,
    })
  }

  groups.sort((a, b) => {
    if (isDateGrouping(grouping)) return b.key.localeCompare(a.key)
    return a.label.localeCompare(b.label)
  })

  return groups
}

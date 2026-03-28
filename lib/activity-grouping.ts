/**
 * Pure functions for grouping and collapsing activity events.
 */

import { isSameDay } from "@/lib/format"
import type { FeedItem, ActivityEvent, CommentEvent } from "@/lib/task-detail"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type RawEvent = {
  id: string
  type: string
  userName: string
  metadata: Record<string, unknown>
  createdAt: number
}

export type DisplayEvent =
  | { kind: "single"; event: RawEvent }
  | { kind: "collapsed"; latestEvent: RawEvent; hiddenCount: number; type: string }

export type DayGroup = {
  label: string   // "Today", "Yesterday", "Mar 15"
  events: DisplayEvent[]
}

// ─── Day label ──────────────────────────────────────────────────────────────────

/**
 * Get a human-readable day label for a timestamp.
 * Returns "Today", "Yesterday", or "Mon, Mar 15".
 */
export function getDayLabel(timestamp: number, now: number = Date.now()): string {
  const eventDate = new Date(timestamp)
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)

  if (isSameDay(eventDate, today)) return "Today"
  if (isSameDay(eventDate, yesterday)) return "Yesterday"

  return eventDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

// ─── Collapse consecutive same-type events ──────────────────────────────────────

/**
 * Collapse consecutive events of the same type into a single "collapsed" entry.
 * Only the latest (last) event in the run is shown, with a count of hidden ones.
 * Non-consecutive duplicates are NOT collapsed.
 *
 * Example: [status, status, status, assign, status]
 * → [collapsed(status, hidden=2), single(assign), single(status)]
 */
export function collapseConsecutive(events: RawEvent[]): DisplayEvent[] {
  if (events.length === 0) return []

  const result: DisplayEvent[] = []
  let runStart = 0

  for (let i = 1; i <= events.length; i++) {
    const current = events[i]
    const prev = events[i - 1]

    // Continue the run if same type
    if (current && current.type === prev.type) continue

    // End of run — emit
    const runLength = i - runStart
    if (runLength === 1) {
      result.push({ kind: "single", event: events[runStart] })
    } else {
      // Show the LAST event in the run (most recent), hide the rest
      result.push({
        kind: "collapsed",
        latestEvent: events[i - 1],
        hiddenCount: runLength - 1,
        type: events[runStart].type,
      })
    }
    runStart = i
  }

  return result
}

// ─── Group by day ───────────────────────────────────────────────────────────────

/**
 * Group events by day, then collapse consecutive same-type events within each day.
 * Input must be sorted by createdAt ascending.
 * Output groups are ordered newest-day-first, events within each day newest-first.
 */
export function groupActivityByDay(events: RawEvent[], now?: number): DayGroup[] {
  if (events.length === 0) return []

  const currentTime = now ?? Date.now()

  // Group events by day label
  const dayMap = new Map<string, RawEvent[]>()
  const dayOrder: string[] = []

  for (const event of events) {
    const label = getDayLabel(event.createdAt, currentTime)
    if (!dayMap.has(label)) {
      dayMap.set(label, [])
      dayOrder.push(label)
    }
    dayMap.get(label)!.push(event)
  }

  // Reverse: newest day first, events within day newest first
  return dayOrder.reverse().map((label) => {
    const dayEvents = dayMap.get(label)!.reverse() // newest first within day
    return {
      label,
      events: collapseConsecutive(dayEvents),
    }
  })
}

// ─── Comments-first feed grouping ────────────────────────────────────────────

export type AuditBatch = {
  kind: "batch"
  id: string           // first audit item's id (React key)
  items: ActivityEvent[]
  count: number
  startTime: number    // first item's createdAt
  endTime: number      // last item's createdAt
}

export type GroupedFeedItem = CommentEvent | AuditBatch

/**
 * Group a merged feed for comments-first display.
 * Consecutive audit events between comments become a single collapsible AuditBatch.
 * Comments pass through unchanged.
 *
 * Input must be sorted by createdAt ascending (as returned by mergeActivityFeed).
 */
// ─── Message grouping for Slack-style display ───────────────────────────────

/** Threshold for grouping consecutive messages from the same user (5 minutes). */
const GROUP_THRESHOLD_MS = 5 * 60 * 1000

/**
 * Determine whether a comment should display in "grouped" (compact) mode.
 * A comment is grouped if the previous feed item is also a comment from the
 * same user, posted within GROUP_THRESHOLD_MS.
 *
 * Returns a Map<commentId, boolean> for O(1) lookups during render.
 */
export function computeMessageGrouping(feed: FeedItem[]): Map<string, boolean> {
  const result = new Map<string, boolean>()

  let prevComment: (FeedItem & { kind: "comment" }) | null = null

  for (const item of feed) {
    if (item.kind !== "comment") {
      // Audit events break the grouping chain
      prevComment = null
      continue
    }

    const isGrouped =
      prevComment !== null &&
      prevComment.userId === item.userId &&
      item.createdAt - prevComment.createdAt < GROUP_THRESHOLD_MS

    result.set(item.id, isGrouped)
    prevComment = item as FeedItem & { kind: "comment" }
  }

  return result
}

/**
 * Compute day boundaries for the feed.
 * Returns a Set of feed item IDs that should have a day divider rendered BEFORE them.
 * Also returns the label for each divider.
 */
export function computeDayDividers(
  feed: FeedItem[],
  now?: number,
): Map<string, string> {
  const result = new Map<string, string>()
  if (feed.length === 0) return result

  let lastDayLabel = ""

  for (const item of feed) {
    const dayLabel = getDayLabel(item.createdAt, now)
    if (dayLabel !== lastDayLabel) {
      result.set(item.id, dayLabel)
      lastDayLabel = dayLabel
    }
  }

  return result
}

export function groupFeedForCommentsView(feed: FeedItem[]): GroupedFeedItem[] {
  if (feed.length === 0) return []

  const result: GroupedFeedItem[] = []
  let auditBuffer: ActivityEvent[] = []

  function flushBuffer() {
    if (auditBuffer.length === 0) return
    result.push({
      kind: "batch",
      id: auditBuffer[0].id,
      items: auditBuffer,
      count: auditBuffer.length,
      startTime: auditBuffer[0].createdAt,
      endTime: auditBuffer[auditBuffer.length - 1].createdAt,
    })
    auditBuffer = []
  }

  for (const item of feed) {
    if (item.kind === "audit") {
      auditBuffer.push(item)
    } else {
      flushBuffer()
      result.push(item)
    }
  }

  flushBuffer()
  return result
}

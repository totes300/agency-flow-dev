/**
 * Pure functions for grouping and collapsing activity events.
 */

import { isSameDay } from "@/lib/format"

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

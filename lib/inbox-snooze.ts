/**
 * Pure snooze-preset computation for the inbox panel.
 *
 * "Tomorrow" / "Next week" resolve a target YYYY-MM-DD in the ORG timezone
 * (day arithmetic on date strings, DST-safe), then convert wall-clock 9:00
 * in that zone to an epoch via the guess-and-correct Intl technique.
 */

import { todayInTimezone, mondayOfWeek } from "@/lib/date-buckets"

export type SnoozePreset = {
  key: "later_today" | "tomorrow" | "next_week"
  label: string
  until: number // epoch ms
}

const SNOOZE_HOUR = 9 // 9:00 AM org time
const LATER_TODAY_MS = 3 * 60 * 60 * 1000

function parseYmd(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}

/** Add days to a YYYY-MM-DD string via UTC arithmetic (never wall-clock). */
function addDays(date: string, days: number): string {
  const { y, m, d } = parseYmd(date)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Read a UTC epoch back as wall-clock parts in `timezone`. */
function wallClockInZone(
  epoch: number,
  timezone: string,
): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(epoch))
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0")
  // Intl renders midnight as "24" with hour12:false in some engines — normalize
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") }
}

/**
 * Epoch for wall-clock `hour`:00 on `date` (YYYY-MM-DD) in `timezone`.
 * Guess the UTC epoch, format it back in the zone, correct by the diff —
 * two passes so DST transitions land exactly. For a nonexistent wall-clock
 * time (spring-forward gap) this settles on the closest valid instant.
 */
export function zonedNineAmEpoch(
  date: string,
  timezone: string,
  hour: number = SNOOZE_HOUR,
): number {
  const { y, m, d } = parseYmd(date)
  const desired = Date.UTC(y, m - 1, d, hour, 0)
  let guess = desired
  for (let i = 0; i < 2; i++) {
    const wall = wallClockInZone(guess, timezone)
    const actual = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.min)
    guess += desired - actual
  }
  return guess
}

/**
 * The three snooze presets, computed against `now` (epoch ms) in the org
 * timezone. Deterministic for testing — callers pass `Date.now()`.
 */
export function computeSnoozePresets(timezone: string, now: number): SnoozePreset[] {
  const today = todayInTimezone(timezone, new Date(now))
  const tomorrow = addDays(today, 1)
  const nextMonday = addDays(mondayOfWeek(today), 7)

  return [
    { key: "later_today", label: "Later today", until: now + LATER_TODAY_MS },
    { key: "tomorrow", label: "Tomorrow, 9 AM", until: zonedNineAmEpoch(tomorrow, timezone) },
    { key: "next_week", label: "Next week, Mon 9 AM", until: zonedNineAmEpoch(nextMonday, timezone) },
  ]
}

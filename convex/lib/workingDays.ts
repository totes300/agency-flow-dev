/**
 * Working-day arithmetic in the org's timezone (docs/prd-email-triage.md §6.1
 * default due date, D37 working-hour clocks). Pure — no Convex, no Date.now().
 * The client helper `lib/planner.ts` stays client-only; this is the server's.
 *
 * Rules (V1):
 *   - A working day is a local Monday–Friday. No holidays.
 *   - A working day holds 24 working hours ("Client waiting 24 h" means one
 *     working day of elapsed time): a Friday 16:00 email is flagged Monday
 *     16:00 (D37).
 *   - Hours are counted on the LOCAL WALL CLOCK of each weekday, so a DST
 *     shift never adds or removes a working hour: Friday 16:00 + 24 working
 *     hours is Monday 16:00 local, whichever offset Monday has.
 */

import { getDateInTimezone } from "./timer";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** §6.1: arrival + this many working days when the email names no date. */
export const DEFAULT_DUE_WORKING_DAYS = 2;

// ─── Calendar dates (YYYY-MM-DD, timezone-free) ─────────────────────────────

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Expected YYYY-MM-DD, got "${date}"`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Calendar arithmetic on a YYYY-MM-DD string (month / year ends roll over). */
export function addCalendarDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  return formatUtcDate(Date.UTC(y, m - 1, d + days));
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isWorkingDate(date: string): boolean {
  const day = weekdayOf(date);
  return day !== 0 && day !== 6;
}

/** The local calendar date of an instant in `tz` (reuses convex/lib/timer.ts). */
export function localDateOf(instantMs: number, tz: string): string {
  return getDateInTimezone(instantMs, tz);
}

// ─── Wall clock ↔ instant ───────────────────────────────────────────────────

/**
 * The instant's local wall-clock time in `tz`, expressed as a UTC timestamp
 * ("wall ms"). On the wall timeline every day is exactly 24 h long, which is
 * what working-hour arithmetic counts.
 */
function toWallMs(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);
  const wallSeconds = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  // Intl drops milliseconds; keep them so the round trip is exact.
  return wallSeconds + (((instantMs % 1000) + 1000) % 1000);
}

/**
 * The instant at which `tz`'s wall clock shows `wallMs`. A wall time inside a
 * spring-forward gap resolves to the instant just after the gap; one inside a
 * fall-back overlap resolves to its first occurrence.
 */
function fromWallMs(wallMs: number, tz: string): number {
  const offsetAt = (instant: number) => toWallMs(instant, tz) - instant;
  // The offsets a day either side bracket any DST edge near this wall time.
  const candidates = [
    wallMs - offsetAt(wallMs - DAY_MS),
    wallMs - offsetAt(wallMs + DAY_MS),
  ];
  const exact = candidates.filter((c) => toWallMs(c, tz) === wallMs);
  // Overlap: both map back → the earlier one. Normal: one value. Gap: none
  // maps back → the later candidate (the wall time shifted past the gap).
  return exact.length > 0 ? Math.min(...exact) : Math.max(...candidates);
}

/** The instant of a local date + time in `tz` (e.g. "Snooze until Monday 9:00"). */
export function zonedDateTimeToInstant(
  date: string,
  hour: number,
  minute: number,
  tz: string,
): number {
  const { y, m, d } = parseDate(date);
  return fromWallMs(Date.UTC(y, m - 1, d, hour, minute), tz);
}

function isWorkingWallDay(dayIndex: number): boolean {
  const day = new Date(dayIndex * DAY_MS).getUTCDay();
  return day !== 0 && day !== 6;
}

// ─── Working days ───────────────────────────────────────────────────────────

/**
 * The local date `n` working days after the instant's local date (§6.1):
 * Friday 15:00 + 2 → Tuesday. Weekend days are skipped while counting, so an
 * email received on Saturday + 2 → Tuesday (Monday is the first). `n = 0`
 * is the instant's own local date ("today" — urgent emails), even on a
 * weekend. Negative `n` counts backwards the same way.
 */
export function addWorkingDays(instantMs: number, n: number, tz: string): string {
  if (!Number.isInteger(n)) throw new Error(`Working days must be an integer, got ${n}`);
  let date = localDateOf(instantMs, tz);
  const step = n >= 0 ? 1 : -1;
  for (let remaining = Math.abs(n); remaining > 0; ) {
    date = addCalendarDays(date, step);
    if (isWorkingDate(date)) remaining -= 1;
  }
  return date;
}

// ─── Working hours ──────────────────────────────────────────────────────────

/**
 * Working hours elapsed from `aMs` to `bMs` (D37): the local wall-clock time
 * that falls on weekdays, 24 h per weekday. Friday 16:00 → Monday 16:00 = 24.
 * 0 when `bMs <= aMs`.
 */
export function workingHoursBetween(aMs: number, bMs: number, tz: string): number {
  if (bMs <= aMs) return 0;
  const wa = toWallMs(aMs, tz);
  const wb = toWallMs(bMs, tz);
  if (wb <= wa) return 0; // inside a fall-back overlap
  let total = 0;
  const firstDay = Math.floor(wa / DAY_MS);
  const lastDay = Math.floor(wb / DAY_MS);
  for (let day = firstDay; day <= lastDay; day++) {
    if (!isWorkingWallDay(day)) continue;
    const start = Math.max(wa, day * DAY_MS);
    const end = Math.min(wb, (day + 1) * DAY_MS);
    if (end > start) total += end - start;
  }
  return total / HOUR_MS;
}

/**
 * The instant `h` working hours after `instantMs` (D37 clocks: "flag when the
 * client has waited 24 working hours"). Weekend time is skipped; the result
 * always falls on a working day — an instant that lands exactly on a
 * weekday's midnight before a weekend rolls to the next Monday 00:00, and a
 * weekend start with `h = 0` gives Monday 00:00. Inverse of
 * `workingHoursBetween` for weekday starts.
 */
export function addWorkingHours(instantMs: number, h: number, tz: string): number {
  if (!(h >= 0) || !Number.isFinite(h)) {
    throw new Error(`Working hours must be a finite non-negative number, got ${h}`);
  }
  let wall = toWallMs(instantMs, tz);
  let remaining = h * HOUR_MS;
  // Bounded: at most `h / 24` working days plus their weekends.
  for (;;) {
    const day = Math.floor(wall / DAY_MS);
    if (!isWorkingWallDay(day)) {
      wall = (day + 1) * DAY_MS;
      continue;
    }
    const available = (day + 1) * DAY_MS - wall;
    if (remaining < available) {
      wall += remaining;
      break;
    }
    remaining -= available;
    wall = (day + 1) * DAY_MS;
  }
  // A weekday start with nothing to add is the instant itself (no wall
  // round trip, which could move it inside a DST overlap).
  if (h === 0 && toWallMs(instantMs, tz) === wall) return instantMs;
  return fromWallMs(wall, tz);
}

/** §6.1 default due date: arrival + `workingDays` (default 2) working days. */
export function defaultDueDate(
  receivedAtMs: number,
  tz: string,
  workingDays: number = DEFAULT_DUE_WORKING_DAYS,
): string {
  return addWorkingDays(receivedAtMs, workingDays, tz);
}

/**
 * Period preset resolution for the ad-hoc worksheet picker (Phase 9 Slice 5).
 *
 * Pure helpers — no React, no Convex. The dialog calls these to derive
 * `{ start, end, label, slug }` from a preset key + the org's timezone.
 *
 * Why timezone matters: "this month" must match the user's calendar in
 * their org's timezone (e.g. "May 2026" while the server is in UTC at
 * 23:55 on April 30 must NOT resolve to April). We render today's
 * `YYYY-MM-DD` in the org's zone and walk from there.
 *
 * Slug rules (PRD §Filename examples):
 *   - month:   `2026-may`
 *   - quarter: `2026-q1`
 *   - year:    `2026`
 *   - all:     `{startYear}-{endYear}-all-time` when known, else `all-time`
 *   - custom:  `{startYMD}-to-{endYMD}`
 */

export type PeriodPresetKey =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "this-year"
  | "last-year"
  | "all-time"
  | "custom"

export type ResolvedPeriod = {
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD
  label: string
  slug: string
}

/** YYYY-MM-DD today in `timezone`. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
  return parts // en-CA already yields YYYY-MM-DD
}

function lastDayOfMonth(year: number, monthOneIndexed: number): number {
  return new Date(year, monthOneIndexed, 0).getDate()
}

function monthName(monthOneIndexed: number): string {
  return new Date(2000, monthOneIndexed - 1, 1).toLocaleDateString("en-US", {
    month: "long",
  })
}

function monthNameShort(monthOneIndexed: number): string {
  return new Date(2000, monthOneIndexed - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  })
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** "Jan 1 – Mar 31, 2026" formatter for the picker label. */
function rangeLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number)
  const [ey, em, ed] = end.split("-").map(Number)
  const startStr = `${monthNameShort(sm)} ${sd}`
  if (sy === ey) {
    return `${startStr} – ${monthNameShort(em)} ${ed}, ${ey}`
  }
  return `${startStr}, ${sy} – ${monthNameShort(em)} ${ed}, ${ey}`
}

/**
 * Resolve a preset key to a concrete period. `customStart` / `customEnd`
 * are required when key === "custom" and ignored otherwise. Returns null
 * when "all-time" is requested but we have no `projectStartDate` anchor —
 * caller can either fall back to "this year" or rely on the safety net
 * inside `resolvePeriodPreset` (we default to a wide range starting at
 * the project's start date if known).
 */
export function resolvePeriodPreset(input: {
  key: PeriodPresetKey
  timezone: string
  now?: Date
  /** Project start date (`YYYY-MM-DD`) — used as the lower bound for `all-time`. */
  projectStartDate?: string
  customStart?: string
  customEnd?: string
}): ResolvedPeriod | null {
  const todayStr = todayInTimezone(input.timezone, input.now)
  const [ty, tm] = todayStr.split("-").map(Number)

  switch (input.key) {
    case "this-month": {
      const start = `${ty}-${pad2(tm)}-01`
      const end = `${ty}-${pad2(tm)}-${pad2(lastDayOfMonth(ty, tm))}`
      return {
        start,
        end,
        label: `${monthName(tm)} ${ty}`,
        slug: `${ty}-${monthNameShort(tm).toLowerCase()}`,
      }
    }
    case "last-month": {
      const lastIdx = ty * 12 + (tm - 1) - 1
      const y = Math.floor(lastIdx / 12)
      const m = (lastIdx % 12) + 1
      const start = `${y}-${pad2(m)}-01`
      const end = `${y}-${pad2(m)}-${pad2(lastDayOfMonth(y, m))}`
      return {
        start,
        end,
        label: `${monthName(m)} ${y}`,
        slug: `${y}-${monthNameShort(m).toLowerCase()}`,
      }
    }
    case "this-quarter": {
      const q = Math.ceil(tm / 3)
      const startMonth = (q - 1) * 3 + 1
      const endMonth = startMonth + 2
      const start = `${ty}-${pad2(startMonth)}-01`
      const end = `${ty}-${pad2(endMonth)}-${pad2(lastDayOfMonth(ty, endMonth))}`
      return {
        start,
        end,
        label: `Q${q} ${ty} (${rangeLabel(start, end)})`,
        slug: `${ty}-q${q}`,
      }
    }
    case "last-quarter": {
      const q = Math.ceil(tm / 3)
      const lastQ = q === 1 ? 4 : q - 1
      const y = q === 1 ? ty - 1 : ty
      const startMonth = (lastQ - 1) * 3 + 1
      const endMonth = startMonth + 2
      const start = `${y}-${pad2(startMonth)}-01`
      const end = `${y}-${pad2(endMonth)}-${pad2(lastDayOfMonth(y, endMonth))}`
      return {
        start,
        end,
        label: `Q${lastQ} ${y} (${rangeLabel(start, end)})`,
        slug: `${y}-q${lastQ}`,
      }
    }
    case "this-year": {
      const start = `${ty}-01-01`
      const end = `${ty}-12-31`
      return {
        start,
        end,
        label: `${ty}`,
        slug: `${ty}`,
      }
    }
    case "last-year": {
      const y = ty - 1
      const start = `${y}-01-01`
      const end = `${y}-12-31`
      return {
        start,
        end,
        label: `${y}`,
        slug: `${y}`,
      }
    }
    case "all-time": {
      // Lower bound: project start date if known, else 1970-01-01 — but a
      // 1970 lower bound on a YYYY-MM-DD comparison is fine because no
      // entries pre-date the project. Upper bound: today.
      const start = input.projectStartDate ?? "1970-01-01"
      const end = todayStr
      const startYear = start.slice(0, 4)
      const endYear = end.slice(0, 4)
      return {
        start,
        end,
        label: `All time (${rangeLabel(start, end)})`,
        slug:
          startYear === endYear
            ? `${startYear}-all-time`
            : `${startYear}-${endYear}-all-time`,
      }
    }
    case "custom": {
      if (!input.customStart || !input.customEnd) return null
      if (input.customEnd < input.customStart) return null
      return {
        start: input.customStart,
        end: input.customEnd,
        label: rangeLabel(input.customStart, input.customEnd),
        slug: `${input.customStart}-to-${input.customEnd}`,
      }
    }
  }
}

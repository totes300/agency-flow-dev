/**
 * Which period the project page shows (docs/prd-project-billing-redesign.md
 * §7.1, §11.13). Pure: `?period=YYYY-MM` + the server's period rows in, the
 * selected period and its neighbours out. The server decides states; this
 * only picks which row (or bare month) is on screen.
 *
 *   - Retainer: any month snaps to the period (month or rollover cycle) that
 *     contains it; ‹ › step between the server's period rows.
 *   - T&M / non-billable: calendar months. A month with no billable work has
 *     no period row (§5.1) but is still a month you can look at.
 *   - Before the first period → the first one; after today → the current one.
 */

import type { PeriodRow } from "@/convex/lib/billing/projectPeriods"
import { periodRangeLabel } from "@/convex/lib/billing/projectPeriods"
import { absMonthOf, monthEndOfAbs, monthKeyFromAbs, monthStartOfAbs } from "@/convex/lib/billing/periods"

export type SelectedPeriod = {
  /** YYYY-MM of the period start — the `?period=` value. */
  key: string
  start: string
  end: string
  label: string
  /** The server's row for this period; null for a month without one. */
  row: PeriodRow | null
  isCurrent: boolean
  /** Neighbours for ‹ › (null at the ends). */
  prevKey: string | null
  nextKey: string | null
  /** The period containing today. */
  currentKey: string
}

const PERIOD_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/

export function parsePeriodParam(raw: string | null): string | null {
  return raw && PERIOD_PARAM.test(raw) ? raw : null
}

function monthSpan(key: string) {
  const abs = absMonthOf(`${key}-01`)
  return { key, start: monthStartOfAbs(abs), end: monthEndOfAbs(abs) }
}

/**
 * `rows` newest first (as `getProjectBillingPeriods` returns them).
 * `firstMonthKey` bounds month navigation when there are no rows before it
 * (T&M, non-billable: the project start or creation month).
 */
export function selectPeriod(input: {
  billingType: "retainer" | "t_and_m" | "non_billable" | "fixed"
  rows: readonly PeriodRow[]
  todayStr: string
  param: string | null
  firstMonthKey: string
}): SelectedPeriod {
  const { rows, todayStr } = input
  const todayKey = todayStr.slice(0, 7)
  const wanted = parsePeriodParam(input.param) ?? todayKey

  if (input.billingType === "retainer" && rows.length > 0) {
    const oldestFirst = [...rows].reverse()
    const current = rows[0]
    const day = `${wanted}-01`
    const hit =
      day < oldestFirst[0].start
        ? oldestFirst[0]
        : day > current.end
          ? current
          : (oldestFirst.find((r) => r.start <= day && r.end >= day) ?? current)
    const i = oldestFirst.indexOf(hit)
    return {
      key: hit.key,
      start: hit.start,
      end: hit.end,
      label: hit.label,
      row: hit,
      isCurrent: hit === current,
      prevKey: i > 0 ? oldestFirst[i - 1].key : null,
      nextKey: i < oldestFirst.length - 1 ? oldestFirst[i + 1].key : null,
      currentKey: current.key,
    }
  }

  // Calendar months, clamped to [first month, current month].
  const firstAbs = Math.min(
    absMonthOf(`${input.firstMonthKey}-01`),
    ...rows.map((r) => absMonthOf(r.start)),
    absMonthOf(todayStr),
  )
  const currentAbs = absMonthOf(todayStr)
  const abs = Math.min(currentAbs, Math.max(firstAbs, absMonthOf(`${wanted}-01`)))
  const m = monthSpan(monthKeyFromAbs(abs))
  return {
    ...m,
    label: periodRangeLabel(m.start, m.end),
    row: rows.find((r) => r.key === m.key) ?? null,
    isCurrent: abs === currentAbs,
    prevKey: abs > firstAbs ? monthKeyFromAbs(abs - 1) : null,
    nextKey: abs < currentAbs ? monthKeyFromAbs(abs + 1) : null,
    currentKey: monthKeyFromAbs(currentAbs),
  }
}

/**
 * The selected period and the two before it — the header trend (§7.2). A
 * rollover cycle shows its own months instead. Nothing before the first
 * period is shown.
 */
export function trendWindow(
  selected: SelectedPeriod,
  rows: readonly PeriodRow[],
  firstMonthKey: string,
): { key: string; label: string; minutes: number; selectKey: string }[] {
  const row = selected.row
  if (row && row.months.length > 1) {
    return row.months.map((m) => ({
      key: m.key,
      label: shortMonth(m.key),
      minutes: m.workedMinutes,
      selectKey: row.key,
    }))
  }
  const firstAbs = Math.min(absMonthOf(`${firstMonthKey}-01`), ...rows.map((r) => absMonthOf(r.start)))
  const abs = absMonthOf(selected.start)
  return [abs - 2, abs - 1, abs]
    .filter((a) => a >= firstAbs)
    .map((a) => {
      const key = monthKeyFromAbs(a)
      const r = rows.find((x) => x.key === key)
      return { key, label: shortMonth(key), minutes: r?.usageMinutes ?? 0, selectKey: key }
    })
}

export function shortMonth(key: string): string {
  return new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1).toLocaleDateString("en-US", {
    month: "short",
  })
}

/** Whole days from today to `end`, inclusive of today ("8 days left"). */
export function daysLeft(todayStr: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)
  return Math.max(0, Math.round(ms / 86_400_000) + 1)
}

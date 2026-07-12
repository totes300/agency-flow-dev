/**
 * Maps the Time tab's current view filters (URL state) onto the
 * `worksheets.exportAdHoc` action's parameters, so the toolbar's Worksheet
 * button can download exactly what the user is looking at — no re-picking
 * the period in a dialog.
 *
 * Pure helpers — no React, no Convex.
 *
 * Mapping notes:
 *   - Calendar-aligned presets (this/last month, this year, all time) reuse
 *     `resolvePeriodPreset` so slugs/labels match the ad-hoc dialog exactly.
 *   - Rolling presets (this/last week, last 90 days) have no dialog
 *     equivalent — they resolve to a custom range with the preset's name
 *     prefixed onto the label ("Last 90 days (Apr 14 – Jul 12, 2026)").
 *   - An incomplete/invalid custom range falls back to all-time, mirroring
 *     the orchestrator's query behavior (invalid custom shows all entries),
 *     so the export always matches the visible rows.
 *   - Billing status: `non_billable` → nonBillable; the billable lifecycle
 *     states (open / draft / closed) all map to `billable` — the export
 *     format has no lifecycle dimension, only billable vs not.
 *   - Member + search filters are intentionally NOT forwarded: the
 *     worksheet is a client-facing document and always covers the full team.
 */

import {
  DATE_RANGE_PRESET_LABELS,
  resolveDateRangePreset,
  type DateRangePreset,
} from "@/lib/date-buckets"
import {
  resolvePeriodPreset,
  type ResolvedPeriod,
} from "@/lib/worksheet-period-presets"

export type ViewExportParams = {
  periodStart: string
  periodEnd: string
  periodSlug: string
  periodLabel: string
  billable: "billable" | "nonBillable" | undefined
}

export function mapBillingStatusToBillable(
  billingStatus: string | null,
): "billable" | "nonBillable" | undefined {
  if (!billingStatus) return undefined
  if (billingStatus === "non_billable") return "nonBillable"
  if (
    billingStatus === "open" ||
    billingStatus === "draft" ||
    billingStatus === "closed"
  ) {
    return "billable"
  }
  return undefined
}

export function resolveViewExportPeriod(input: {
  dateRange: DateRangePreset
  customFrom?: string
  customTo?: string
  timezone: string
  projectStartDate?: string
  now?: Date
}): ResolvedPeriod {
  const { dateRange, customFrom, customTo, timezone, projectStartDate, now } =
    input

  const allTime = () =>
    // all-time never returns null — it always has a lower-bound fallback.
    resolvePeriodPreset({ key: "all-time", timezone, projectStartDate, now })!

  switch (dateRange) {
    case "all":
      return allTime()

    case "this_month":
      return resolvePeriodPreset({ key: "this-month", timezone, now })!

    case "last_month":
      return resolvePeriodPreset({ key: "last-month", timezone, now })!

    case "this_year":
      return resolvePeriodPreset({ key: "this-year", timezone, now })!

    case "custom": {
      const resolved =
        customFrom && customTo
          ? resolvePeriodPreset({
              key: "custom",
              timezone,
              customStart: customFrom,
              customEnd: customTo,
              now,
            })
          : null
      // Invalid/incomplete custom range → the view shows all entries, so
      // the export does too.
      return resolved ?? allTime()
    }

    case "this_week":
    case "last_week":
    case "last_90_days": {
      const range = resolveDateRangePreset(dateRange, timezone, now)!
      const resolved = resolvePeriodPreset({
        key: "custom",
        timezone,
        customStart: range.from,
        customEnd: range.to,
        now,
      })!
      return {
        ...resolved,
        label: `${DATE_RANGE_PRESET_LABELS[dateRange]} (${resolved.label})`,
      }
    }
  }
}

export function resolveViewExportParams(input: {
  dateRange: DateRangePreset
  customFrom?: string
  customTo?: string
  billingStatus: string | null
  timezone: string
  projectStartDate?: string
  now?: Date
}): ViewExportParams {
  const period = resolveViewExportPeriod(input)
  return {
    periodStart: period.start,
    periodEnd: period.end,
    periodSlug: period.slug,
    periodLabel: period.label,
    billable: mapBillingStatusToBillable(input.billingStatus),
  }
}

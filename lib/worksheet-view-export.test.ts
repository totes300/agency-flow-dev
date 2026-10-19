import { describe, it, expect } from "vitest"
import {
  mapBillingStatusToBillable,
  resolveViewExportParams,
  resolveViewExportPeriod,
} from "./worksheet-view-export"

const tz = "UTC"
const now = new Date("2026-07-12T12:00:00Z")

describe("mapBillingStatusToBillable", () => {
  it("returns undefined when no status filter is active", () => {
    expect(mapBillingStatusToBillable(null)).toBeUndefined()
    expect(mapBillingStatusToBillable("")).toBeUndefined()
  })

  it("maps non_billable to nonBillable", () => {
    expect(mapBillingStatusToBillable("non_billable")).toBe("nonBillable")
  })

  it("maps every billable lifecycle state to billable", () => {
    expect(mapBillingStatusToBillable("open")).toBe("billable")
    expect(mapBillingStatusToBillable("draft")).toBe("billable")
    expect(mapBillingStatusToBillable("closed")).toBe("billable")
  })

  it("ignores unknown values", () => {
    expect(mapBillingStatusToBillable("bogus")).toBeUndefined()
  })
})

describe("resolveViewExportPeriod", () => {
  it("'all' resolves to all-time anchored at the project start date", () => {
    const p = resolveViewExportPeriod({
      dateRange: "all",
      timezone: tz,
      projectStartDate: "2025-03-01",
      now,
    })
    expect(p.start).toBe("2025-03-01")
    expect(p.end).toBe("2026-07-12")
    expect(p.slug).toBe("2025-2026-all-time")
  })

  it("'last_month' matches the ad-hoc dialog's last-month preset", () => {
    const p = resolveViewExportPeriod({ dateRange: "last_month", timezone: tz, now })
    expect(p).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
      label: "June 2026",
      slug: "2026-jun",
    })
  })

  it("'this_month' resolves to the current calendar month", () => {
    const p = resolveViewExportPeriod({ dateRange: "this_month", timezone: tz, now })
    expect(p.start).toBe("2026-07-01")
    expect(p.end).toBe("2026-07-31")
  })

  it("'this_year' resolves to the full calendar year", () => {
    const p = resolveViewExportPeriod({ dateRange: "this_year", timezone: tz, now })
    expect(p).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      label: "2026",
      slug: "2026",
    })
  })

  it("'last_90_days' resolves to a custom range with the preset name in the label", () => {
    const p = resolveViewExportPeriod({ dateRange: "last_90_days", timezone: tz, now })
    expect(p.start).toBe("2026-04-14")
    expect(p.end).toBe("2026-07-12")
    expect(p.slug).toBe("2026-04-14-to-2026-07-12")
    expect(p.label).toBe("Last 90 days (Apr 14 – Jul 12, 2026)")
  })

  it("valid custom range passes through", () => {
    const p = resolveViewExportPeriod({
      dateRange: "custom",
      customFrom: "2026-01-15",
      customTo: "2026-04-30",
      timezone: tz,
      now,
    })
    expect(p.start).toBe("2026-01-15")
    expect(p.end).toBe("2026-04-30")
    expect(p.slug).toBe("2026-01-15-to-2026-04-30")
  })

  it("incomplete custom range falls back to all-time (matches the view showing all entries)", () => {
    const p = resolveViewExportPeriod({
      dateRange: "custom",
      customFrom: "2026-01-15",
      timezone: tz,
      projectStartDate: "2026-01-01",
      now,
    })
    expect(p.start).toBe("2026-01-01")
    expect(p.end).toBe("2026-07-12")
  })

  it("inverted custom range falls back to all-time", () => {
    const p = resolveViewExportPeriod({
      dateRange: "custom",
      customFrom: "2026-05-01",
      customTo: "2026-04-01",
      timezone: tz,
      projectStartDate: "2026-01-01",
      now,
    })
    expect(p.start).toBe("2026-01-01")
    expect(p.end).toBe("2026-07-12")
  })
})

describe("resolveViewExportParams", () => {
  it("combines period and billable mapping", () => {
    const p = resolveViewExportParams({
      dateRange: "last_month",
      billingStatus: "open",
      timezone: tz,
      now,
    })
    expect(p).toEqual({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      periodSlug: "2026-jun",
      periodLabel: "June 2026",
      billable: "billable",
    })
  })
})

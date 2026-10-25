import { describe, expect, it } from "vitest"
import type { PeriodRow } from "@/convex/lib/billing/projectPeriods"
import { daysLeft, parsePeriodParam, selectPeriod, trendWindow } from "./period-selection"

function row(key: string, end: string, extra: Partial<PeriodRow> = {}): PeriodRow {
  return {
    key,
    start: `${key}-01`,
    end,
    label: key,
    months: [{ key, label: key, workedMinutes: 60 }],
    usageMinutes: 60,
    billableMinutes: 60,
    nonBillableMinutes: 0,
    includedMinutes: 480,
    overageMinutes: 0,
    amountMinor: 0,
    missingRate: false,
    state: "ready_to_close",
    isCommittable: false,
    blockedBy: null,
    action: null,
    undo: [],
    closeId: null,
    closeStatus: null,
    closedAt: null,
    invoice: null,
    documents: { monthlyReport: "preview", worksheet: "range" },
    ...extra,
  }
}

// Newest first, like the server.
const monthly = [row("2026-10", "2026-10-31"), row("2026-09", "2026-09-30"), row("2026-08", "2026-08-31")]
const cycles = [
  row("2026-07", "2026-09-30", { months: ["07", "08", "09"].map((m) => ({ key: `2026-${m}`, label: m, workedMinutes: 30 })) }),
  row("2026-04", "2026-06-30"),
]

describe("selectPeriod", () => {
  const base = { billingType: "retainer" as const, todayStr: "2026-10-24", firstMonthKey: "2026-08" }

  it("opens on the current period", () => {
    expect(selectPeriod({ ...base, rows: monthly, param: null })).toMatchObject({
      key: "2026-10",
      isCurrent: true,
      prevKey: "2026-09",
      nextKey: null,
    })
  })

  it("§11.13 — clamps before the start and after today", () => {
    expect(selectPeriod({ ...base, rows: monthly, param: "2025-01" }).key).toBe("2026-08")
    expect(selectPeriod({ ...base, rows: monthly, param: "2027-01" }).key).toBe("2026-10")
    expect(selectPeriod({ ...base, rows: monthly, param: "garbage" }).key).toBe("2026-10")
  })

  it("a rollover month snaps to its cycle", () => {
    const s = selectPeriod({ ...base, rows: cycles, param: "2026-05", todayStr: "2026-08-10" })
    expect(s).toMatchObject({ key: "2026-04", nextKey: "2026-07", prevKey: null, isCurrent: false })
  })

  it("T&M months without a row are still selectable, bounded by the first month", () => {
    const tm = [row("2026-10", "2026-10-31"), row("2026-07", "2026-07-31")]
    const s = selectPeriod({ ...base, billingType: "t_and_m", rows: tm, param: "2026-08" })
    expect(s).toMatchObject({ key: "2026-08", row: null, prevKey: "2026-07", nextKey: "2026-09" })
    expect(selectPeriod({ ...base, billingType: "t_and_m", rows: tm, param: "2026-01" }).key).toBe("2026-07")
  })
})

describe("trendWindow", () => {
  it("the selected period and the two before it, never before the first", () => {
    const s = selectPeriod({ billingType: "retainer", rows: monthly, todayStr: "2026-10-24", param: "2026-09", firstMonthKey: "2026-08" })
    expect(trendWindow(s, monthly, "2026-08").map((t) => t.key)).toEqual(["2026-08", "2026-09"])
  })

  it("a rollover cycle shows its months", () => {
    const s = selectPeriod({ billingType: "retainer", rows: cycles, todayStr: "2026-08-10", param: null, firstMonthKey: "2026-04" })
    expect(trendWindow(s, cycles, "2026-04").map((t) => [t.key, t.selectKey])).toEqual([
      ["2026-07", "2026-07"],
      ["2026-08", "2026-07"],
      ["2026-09", "2026-07"],
    ])
  })
})

describe("helpers", () => {
  it("parsePeriodParam accepts YYYY-MM only", () => {
    expect(parsePeriodParam("2026-10")).toBe("2026-10")
    expect(parsePeriodParam("2026-13")).toBeNull()
    expect(parsePeriodParam(null)).toBeNull()
  })

  it("daysLeft counts today", () => {
    expect(daysLeft("2026-10-24", "2026-10-31")).toBe(8)
    expect(daysLeft("2026-10-31", "2026-10-31")).toBe(1)
  })
})

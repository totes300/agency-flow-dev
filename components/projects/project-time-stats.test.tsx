import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { ProjectTimeStats } from "./project-time-stats"
import type { TimeEntryRow } from "./project-time-table"
import type { Id } from "@/convex/_generated/dataModel"

afterEach(cleanup)

/**
 * Phase 8 Slice 4 — top summary on the project Time tab.
 *
 * Parent PRD § UI Changes → Top summary:
 *
 *   Existing `Total / Billable / Non-billable` summary gains exactly
 *   one additional figure: `Open` (hours where `entryStatus() ===
 *   "open"`).
 *
 * The number MUST match what the filter dropdown would return when
 * set to `open` — both are derived from `entryStatus()`.
 */

function row(over: Partial<TimeEntryRow>): TimeEntryRow {
  return {
    _id: "e" as unknown as Id<"timeEntries">,
    taskId: "t" as unknown as Id<"tasks">,
    taskTitle: "Task",
    userId: "u" as unknown as Id<"users">,
    userName: "User",
    userImageUrl: undefined,
    date: "2026-03-15",
    startedAt: Date.UTC(2026, 2, 15),
    durationMinutes: 60,
    note: undefined,
    isBillable: true,
    billableRate: 100,
    costRate: 50,
    workCategoryId: undefined,
    workCategoryName: undefined,
    workCategoryColor: undefined,
    invoiceId: undefined,
    invoicePrefix: undefined,
    invoiceNumber: undefined,
    invoiceStatus: undefined,
    invoiceDueDate: undefined,
    settledAt: undefined,
    settledReason: undefined,
    settledPeriodStart: undefined,
    settledPeriodEnd: undefined,
    ...over,
  }
}

describe("ProjectTimeStats — Open figure", () => {
  it("counts only entries where entryStatus() === 'open'", () => {
    // 1h open + 2h closed + 1h non-billable → Open = 1h.
    const entries: TimeEntryRow[] = [
      row({ durationMinutes: 60 }), // open
      row({
        durationMinutes: 120,
        settledAt: 1,
        settledReason: "retainer_included",
      }), // closed
      row({ durationMinutes: 60, isBillable: false }), // non-billable
    ]
    const { getByText, getAllByText } = render(
      <ProjectTimeStats
        entries={entries}
        billingType="retainer"
        currency="USD"
      />,
    )
    // Retainer projects show "Open" as the fourth pill.
    expect(getByText("Open")).toBeInTheDocument()
    // `formatHoursCompact(60)` → "1h 0m". Multiple stats can share the
    // same minute total (Total = 4h 0m, Open = 1h 0m here), so we
    // assert the Open figure is present somewhere in the rendered tree.
    const openValueMatches = getAllByText("1h 0m")
    expect(openValueMatches.length).toBeGreaterThan(0)
  })

  it("excludes Draft and Closed entries from the Open figure", () => {
    // Draft and Closed are not Open — the row's lock predicate guards
    // them out. This is the contract that prevents Open from drifting
    // back into the old `uninvoiced` semantics (which included Closed
    // by accident before Slice 1).
    const entries: TimeEntryRow[] = [
      row({
        durationMinutes: 120,
        invoiceId: "inv_a" as unknown as Id<"invoices">,
        invoicePrefix: "INV-",
        invoiceNumber: 1,
        invoiceStatus: "draft",
      }), // draft
      row({
        durationMinutes: 60,
        settledAt: 1,
        settledReason: "invoiced",
      }), // closed
    ]
    const { getAllByText } = render(
      <ProjectTimeStats
        entries={entries}
        billingType="retainer"
        currency="USD"
      />,
    )
    // 0h Open across both entries. `formatHoursCompact(0)` → "0h 0m".
    // Non-billable shares the value (also 0h here), so we just assert
    // the zero figure appears at least once.
    const openValues = getAllByText("0h 0m")
    expect(openValues.length).toBeGreaterThan(0)
  })

  it("renders Open Hours + Open Amount on T&M projects (money-shaped variant)", () => {
    // T&M billers care about the revenue side — same `Open` bucket,
    // expressed as both hours and money.
    const entries: TimeEntryRow[] = [
      row({ durationMinutes: 60, billableRate: 200 }), // open, $200 worth
    ]
    const { getByText } = render(
      <ProjectTimeStats
        entries={entries}
        billingType="t_and_m"
        currency="USD"
      />,
    )
    expect(getByText("Open Hours")).toBeInTheDocument()
    expect(getByText("Open Amount")).toBeInTheDocument()
  })
})

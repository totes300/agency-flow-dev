import { describe, it, expect } from "vitest"
import { deriveInvoiceBannerView, type InvoiceBannerState } from "./invoice-banner-view"

const tz = "UTC"
const now = Date.UTC(2026, 4, 1, 12, 0, 0) // Mar 1 2026 12:00 UTC reference

describe("deriveInvoiceBannerView — Fixed", () => {
  it("renders remaining + percent-billed subline", () => {
    const state: InvoiceBannerState = {
      kind: "fixed",
      remaining: 5000,
      lastInvoicedAt: Date.UTC(2026, 1, 12, 12, 0, 0),
      daysSinceLastInvoice: 60,
      percentBilled: 50,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toBe("Remaining to invoice")
    expect(view.amountLabel).toBe("remaining")
    expect(view.amountTone).toBe("neutral")
    expect(view.subline).toContain("Last invoiced")
    expect(view.subline).toContain("50% of contract billed")
  })

  it("omits percent-billed segment when 0", () => {
    const state: InvoiceBannerState = {
      kind: "fixed",
      remaining: 10000,
      lastInvoicedAt: null,
      daysSinceLastInvoice: null,
      percentBilled: 0,
    }
    expect(deriveInvoiceBannerView(state, "EUR", tz).subline).toBe(null)
  })
})

describe("deriveInvoiceBannerView — T&M", () => {
  it("renders uninvoiced balance + minutes in title", () => {
    const state: InvoiceBannerState = {
      kind: "tm",
      uninvoicedAmount: 4750,
      uninvoicedMinutes: 47 * 60 + 30,
      lastInvoicedAt: Date.UTC(2026, 3, 1, 12, 0, 0),
      daysSinceLastInvoice: 30,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toContain("Uninvoiced balance")
    expect(view.title).toContain("47:30")
    expect(view.amountLabel).toBe("unbilled")
    expect(view.subline).toContain("Last invoiced")
  })
})

describe("deriveInvoiceBannerView — Retainer monthly", () => {
  it("singular when 1 month ready, no overage → 'within budget' (ok tone)", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-monthly",
      readyMonthCount: 1,
      readyMonthsLabel: "Mar",
      overageDue: 0,
      lastInvoicedAt: Date.UTC(2026, 1, 28, 12, 0, 0),
      targetYear: 2026,
      targetMonth: 3,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toBe("1 month ready to bill")
    expect(view.amountLabel).toBe("within budget")
    expect(view.labelTone).toBe("ok")
    expect(view.amountTone).toBe("neutral")
  })

  it("plural with overage → 'overage' (warn tone)", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-monthly",
      readyMonthCount: 2,
      readyMonthsLabel: "Mar & Apr",
      overageDue: 240,
      lastInvoicedAt: Date.UTC(2026, 1, 28, 12, 0, 0),
      targetYear: 2026,
      targetMonth: 3,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toBe("2 months ready to bill")
    expect(view.amountLabel).toBe("overage")
    expect(view.amountTone).toBe("warn")
    expect(view.subline).toContain("Mar & Apr ready")
  })
})

describe("deriveInvoiceBannerView — Retainer cycle-closed", () => {
  it("includes 'N over' segment and used/budget pair when over budget", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-cycle-closed",
      cycleLabel: "Apr–Jun",
      closedAt: Date.UTC(2026, 5, 30, 12, 0, 0),
      usedMinutes: 126 * 60,
      budgetMinutes: 120 * 60,
      overageDue: 450,
      withinBudget: false,
      targetYear: 2026,
      targetMonth: 6,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toBe("Apr–Jun cycle closed")
    expect(view.amountLabel).toBe("overage")
    expect(view.amountTone).toBe("warn")
    expect(view.subline).toContain("06:00 over")
    expect(view.subline).toContain("126:00 / 120:00 used")
  })

  it("within budget → 'within budget' label, neutral amount, ok label tone", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-cycle-closed",
      cycleLabel: "Apr–Jun",
      closedAt: Date.UTC(2026, 5, 30, 12, 0, 0),
      usedMinutes: 102 * 60,
      budgetMinutes: 120 * 60,
      overageDue: 0,
      withinBudget: true,
      targetYear: 2026,
      targetMonth: 6,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.amountLabel).toBe("within budget")
    expect(view.amountTone).toBe("neutral")
    expect(view.labelTone).toBe("ok")
    expect(view.subline).not.toContain("over")
  })
})

// Reference timestamp ignored, just keeps imports tidy.
void now

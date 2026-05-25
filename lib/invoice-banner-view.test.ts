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
  it("renders open balance + minutes in title", () => {
    const state: InvoiceBannerState = {
      kind: "tm",
      openAmount: 4750,
      openMinutes: 47 * 60 + 30,
      lastInvoicedAt: Date.UTC(2026, 3, 1, 12, 0, 0),
      daysSinceLastInvoice: 30,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toContain("Open balance")
    expect(view.title).toContain("47:30")
    expect(view.amountLabel).toBe("unbilled")
    expect(view.subline).toContain("Last invoiced")
  })
})

describe("deriveInvoiceBannerView — Retainer monthly", () => {
  // Contract: the banner only fires when `metrics.uninvoicedMonths` is
  // non-empty, and that list is filtered to over-budget months only
  // (`convex/invoices.ts:getClosedUninvoicedMonths`). Therefore
  // `overageDue` is always > 0 when this branch runs. There is no
  // "within budget" branch — within-budget periods are not something
  // to BILL, they're something to CLOSE, and close lives on the
  // Monthly Breakdown row, not in this banner.
  it("singular with overage → 'overage' (warn tone)", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-monthly",
      readyMonthCount: 1,
      readyMonthsLabel: "Mar",
      overageDue: 400,
      lastInvoicedAt: Date.UTC(2026, 1, 28, 12, 0, 0),
      targetYear: 2026,
      targetMonth: 3,
    }
    const view = deriveInvoiceBannerView(state, "EUR", tz)
    expect(view.title).toBe("1 month ready to bill")
    expect(view.amountLabel).toBe("overage")
    expect(view.amountTone).toBe("warn")
    expect(view.labelTone).toBe("muted")
    expect(view.subline).toContain("Mar ready")
  })

  it("plural with overage total → 'overage' (warn tone)", () => {
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

describe("deriveInvoiceBannerView — Retainer cycle (rollover)", () => {
  // Same urgency signal as `retainer-monthly`, different unit. Banner only
  // fires when at least one rollover cycle has overage and is unbilled.
  it("singular with overage → '1 cycle ready to bill' (warn tone)", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-cycle",
      readyCycleCount: 1,
      readyCyclesLabel: "Apr 2026",
      overageDue: 720,
      lastInvoicedAt: Date.UTC(2026, 1, 28, 12, 0, 0),
      targetYear: 2026,
      targetMonth: 4,
    }
    const view = deriveInvoiceBannerView(state, "USD", tz)
    expect(view.title).toBe("1 cycle ready to bill")
    expect(view.amountLabel).toBe("overage")
    expect(view.amountTone).toBe("warn")
    expect(view.labelTone).toBe("muted")
    expect(view.subline).toContain("Apr 2026 ready")
  })

  it("plural with overage total → 'N cycles ready to bill'", () => {
    const state: InvoiceBannerState = {
      kind: "retainer-cycle",
      readyCycleCount: 2,
      readyCyclesLabel: "Apr 2026 & Jul 2026",
      overageDue: 1440,
      lastInvoicedAt: Date.UTC(2025, 11, 28, 12, 0, 0),
      targetYear: 2026,
      targetMonth: 4,
    }
    const view = deriveInvoiceBannerView(state, "USD", tz)
    expect(view.title).toBe("2 cycles ready to bill")
    expect(view.subline).toContain("Apr 2026 & Jul 2026 ready")
  })
})

// Reference timestamp ignored, just keeps imports tidy.
void now

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

// Reference timestamp ignored, just keeps imports tidy.
void now

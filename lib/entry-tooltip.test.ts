import { describe, it, expect } from "vitest"
import { formatLockedTooltip } from "./entry-tooltip"

/**
 * Locked-row hover tooltip wording, from the close that settles the entry:
 *
 *   "Closed {committed} · invoiced | included in retainer · {start}–{end}"
 *
 * Rows whose close still has a draft invoice get an "On draft invoice INV-…"
 * line so the lock isn't mysterious.
 */

// 2026-04-02 00:00 UTC.
const APR_2 = Date.UTC(2026, 3, 2)
const noInvoice = { invoicePrefix: undefined, invoiceNumber: undefined }

describe("formatLockedTooltip — final closes", () => {
  it("renders a retainer close with its period", () => {
    const out = formatLockedTooltip({
      closeStatus: "final",
      closeKind: "retainer",
      closedAt: APR_2,
      closePeriodStart: "2026-03-01",
      closePeriodEnd: "2026-03-31",
      ...noInvoice,
    })
    expect(out).toContain("Closed Apr 2")
    expect(out).toContain("included in retainer")
    expect(out).toContain("Mar 1")
    expect(out).toContain("Mar 31")
  })

  it("renders a T&M close as invoiced", () => {
    const out = formatLockedTooltip({
      closeStatus: "final",
      closeKind: "t_and_m",
      closedAt: APR_2,
      closePeriodStart: "2026-03-01",
      closePeriodEnd: "2026-03-31",
      ...noInvoice,
    })
    expect(out).toContain("invoiced")
  })

  it("stays useful without a period range", () => {
    const out = formatLockedTooltip({ closeStatus: "final", closeKind: "t_and_m", closedAt: APR_2, ...noInvoice })
    expect(out).toBe("Closed Apr 2 · invoiced")
  })
})

describe("formatLockedTooltip — draft closes and open entries", () => {
  it("references the invoice number when on a numbered draft", () => {
    const out = formatLockedTooltip({ closeStatus: "draft", invoicePrefix: "INV-", invoiceNumber: 38 })
    expect(out).toBe("On draft invoice INV-038")
  })

  it("reads 'On a draft invoice' before the draft is numbered", () => {
    expect(formatLockedTooltip({ closeStatus: "draft", ...noInvoice })).toBe("On a draft invoice")
  })

  it("returns null for an open entry", () => {
    expect(formatLockedTooltip({ ...noInvoice })).toBeNull()
  })
})

import { describe, it, expect } from "vitest"
import { formatLockedTooltip } from "./entry-tooltip"

/**
 * Phase 8 Slice 4 — locked-row hover tooltip wording.
 *
 * Parent PRD § UI Changes → Time entry list spells out the contract:
 *
 *   Tooltip on a closed entry: "Closed {settledAt} · included in
 *   retainer / fixed price / invoiced · {settledPeriodStart}–{settledPeriodEnd}"
 *
 * Plus: draft rows (on a draft invoice, no settledAt) get an "On draft
 * invoice INV-…" line so the lock isn't mysterious.
 */

// 2026-03-15 00:00 UTC.
const MAR_15 = Date.UTC(2026, 2, 15)

describe("formatLockedTooltip — settled entries (Closed)", () => {
  it("renders the retainer-included variant with the period boundary", () => {
    const out = formatLockedTooltip({
      settledAt: MAR_15,
      settledReason: "retainer_included",
      settledPeriodStart: "2026-03-01",
      settledPeriodEnd: "2026-03-31",
      invoicePrefix: undefined,
      invoiceNumber: undefined,
    })
    expect(out).toContain("Closed Mar 15")
    expect(out).toContain("included in retainer")
    expect(out).toContain("Mar 1")
    expect(out).toContain("Mar 31")
  })

  it("renders the fixed-included variant", () => {
    const out = formatLockedTooltip({
      settledAt: MAR_15,
      settledReason: "fixed_included",
      settledPeriodStart: "2026-03-01",
      settledPeriodEnd: "2026-03-31",
      invoicePrefix: undefined,
      invoiceNumber: undefined,
    })
    expect(out).toContain("covered by fixed price")
  })

  it("renders the invoiced variant", () => {
    const out = formatLockedTooltip({
      settledAt: MAR_15,
      settledReason: "invoiced",
      settledPeriodStart: "2026-03-01",
      settledPeriodEnd: "2026-03-31",
      invoicePrefix: undefined,
      invoiceNumber: undefined,
    })
    expect(out).toContain("invoiced")
  })

  it("falls back when the period boundary is missing (e.g. legacy entry)", () => {
    // Defensive — the schema makes these optional. The tooltip should
    // still be useful without the period range.
    const out = formatLockedTooltip({
      settledAt: MAR_15,
      settledReason: "invoiced",
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      invoicePrefix: undefined,
      invoiceNumber: undefined,
    })
    expect(out).toContain("Closed Mar 15")
    expect(out).toContain("invoiced")
    expect(out).not.toContain("–") // no boundary range rendered
  })
})

describe("formatLockedTooltip — draft entries", () => {
  it("references the invoice number when on a draft invoice", () => {
    const out = formatLockedTooltip({
      settledAt: undefined,
      settledReason: undefined,
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      invoicePrefix: "INV-",
      invoiceNumber: 38,
    })
    expect(out).toBe("On draft invoice INV-038")
  })

  it("returns null when there's no invoice context at all", () => {
    // Should not happen in practice (a draft row must have an
    // invoiceId), but the helper stays well-defined for safety.
    const out = formatLockedTooltip({
      settledAt: undefined,
      settledReason: undefined,
      settledPeriodStart: undefined,
      settledPeriodEnd: undefined,
      invoicePrefix: undefined,
      invoiceNumber: undefined,
    })
    expect(out).toBeNull()
  })
})

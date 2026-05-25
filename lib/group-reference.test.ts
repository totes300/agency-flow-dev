import { describe, it, expect } from "vitest"
import { deriveGroupReference } from "./group-reference"

/**
 * Phase 8 Slice 4 — day-group "consolidated reference" derivation.
 *
 * Parent PRD § UI Changes → Time entry list:
 *
 *   The day-group header carries the reference, not the row. A closed
 *   day shows `Closed · Mar 1–31` (period boundary). An invoiced day
 *   shows `Closed · INV-038` (invoice number).
 *
 * The function decides which (if any) reference to consolidate:
 *   1. all retainer-included with the same monthly boundary → period
 *   2. all on the same invoice (draft OR finalized) → invoice
 *   3. anything else → null (mixed; fall back to per-row badges)
 */

type Entry = Parameters<typeof deriveGroupReference>[0] extends readonly (infer E)[]
  ? E
  : never

function entry(over: Partial<Entry>): Entry {
  return {
    isBillable: true,
    invoiceId: undefined,
    invoicePrefix: undefined,
    invoiceNumber: undefined,
    settledAt: undefined,
    settledReason: undefined,
    settledPeriodStart: undefined,
    settledPeriodEnd: undefined,
    ...over,
  }
}

describe("deriveGroupReference — period reference", () => {
  it("returns the period range when all billable entries share the same retainer boundary", () => {
    const out = deriveGroupReference([
      entry({
        settledAt: 1,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
      }),
      entry({
        settledAt: 2,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
      }),
    ])
    expect(out?.kind).toBe("period")
    if (out?.kind === "period") {
      expect(out.label).toContain("Closed")
      expect(out.label).toContain("Mar 1")
      expect(out.label).toContain("Mar 31")
    }
  })

  it("returns null when entries straddle two periods (Feb + Mar)", () => {
    // Mixed period boundary → no consolidated header reference; rows
    // get their per-row badges instead.
    const out = deriveGroupReference([
      entry({
        settledAt: 1,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-02-01",
        settledPeriodEnd: "2026-02-28",
      }),
      entry({
        settledAt: 2,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
      }),
    ])
    expect(out).toBeNull()
  })
})

describe("deriveGroupReference — invoice reference", () => {
  it("renders Closed · INV-038 when every billable entry is on the same finalized invoice", () => {
    const out = deriveGroupReference([
      entry({
        invoiceId: "inv_a",
        invoicePrefix: "INV-",
        invoiceNumber: 38,
        settledAt: 1,
        settledReason: "invoiced",
      }),
      entry({
        invoiceId: "inv_a",
        invoicePrefix: "INV-",
        invoiceNumber: 38,
        settledAt: 2,
        settledReason: "invoiced",
      }),
    ])
    expect(out?.kind).toBe("invoice")
    if (out?.kind === "invoice") {
      expect(out.label).toBe("Closed · INV-038")
      expect(out.isDraft).toBe(false)
    }
  })

  it("renders Draft · INV-038 when ANY entry on the shared invoice is still draft", () => {
    // Even one draft entry on the shared invoice forces the header to
    // read "Draft" so the user knows the invoice isn't final yet.
    const out = deriveGroupReference([
      entry({
        invoiceId: "inv_a",
        invoicePrefix: "INV-",
        invoiceNumber: 50,
        settledAt: 1,
        settledReason: "invoiced",
      }),
      entry({
        invoiceId: "inv_a",
        invoicePrefix: "INV-",
        invoiceNumber: 50,
        // Draft — invoiceId set, no settledAt.
      }),
    ])
    expect(out?.kind).toBe("invoice")
    if (out?.kind === "invoice") {
      expect(out.isDraft).toBe(true)
      expect(out.label).toBe("Draft · INV-050")
    }
  })

  it("returns null when entries are on different invoices", () => {
    const out = deriveGroupReference([
      entry({ invoiceId: "inv_a", invoicePrefix: "INV-", invoiceNumber: 1 }),
      entry({ invoiceId: "inv_b", invoicePrefix: "INV-", invoiceNumber: 2 }),
    ])
    expect(out).toBeNull()
  })
})

describe("deriveGroupReference — non-billable / mixed", () => {
  it("returns null when the group is entirely non-billable", () => {
    const out = deriveGroupReference([
      entry({ isBillable: false }),
      entry({ isBillable: false }),
    ])
    expect(out).toBeNull()
  })

  it("ignores non-billable entries when computing the reference", () => {
    // A non-billable entry should not break period consolidation —
    // billability is the row axis, not the consolidation axis.
    const out = deriveGroupReference([
      entry({ isBillable: false }),
      entry({
        settledAt: 1,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
      }),
    ])
    expect(out?.kind).toBe("period")
  })

  it("returns null when one billable entry is open (not yet settled or invoiced)", () => {
    // A still-open entry inside an otherwise-closed day breaks the
    // header consolidation — the row badge for the open entry shows
    // `Open` while the closed siblings show `Closed`.
    const out = deriveGroupReference([
      entry({
        settledAt: 1,
        settledReason: "retainer_included",
        settledPeriodStart: "2026-03-01",
        settledPeriodEnd: "2026-03-31",
      }),
      entry({}), // open
    ])
    expect(out).toBeNull()
  })
})

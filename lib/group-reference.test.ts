import { describe, it, expect } from "vitest"
import { deriveGroupReference } from "./group-reference"

/**
 * Day-group "consolidated reference" derivation:
 *   1. all closed within budget in the same period → period
 *   2. all on the same invoice (draft OR finalized) → invoice
 *   3. anything else → null (mixed; fall back to per-row badges)
 */

type Entry = Parameters<typeof deriveGroupReference>[0] extends readonly (infer E)[]
  ? E
  : never

function entry(over: Partial<Entry>): Entry {
  return { isBillable: true, ...over }
}

const march = { closeStatus: "final" as const, closePeriodStart: "2026-03-01", closePeriodEnd: "2026-03-31" }

describe("deriveGroupReference — period reference", () => {
  it("returns the period range when all billable entries share one within-budget close", () => {
    const out = deriveGroupReference([entry(march), entry(march)])
    expect(out?.kind).toBe("period")
    if (out?.kind === "period") {
      expect(out.label).toContain("Closed")
      expect(out.label).toContain("Mar 1")
      expect(out.label).toContain("Mar 31")
    }
  })

  it("returns null when entries straddle two periods (Feb + Mar)", () => {
    const out = deriveGroupReference([
      entry({ closeStatus: "final", closePeriodStart: "2026-02-01", closePeriodEnd: "2026-02-28" }),
      entry(march),
    ])
    expect(out).toBeNull()
  })
})

describe("deriveGroupReference — invoice reference", () => {
  const onInvoice = (n: number, closeStatus: "draft" | "final") =>
    entry({ ...march, closeStatus, invoiceId: `inv_${n}`, invoicePrefix: "INV-", invoiceNumber: n })

  it("renders Closed · INV-038 when every billable entry is on the same finalized invoice", () => {
    const out = deriveGroupReference([onInvoice(38, "final"), onInvoice(38, "final")])
    expect(out).toMatchObject({ kind: "invoice", label: "Closed · INV-038", isDraft: false })
  })

  it("renders Draft · INV-050 while the shared invoice is still a draft", () => {
    const out = deriveGroupReference([onInvoice(50, "draft"), onInvoice(50, "draft")])
    expect(out).toMatchObject({ kind: "invoice", label: "Draft · INV-050", isDraft: true })
  })

  it("returns null when entries are on different invoices", () => {
    expect(deriveGroupReference([onInvoice(1, "final"), onInvoice(2, "final")])).toBeNull()
  })
})

describe("deriveGroupReference — non-billable / mixed", () => {
  it("returns null when the group is entirely non-billable", () => {
    expect(deriveGroupReference([entry({ isBillable: false }), entry({ isBillable: false })])).toBeNull()
  })

  it("ignores non-billable entries when computing the reference", () => {
    const out = deriveGroupReference([entry({ isBillable: false }), entry(march)])
    expect(out?.kind).toBe("period")
  })

  it("returns null when one billable entry is still open", () => {
    expect(deriveGroupReference([entry(march), entry({})])).toBeNull()
  })
})

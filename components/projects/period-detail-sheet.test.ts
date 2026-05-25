import { describe, it, expect } from "vitest"
import { groupBySettledReason } from "./period-detail-sheet"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * Phase 8 Slice 4 — pure aggregator behind the period drill-down's
 * covered-vs-invoiced split.
 *
 * The drill-down is the only UI surface that splits a row's collapsed
 * `Closed` back into its financial reason. This aggregator is what makes
 * that split possible — it reads `settledReason` straight off the entry
 * (per parent PRD § Reporting Changes: "the durable truth is the
 * schema, never collapsed"). The render layer is a thin pass over the
 * shape this function returns.
 */

const inv = (s: string) => s as unknown as Id<"invoices">

type Entry = Parameters<typeof groupBySettledReason>[0] extends
  | readonly (infer E)[]
  | undefined
  ? E
  : never

function entry(over: Partial<Entry>): Entry {
  return {
    durationMinutes: 60,
    isBillable: true,
    billableRate: 100,
    invoiceId: undefined,
    invoicePrefix: undefined,
    invoiceNumber: undefined,
    settledAt: undefined,
    settledReason: undefined,
    ...over,
  }
}

describe("groupBySettledReason — empty input", () => {
  it("returns zeroed groups when undefined", () => {
    const out = groupBySettledReason(undefined)
    expect(out.total).toEqual({ minutes: 0, amount: 0, entryCount: 0 })
    expect(out.retainer.entryCount).toBe(0)
    expect(out.invoiced.entryCount).toBe(0)
  })

  it("returns zeroed groups when empty array", () => {
    expect(groupBySettledReason([]).total.entryCount).toBe(0)
  })
})

describe("groupBySettledReason — single-bucket splits", () => {
  it("routes retainer-included entries to `retainer`, no amount (revenue lives elsewhere)", () => {
    // Retainer-included entries cost nothing extra — revenue is the
    // monthly fee that's billed via Stripe, not via this tool. So the
    // amount column reads $0 even though billableRate > 0.
    const out = groupBySettledReason([
      entry({ durationMinutes: 60, settledAt: 1, settledReason: "retainer_included" }),
      entry({ durationMinutes: 120, settledAt: 2, settledReason: "retainer_included" }),
    ])
    expect(out.retainer).toMatchObject({
      minutes: 180,
      amount: 0, // intentional — no revenue from retainer-included hours
      entryCount: 2,
      invoices: [],
    })
  })

  it("routes invoiced entries to `invoiced` with amount = hours × billableRate", () => {
    const out = groupBySettledReason([
      entry({
        durationMinutes: 90,
        billableRate: 200,
        settledAt: 1,
        settledReason: "invoiced",
        invoiceId: inv("inv_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
    ])
    expect(out.invoiced).toMatchObject({
      minutes: 90,
      amount: 300, // (90/60) * 200
      entryCount: 1,
    })
    expect(out.invoiced.invoices).toEqual([
      { id: inv("inv_a"), prefix: "INV-", number: 38 },
    ])
  })

  it("routes fixed-included entries to `fixed`, no amount", () => {
    const out = groupBySettledReason([
      entry({ durationMinutes: 60, settledAt: 1, settledReason: "fixed_included" }),
    ])
    expect(out.fixed).toMatchObject({ minutes: 60, amount: 0, entryCount: 1 })
  })

  it("routes unsettled-with-invoice entries to `draft`", () => {
    const out = groupBySettledReason([
      entry({
        durationMinutes: 60,
        invoiceId: inv("draft_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 50,
      }),
    ])
    expect(out.draft.entryCount).toBe(1)
    expect(out.draft.invoices).toEqual([
      { id: inv("draft_a"), prefix: "INV-", number: 50 },
    ])
    // Sanity: the entry must NOT appear in `invoiced` (no settledAt yet).
    expect(out.invoiced.entryCount).toBe(0)
  })

  it("routes truly-unbilled billable entries to `open`", () => {
    const out = groupBySettledReason([
      entry({ durationMinutes: 60 }), // billable, no invoice, not settled
    ])
    expect(out.open.entryCount).toBe(1)
    expect(out.draft.entryCount).toBe(0)
    expect(out.invoiced.entryCount).toBe(0)
  })

  it("routes non-billable entries to `nonBillable` even when settled", () => {
    // Settled non-billable rows are locked but their financial axis is
    // still `non_billable` — they don't show up in the drill-down's
    // covered/invoiced columns because they generate no revenue and
    // aren't part of the retainer-included totals.
    const out = groupBySettledReason([
      entry({
        durationMinutes: 30,
        isBillable: false,
        settledAt: 1,
        settledReason: "retainer_included",
      }),
    ])
    expect(out.nonBillable.entryCount).toBe(1)
    expect(out.retainer.entryCount).toBe(0)
  })
})

describe("groupBySettledReason — mixed period (the headline drill-down case)", () => {
  it("splits a month that has both retainer-included AND invoiced overage", () => {
    // The case from the parent PRD § UI Changes → Period detail.
    // 20h covered by retainer + 5h overage invoiced as $1,000 on INV-038.
    const out = groupBySettledReason([
      entry({
        durationMinutes: 20 * 60,
        settledAt: 1,
        settledReason: "retainer_included",
      }),
      entry({
        durationMinutes: 5 * 60,
        billableRate: 200,
        settledAt: 2,
        settledReason: "invoiced",
        invoiceId: inv("inv_038"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
    ])
    expect(out.retainer.minutes).toBe(20 * 60)
    expect(out.invoiced.minutes).toBe(5 * 60)
    expect(out.invoiced.amount).toBe(1000)
    expect(out.invoiced.invoices).toEqual([
      { id: inv("inv_038"), prefix: "INV-", number: 38 },
    ])
    expect(out.total.minutes).toBe(25 * 60)
  })

  it("de-duplicates invoice references across multiple line entries", () => {
    // A single invoice can carry many time entries (the common case).
    // The link-out chip should only render once per invoice.
    const out = groupBySettledReason([
      entry({
        durationMinutes: 60,
        settledAt: 1,
        settledReason: "invoiced",
        invoiceId: inv("inv_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
      entry({
        durationMinutes: 90,
        settledAt: 2,
        settledReason: "invoiced",
        invoiceId: inv("inv_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
    ])
    expect(out.invoiced.invoices).toHaveLength(1)
    expect(out.invoiced.minutes).toBe(150)
  })

  it("keeps multiple invoice references when a period has more than one invoice", () => {
    const out = groupBySettledReason([
      entry({
        settledAt: 1,
        settledReason: "invoiced",
        invoiceId: inv("inv_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
      entry({
        settledAt: 2,
        settledReason: "invoiced",
        invoiceId: inv("inv_b"),
        invoicePrefix: "INV-",
        invoiceNumber: 39,
      }),
    ])
    expect(out.invoiced.invoices).toHaveLength(2)
  })
})

describe("groupBySettledReason — totals contract", () => {
  it("totals.amount only counts billable revenue (skips retainer-included and fixed-included)", () => {
    // Per the schema invariant in Slice 1: `settledReason === \"invoiced\"`
    // is the ONLY revenue-bearing bucket. retainer-included and
    // fixed-included are zero-revenue, billed elsewhere.
    const out = groupBySettledReason([
      entry({
        durationMinutes: 60,
        billableRate: 100,
        settledAt: 1,
        settledReason: "retainer_included",
      }),
      entry({
        durationMinutes: 60,
        billableRate: 100,
        settledAt: 2,
        settledReason: "invoiced",
        invoiceId: inv("inv_a"),
        invoicePrefix: "INV-",
        invoiceNumber: 38,
      }),
    ])
    // totals.amount sums billable amounts regardless of reason (it's a
    // utility for the totals row); the financial split below is what
    // the user actually consumes.
    expect(out.invoiced.amount).toBe(100)
    expect(out.retainer.amount).toBe(0)
  })
})

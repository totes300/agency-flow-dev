import { describe, it, expect } from "vitest"
import { groupByCloseState } from "./period-detail-sheet"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * Pure aggregator behind the period drill-down's covered-vs-invoiced split.
 * The drill-down is the only UI surface that splits a row's collapsed
 * `Closed` back into how it was settled — by the kind of the close.
 */

const inv = (s: string) => s as unknown as Id<"invoices">

type Entry = Parameters<typeof groupByCloseState>[0] extends
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
    ...over,
  }
}

const retainerFinal = { closeStatus: "final" as const, closeKind: "retainer" as const, billableRate: 0 }
const tmFinal = (n: number) => ({
  closeStatus: "final" as const,
  closeKind: "t_and_m" as const,
  invoiceId: inv(`inv_${n}`),
  invoicePrefix: "INV-",
  invoiceNumber: n,
})

describe("groupByCloseState — empty input", () => {
  it("returns zeroed groups when undefined", () => {
    const out = groupByCloseState(undefined)
    expect(out.total).toEqual({ minutes: 0, amount: 0, entryCount: 0 })
    expect(out.retainer.entryCount).toBe(0)
    expect(out.invoiced.entryCount).toBe(0)
  })

  it("returns zeroed groups when empty array", () => {
    expect(groupByCloseState([]).total.entryCount).toBe(0)
  })
})

describe("groupByCloseState — single-bucket splits", () => {
  it("routes final retainer closes to `retainer`, with no amount", () => {
    const out = groupByCloseState([
      entry({ durationMinutes: 60, ...retainerFinal }),
      entry({ durationMinutes: 120, ...retainerFinal }),
    ])
    expect(out.retainer).toMatchObject({ minutes: 180, amount: 0, entryCount: 2, invoices: [] })
  })

  it("links a retainer close's overage invoice", () => {
    const out = groupByCloseState([
      entry({ ...retainerFinal, invoiceId: inv("inv_9"), invoicePrefix: "INV-", invoiceNumber: 9 }),
    ])
    expect(out.retainer.invoices).toEqual([{ id: inv("inv_9"), prefix: "INV-", number: 9 }])
  })

  it("routes final T&M closes to `invoiced` with amount = hours × billableRate", () => {
    const out = groupByCloseState([entry({ durationMinutes: 90, billableRate: 200, ...tmFinal(38) })])
    expect(out.invoiced).toMatchObject({ minutes: 90, amount: 300, entryCount: 1 })
    expect(out.invoiced.invoices).toEqual([{ id: inv("inv_38"), prefix: "INV-", number: 38 }])
  })

  it("routes draft closes to `draft`", () => {
    const out = groupByCloseState([
      entry({ closeStatus: "draft", closeKind: "t_and_m", invoiceId: inv("d"), invoicePrefix: "INV-", invoiceNumber: 50 }),
    ])
    expect(out.draft.entryCount).toBe(1)
    expect(out.draft.invoices).toEqual([{ id: inv("d"), prefix: "INV-", number: 50 }])
    expect(out.invoiced.entryCount).toBe(0)
  })

  it("routes open billable entries to `open`", () => {
    const out = groupByCloseState([entry({})])
    expect(out.open.entryCount).toBe(1)
    expect(out.draft.entryCount).toBe(0)
  })

  it("routes non-billable entries to `nonBillable` even when closed", () => {
    const out = groupByCloseState([entry({ durationMinutes: 30, isBillable: false, ...retainerFinal })])
    expect(out.nonBillable.entryCount).toBe(1)
    expect(out.retainer.entryCount).toBe(0)
  })
})

describe("groupByCloseState — invoice references", () => {
  it("de-duplicates invoice references across entries", () => {
    const out = groupByCloseState([entry(tmFinal(38)), entry({ durationMinutes: 90, ...tmFinal(38) })])
    expect(out.invoiced.invoices).toHaveLength(1)
    expect(out.invoiced.minutes).toBe(150)
  })

  it("keeps every invoice when a period has more than one", () => {
    const out = groupByCloseState([entry(tmFinal(38)), entry(tmFinal(39))])
    expect(out.invoiced.invoices).toHaveLength(2)
  })
})

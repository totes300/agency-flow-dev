import { formatShortDate, formatInvoiceNumber } from "@/lib/format"
import { entryStatus } from "@/convex/lib/entryStatus"

/**
 * Day-group header "reference" subtitle. The header carries the reference,
 * not the row: a day closed within a retainer budget shows `Closed · Mar 1–31`
 * (the close's period); a day on one invoice shows `Closed · INV-038`
 * (`Draft · INV-038` while that invoice is a draft).
 *
 * Rules (in order):
 *   1. Every billable entry settled by a final close with no invoice, all
 *      for the SAME period → period ref.
 *   2. Every billable entry on the SAME invoice → invoice ref ("Draft" if
 *      any entry's close is still a draft).
 *   3. Otherwise → null (mixed states fall back to per-row badges).
 *
 * Non-billable-only groups → null (the row badges already say so).
 */

type EntryShape = {
  isBillable: boolean
  invoiceId?: string
  invoicePrefix?: string
  invoiceNumber?: number
  closeStatus?: "draft" | "final"
  closePeriodStart?: string
  closePeriodEnd?: string
}

export type GroupReference =
  | { kind: "period"; label: string; periodStart: string; periodEnd: string }
  | { kind: "invoice"; label: string; invoiceLabel: string; isDraft: boolean }
  | null

export function deriveGroupReference(
  entries: readonly EntryShape[],
): GroupReference {
  const billable = entries.filter((e) => e.isBillable)
  if (billable.length === 0) return null

  // Period reference: every billable entry was closed without an invoice
  // (within budget) in the same period.
  const first = billable[0]
  const samePeriodNoInvoice =
    first.closePeriodStart !== undefined &&
    first.closePeriodEnd !== undefined &&
    billable.every(
      (e) =>
        e.closeStatus === "final" &&
        e.invoiceId === undefined &&
        e.closePeriodStart === first.closePeriodStart &&
        e.closePeriodEnd === first.closePeriodEnd,
    )
  if (samePeriodNoInvoice && first.closePeriodStart && first.closePeriodEnd) {
    return {
      kind: "period",
      label: `Closed · ${formatShortDate(first.closePeriodStart)}–${formatShortDate(first.closePeriodEnd)}`,
      periodStart: first.closePeriodStart,
      periodEnd: first.closePeriodEnd,
    }
  }

  // Invoice reference: every billable entry shares the same invoice (its
  // close's), draft or final. `listProjectEntries` denormalizes the number;
  // an unnumbered draft has none and gets no consolidated reference.
  const allSameInvoice = billable.every(
    (e) => e.invoiceId !== undefined && e.invoiceId === billable[0].invoiceId,
  )
  if (allSameInvoice && billable[0].invoiceId) {
    const sample = billable.find(
      (e) => e.invoicePrefix !== undefined && e.invoiceNumber !== undefined,
    )
    if (sample && sample.invoicePrefix && sample.invoiceNumber != null) {
      const invoiceLabel = formatInvoiceNumber(sample.invoicePrefix, sample.invoiceNumber)
      // Even one draft entry forces the header to read "Draft" so the user
      // doesn't think the invoice is final.
      const hasDraft = billable.some((e) => entryStatus(e) === "draft")
      return {
        kind: "invoice",
        label: `${hasDraft ? "Draft" : "Closed"} · ${invoiceLabel}`,
        invoiceLabel,
        isDraft: hasDraft,
      }
    }
  }

  return null
}

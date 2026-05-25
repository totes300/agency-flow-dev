import { formatShortDate, formatInvoiceNumber } from "@/lib/format"
import { entryStatus } from "@/convex/lib/entryStatus"

/**
 * Phase 8 Slice 4 — derive the day-group header's "reference" subtitle.
 *
 * Parent PRD § UI Changes → Time entry list:
 *
 *   The day-group header carries the reference, not the row. A closed
 *   day shows `Closed · Mar 1–31` (period boundary). An invoiced day
 *   shows `Closed · INV-038` (invoice number). The row badge isn't
 *   repeated per row in the header text — the header is the consolidated
 *   label.
 *
 * Rules (in order):
 *   1. If every billable entry in the group is settled by the SAME
 *      retainer period (matching `settledPeriodStart/End`) → period ref.
 *   2. If every billable entry is settled by (or staged on) the SAME
 *      invoice → invoice ref ("Draft · INV-038" if any entry is still
 *      `draft`, "Closed · INV-038" otherwise).
 *   3. Otherwise → null (no consolidated reference; group has mixed
 *      states and falls back to per-row badges).
 *
 * Non-billable-only groups → null (the row badges already say so).
 */

type EntryShape = {
  isBillable: boolean
  invoiceId?: string
  invoicePrefix?: string
  invoiceNumber?: number
  settledAt?: number
  settledReason?: "invoiced" | "retainer_included" | "fixed_included"
  settledPeriodStart?: string
  settledPeriodEnd?: string
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

  // Period reference: every billable entry shares the same monthly
  // boundary AND every entry has `settledReason === "retainer_included"`
  // (the period close is what gives a consolidated period reference —
  // an invoiced overage entry that happens to fall in March wouldn't
  // share a period ref because its surface is the invoice).
  const allRetainerIncluded = billable.every(
    (e) => e.settledReason === "retainer_included",
  )
  if (allRetainerIncluded) {
    const first = billable[0]
    if (first.settledPeriodStart && first.settledPeriodEnd) {
      const sameBoundary = billable.every(
        (e) =>
          e.settledPeriodStart === first.settledPeriodStart &&
          e.settledPeriodEnd === first.settledPeriodEnd,
      )
      if (sameBoundary) {
        const label = `Closed · ${formatShortDate(first.settledPeriodStart)}–${formatShortDate(first.settledPeriodEnd)}`
        return {
          kind: "period",
          label,
          periodStart: first.settledPeriodStart,
          periodEnd: first.settledPeriodEnd,
        }
      }
    }
  }

  // Invoice reference: every billable entry shares the same invoiceId
  // (the group has been routed onto one invoice, regardless of finalize
  // status). Use whichever entry has the prefix/number — they all do if
  // they all share invoiceId since `listProjectEntries` denormalizes.
  const allSameInvoice = billable.every(
    (e) => e.invoiceId !== undefined && e.invoiceId === billable[0].invoiceId,
  )
  if (allSameInvoice && billable[0].invoiceId) {
    const sample = billable.find(
      (e) => e.invoicePrefix !== undefined && e.invoiceNumber !== undefined,
    )
    if (sample && sample.invoicePrefix && sample.invoiceNumber != null) {
      const invoiceLabel = formatInvoiceNumber(sample.invoicePrefix, sample.invoiceNumber)
      // Use `entryStatus()` to detect any draft entry — even one draft
      // forces the header to read "Draft" so the user doesn't think the
      // invoice is final.
      const hasDraft = billable.some(
        (e) =>
          entryStatus({
            isBillable: e.isBillable,
            invoiceId: e.invoiceId as never,
            settledAt: e.settledAt,
          }) === "draft",
      )
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

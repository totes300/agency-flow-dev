import { formatShortDate, formatInvoiceNumber } from "@/lib/format"
import type { EntryCloseSnapshot } from "@/convex/lib/types"

/**
 * Hover tooltip for close-locked time-entry rows.
 *
 *   Closed {committed} · invoiced | included in retainer · {periodStart}–{periodEnd}
 *
 * A row whose close still has a draft invoice reads "On draft invoice
 * INV-038" (or "On a draft invoice" before it is numbered) — the document
 * is not issued yet.
 */
export function formatLockedTooltip(
  args: EntryCloseSnapshot & {
    invoicePrefix: string | undefined
    invoiceNumber: number | undefined
  },
): string | null {
  if (args.closeStatus === undefined) return null

  if (args.closeStatus === "draft") {
    return args.invoicePrefix && args.invoiceNumber != null
      ? `On draft invoice ${formatInvoiceNumber(args.invoicePrefix, args.invoiceNumber)}`
      : "On a draft invoice"
  }

  // A final T&M close billed the hour; a final retainer close covered it
  // (any overage is billed on the close's invoice, not per hour).
  const parts: string[] = []
  if (args.closedAt !== undefined) parts.push(`Closed ${formatShortDate(formatDateOnly(args.closedAt))}`)
  else parts.push("Closed")
  parts.push(args.closeKind === "t_and_m" ? "invoiced" : "included in retainer")
  if (args.closePeriodStart && args.closePeriodEnd) {
    parts.push(`${formatShortDate(args.closePeriodStart)}–${formatShortDate(args.closePeriodEnd)}`)
  }
  return parts.join(" · ")
}

/** Epoch-ms → YYYY-MM-DD (UTC). `formatShortDate` accepts YYYY-MM-DD. */
function formatDateOnly(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(d.getUTCDate()).padStart(2, "0")}`
}

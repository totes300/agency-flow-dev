import { formatShortDate, formatInvoiceNumber } from "@/lib/format"

/**
 * Phase 8 Slice 4 — hover tooltip for locked time-entry rows.
 *
 * Vocabulary contract (parent PRD § UI Changes → Time entry list):
 *
 *   Closed {settledAt} · included in retainer | fixed price | invoiced
 *                       · {settledPeriodStart}–{settledPeriodEnd}
 *
 * For Draft rows (invoiceId set, not yet settled) we render a simpler
 * "On draft invoice INV-038" line — the period boundary is meaningless
 * until the invoice finalizes.
 */

type ReasonClause = "included in retainer" | "covered by fixed price" | "invoiced"

const REASON_TO_CLAUSE: Record<
  "retainer_included" | "fixed_included" | "invoiced",
  ReasonClause
> = {
  retainer_included: "included in retainer",
  fixed_included: "covered by fixed price",
  invoiced: "invoiced",
}

export function formatLockedTooltip(args: {
  settledAt: number | undefined
  settledReason:
    | "retainer_included"
    | "fixed_included"
    | "invoiced"
    | undefined
  settledPeriodStart: string | undefined
  settledPeriodEnd: string | undefined
  invoicePrefix: string | undefined
  invoiceNumber: number | undefined
}): string | null {
  // Draft (on a draft invoice, not yet settled).
  if (args.settledAt === undefined) {
    if (args.invoicePrefix && args.invoiceNumber != null) {
      return `On draft invoice ${formatInvoiceNumber(args.invoicePrefix, args.invoiceNumber)}`
    }
    return null
  }

  // Closed (settled — three financial reasons collapse on the row badge,
  // but the tooltip splits them back out per spec wording).
  const settledOn = formatShortDate(formatDateOnly(args.settledAt))
  const reason = args.settledReason
    ? REASON_TO_CLAUSE[args.settledReason]
    : "settled"
  const period =
    args.settledPeriodStart && args.settledPeriodEnd
      ? `${formatShortDate(args.settledPeriodStart)}–${formatShortDate(args.settledPeriodEnd)}`
      : null

  const parts = [`Closed ${settledOn}`, reason]
  if (period) parts.push(period)
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

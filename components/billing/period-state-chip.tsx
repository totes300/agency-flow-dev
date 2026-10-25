import {
  INVOICE_STATUS_COPY,
  PERIOD_STATE_COPY,
  type InvoiceDisplayStatus,
  type PeriodState,
  type StateTone,
} from "@/convex/lib/billing/periodState"
import { ColoredPillBadge, type ColoredPillTone } from "@/components/ui/colored-pill-badge"

const TONE: Record<StateTone, ColoredPillTone> = {
  grey: "neutral",
  blue: "blue",
  amber: "amber",
  green: "green",
  red: "red",
}

/**
 * The period state chip (docs/prd-project-billing-redesign.md §5.2): the one
 * vocabulary on the period card, the Billing tab, the hub and the workspace.
 * Hover names what the state means.
 */
export function PeriodStateChip({ state, className }: { state: PeriodState; className?: string }) {
  const copy = PERIOD_STATE_COPY[state]
  return <ColoredPillBadge tone={TONE[copy.tone]} label={copy.chip} showDot title={copy.meaning} className={className} />
}

/** An invoice's status chip (Invoices views): Draft · Invoiced · Past due · Paid · Void. */
export function InvoiceStateChip({ status, className }: { status: InvoiceDisplayStatus; className?: string }) {
  const copy = INVOICE_STATUS_COPY[status]
  return <ColoredPillBadge tone={TONE[copy.tone]} label={copy.chip} showDot className={className} />
}

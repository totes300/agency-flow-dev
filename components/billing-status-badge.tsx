import { BanIcon, LockIcon } from "lucide-react"
import { StatusChip } from "@/components/ui/status-chip"

/**
 * Phase 8 Slice 4 — row-level vocabulary aligned with `entryStatus()`.
 *
 *   open         billable, no invoice, not settled    (action: needed)
 *   draft        billable, on a draft invoice         (locked, will finalize)
 *   closed       billable, settled (any reason)       (locked, archived)
 *   non_billable not billable                         (locked or not, neutral)
 *
 * The previous `uninvoiced` state is replaced by `open` so the chip
 * vocabulary matches what `entryStatus()` returns and what
 * `listProjectEntries` filters on (Slice 1). The financial reason behind a
 * `closed` row (retainer-included / invoiced overage / fixed-included)
 * lives in the period drill-down (Slice 4) and reports, never on the row.
 *
 * Built on `StatusChip` so these read as siblings of `Invoiced / Overdue /
 * Paid / Draft` on invoice-side surfaces — outlined chips, same anatomy.
 */
export type BillingState = "open" | "draft" | "closed" | "non_billable"

/** Backwards-compat: callers passing the old `uninvoiced` keep working. */
type LegacyBillingState = "uninvoiced"

export function BillingStatusBadge({
  state,
  className,
}: {
  state: BillingState | LegacyBillingState
  className?: string
}) {
  // Map the legacy `uninvoiced` to the new `open` so any straggler call
  // site keeps rendering correctly while Slice 4 ports them to `open`.
  const normalized: BillingState = state === "uninvoiced" ? "open" : state

  if (normalized === "non_billable") {
    return (
      <StatusChip
        data-slot="billing-status-badge"
        tone="neutral"
        leading={<BanIcon aria-hidden className="size-3 shrink-0" />}
        label="Non-billable"
        className={className}
      />
    )
  }

  if (normalized === "open") {
    return (
      <StatusChip
        data-slot="billing-status-badge"
        tone="neutral"
        label="Open"
        className={className}
      />
    )
  }

  if (normalized === "draft") {
    return (
      <StatusChip
        data-slot="billing-status-badge"
        tone="neutral"
        leading={<LockIcon aria-hidden className="size-3 shrink-0" />}
        label="Draft"
        className={className}
      />
    )
  }

  // closed
  return (
    <StatusChip
      data-slot="billing-status-badge"
      tone="green"
      leading={<LockIcon aria-hidden className="size-3 shrink-0" />}
      label="Closed"
      className={className}
    />
  )
}

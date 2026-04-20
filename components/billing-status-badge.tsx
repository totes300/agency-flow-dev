import { BanIcon } from "lucide-react"
import { StatusChip } from "@/components/ui/status-chip"

type BillingState = "non_billable" | "uninvoiced"

/**
 * Row-level state tag for time entries that aren't tied to an invoice yet.
 * Built on `StatusChip` so `Uninvoiced` and `Non-billable` read as siblings
 * of `Invoiced / Overdue / Paid / Draft` — all outlined chips, same anatomy.
 */
export function BillingStatusBadge({
  state,
  className,
}: {
  state: BillingState
  className?: string
}) {
  if (state === "non_billable") {
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

  return (
    <StatusChip
      data-slot="billing-status-badge"
      tone="neutral"
      label="Uninvoiced"
      className={className}
    />
  )
}

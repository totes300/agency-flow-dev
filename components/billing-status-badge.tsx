import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"

type BillingState = "non_billable" | "uninvoiced"

const LABELS: Record<BillingState, string> = {
  non_billable: "Non-billable",
  uninvoiced: "Uninvoiced",
}

/**
 * Muted tag for time-entry rows that aren't (yet) tied to an invoice. Uses
 * the `neutral` tone of {@link ColoredPillBadge} so it sits quieter than
 * status badges (which carry semantic color).
 */
export function BillingStatusBadge({
  state,
  className,
}: {
  state: BillingState
  className?: string
}) {
  return (
    <ColoredPillBadge
      data-slot="billing-status-badge"
      tone="neutral"
      label={LABELS[state]}
      className={className}
    />
  )
}

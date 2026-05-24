import { MetricCard } from "@/components/metric-card"
import { ProjectInvoicesFixedProgress } from "@/components/invoices/project-invoices-fixed-progress"
import { formatCurrency, pluralize } from "@/lib/format"

type Bucket = { count: number; amount: number }

export type ProjectInvoicesMetrics = {
  unpaid: Bucket
  pastDue: Bucket
  paidLifetime: Bucket
  fixedPrice: number
  fixedBilled: number
  fixedRemaining: number
  fixedPercentInvoiced: number
}

/**
 * Metric strip above the invoice list.
 *
 *   T&M      → Unpaid · Past due · Unbilled        (3 cards)
 *   Fixed    → Unpaid · Past due · Budget progress (3 cards)
 *   Retainer → Unpaid · Past due                   (2 cards; the 3rd slot is
 *              the retainer callout bar rendered by the parent, since it
 *              carries the primary action)
 *
 * Past due goes destructive only when count > 0 — a zero past-due card is a
 * healthy signal, not a warning.
 */
export function ProjectInvoicesPaymentCards({
  billingType,
  currency,
  metrics,
  openAmount,
}: {
  billingType: string
  currency: string
  metrics: ProjectInvoicesMetrics
  /** T&M only: open (unbilled, unsettled) time $ from the project overview query. */
  openAmount: number
}) {
  const cards = [
    <PaymentBucketCard
      key="unpaid"
      label="Unpaid"
      bucket={metrics.unpaid}
      currency={currency}
    />,
    <PaymentBucketCard
      key="past-due"
      label="Past due"
      bucket={metrics.pastDue}
      currency={currency}
      variant={metrics.pastDue.count > 0 ? "destructive" : "default"}
    />,
  ]

  if (billingType === "t_and_m") {
    cards.push(
      <MetricCard
        key="unbilled"
        label="Unbilled time"
        value={formatCurrency(openAmount, currency)}
      />,
    )
  } else if (billingType === "fixed") {
    cards.push(
      <ProjectInvoicesFixedProgress
        key="budget"
        billed={metrics.fixedBilled}
        budget={metrics.fixedPrice}
        currency={currency}
      />,
    )
  }
  // Retainer intentionally renders 2 cards; the callout bar owns the 3rd slot.

  const cols = cards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"
  return <div className={`grid grid-cols-2 gap-4 ${cols}`}>{cards}</div>
}

function PaymentBucketCard({
  label,
  bucket,
  currency,
  variant,
}: {
  label: string
  bucket: Bucket
  currency: string
  variant?: "default" | "destructive"
}) {
  return (
    <MetricCard
      label={label}
      value={String(bucket.count)}
      detail={
        bucket.count === 0
          ? formatCurrency(0, currency)
          : `${formatCurrency(bucket.amount, currency)} · ${bucket.count} ${pluralize(
              bucket.count,
              "invoice",
              "invoices",
            )}`
      }
      variant={variant}
    />
  )
}

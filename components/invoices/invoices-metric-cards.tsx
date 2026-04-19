import { MetricCard } from "@/components/metric-card"
import { formatCurrencyBucketDetail } from "@/lib/format"

export type InvoiceBucket = {
  count: number
  currencySums: Record<string, number>
}

export type InvoiceMetrics = {
  draft: InvoiceBucket
  outstanding: InvoiceBucket
  overdue: InvoiceBucket
  paidThisMonth: InvoiceBucket
}

export function InvoicesMetricCards({ metrics }: { metrics: InvoiceMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricCard
        label="Draft"
        value={String(metrics.draft.count)}
        detail={formatCurrencyBucketDetail(metrics.draft.currencySums)}
      />
      <MetricCard
        label="Outstanding"
        value={String(metrics.outstanding.count)}
        detail={formatCurrencyBucketDetail(metrics.outstanding.currencySums)}
      />
      <MetricCard
        label="Overdue"
        value={String(metrics.overdue.count)}
        detail={formatCurrencyBucketDetail(metrics.overdue.currencySums)}
        variant="destructive"
      />
      <MetricCard
        label="Paid this month"
        value={String(metrics.paidThisMonth.count)}
        detail={formatCurrencyBucketDetail(metrics.paidThisMonth.currencySums)}
      />
    </div>
  )
}

import { MetricCard } from "@/components/metric-card"
import { formatCurrencyBucketDetail } from "@/lib/format"

export type InvoiceBucket = {
  count: number
  currencySums: Record<string, number>
}

export type InvoiceMetrics = {
  draft: InvoiceBucket
  unpaid: InvoiceBucket
  pastDue: InvoiceBucket
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
        label="Unpaid"
        value={String(metrics.unpaid.count)}
        detail={formatCurrencyBucketDetail(metrics.unpaid.currencySums)}
      />
      <MetricCard
        label="Past due"
        value={String(metrics.pastDue.count)}
        detail={formatCurrencyBucketDetail(metrics.pastDue.currencySums)}
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

import { formatCurrency } from "@/lib/format"
import { CloseQueueRow } from "@/components/billing/close-queue-row"
import type { CloseQueueRow as QueueRow } from "@/convex/billingViews"

/**
 * A calendar-month section in the Close queue: a static header carrying the
 * "N of M closed" progress and the per-currency month total, with the queue
 * rows below inside a bordered card so consecutive months read as clearly
 * separated blocks.
 *
 * This is an action table — every row is always visible (no collapse), and
 * progress reflects the month's real state (open + already-committed) even
 * when facet filters hide some open rows; the money total is computed from
 * the rows actually shown.
 */
export function CloseQueueMonthGroup({
  label,
  rows,
  closedCount,
  totalCount,
}: {
  label: string
  rows: QueueRow[]
  closedCount: number
  totalCount: number
}) {
  // Month total from the visible rows only (close rows carry no amount).
  const totals: Record<string, number> = {}
  for (const r of rows) {
    if (r.isCloseRow) continue
    totals[r.currency] = Math.round(((totals[r.currency] ?? 0) + r.amount) * 100) / 100
  }
  const totalLabel = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .map(([currency, amount]) => formatCurrency(amount, currency))
    .join(" · ")

  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 px-1">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {closedCount} of {totalCount} closed
        </span>
        <span className="ml-auto text-sm font-medium tabular-nums">
          {totalLabel || null}
        </span>
      </div>

      <div className="divide-y rounded-lg border">
        {rows.map((row) => (
          <CloseQueueRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  )
}

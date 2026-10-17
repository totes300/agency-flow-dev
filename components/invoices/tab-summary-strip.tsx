"use client"

import { formatCurrency } from "@/lib/format"
import { fromMinor } from "@/convex/lib/billing/money"
import type { ListRow } from "@/lib/invoices/list-rows"
import type { InvoiceStatusTab } from "@/lib/invoices/status-tab"

/**
 * Per-tab amount summary strip rendered between the filter bar and the
 * invoice list. Aggregates `totalMinor` per currency over whatever rows are
 * currently visible (so it respects active filters and search), converting
 * once for display.
 *
 * Multi-currency: stays inline, separated by middots, ordered by amount
 * descending. Symbol-only formatting (matches the top metric cards).
 *
 * Outstanding tab: also computes the overdue subset (status `invoiced` and
 * `dueDate < today` in the org timezone, mirroring `InvoiceStatusBadge`'s
 * isOverdue rule) and renders a muted subline with overdue per-currency
 * sums + count. The top red Overdue card stays canonical for urgency; this
 * subline is just the totals split for the table you're looking at.
 *
 * Hidden when there are zero rows — nothing useful to total.
 */
export function TabSummaryStrip({
  rows,
  tab,
  timezone,
}: {
  rows: ListRow[]
  tab: InvoiceStatusTab
  timezone: string
}) {
  // Aggregation is O(rows) and the parent rebuilds `rows` every render, so
  // a useMemo here would never hit cache. The pass is cheap; just compute.
  const summary = buildSummary(rows, tab, timezone)

  if (summary === null) return null

  const { totalsByCurrency, count, overdue } = summary
  const currencies = sortCurrenciesDesc(totalsByCurrency)
  const noun = countNounForTab(tab, count)

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
        <span className="text-muted-foreground">Total:</span>
        {currencies.map((cur, idx) => (
          <span key={cur} className="font-medium">
            {idx > 0 && <span className="mr-2 text-muted-foreground">·</span>}
            {formatCurrency(totalsByCurrency[cur], cur)}
          </span>
        ))}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {count} {noun}
      </span>
      {overdue !== null && overdue.count > 0 && (
        <div className="flex w-full flex-wrap items-baseline gap-x-2 pl-12 text-xs tabular-nums text-muted-foreground">
          {sortCurrenciesDesc(overdue.totalsByCurrency).map((cur, idx) => (
            <span key={cur}>
              {idx > 0 && <span className="mr-2">·</span>}
              {formatCurrency(overdue.totalsByCurrency[cur], cur)}
            </span>
          ))}
          <span>
            of which overdue ({overdue.count})
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Aggregation ────────────────────────────────────────────────────────────────

type Summary = {
  totalsByCurrency: Record<string, number>
  count: number
  overdue: { totalsByCurrency: Record<string, number>; count: number } | null
}

function buildSummary(
  rows: ListRow[],
  tab: InvoiceStatusTab,
  timezone: string,
): Summary | null {
  if (rows.length === 0) return null

  const totalsByCurrency: Record<string, number> = {}
  let count = 0

  // Outstanding overdue subset — only computed for that tab.
  const overdueTotals: Record<string, number> = {}
  let overdueCount = 0
  const todayInTz =
    tab === "outstanding" ? todayYMDInTimezone(timezone) : null

  for (const row of rows) {
    const inv = row.invoice
    add(totalsByCurrency, inv.currency, inv.totalMinor)
    count += 1

    if (
      todayInTz !== null &&
      inv.status === "invoiced" &&
      inv.dueDate != null &&
      inv.dueDate < todayInTz
    ) {
      add(overdueTotals, inv.currency, inv.totalMinor)
      overdueCount += 1
    }
  }

  // Drop currencies that summed to zero (e.g. a refund/cancellation pair).
  for (const cur of Object.keys(totalsByCurrency)) {
    if (totalsByCurrency[cur] === 0) delete totalsByCurrency[cur]
  }

  return {
    totalsByCurrency: toDisplay(totalsByCurrency),
    count,
    overdue:
      tab === "outstanding"
        ? { totalsByCurrency: toDisplay(overdueTotals), count: overdueCount }
        : null,
  }
}

function add(map: Record<string, number>, currency: string, amountMinor: number) {
  map[currency] = (map[currency] ?? 0) + amountMinor
}

function toDisplay(minorByCurrency: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(minorByCurrency).map(([cur, minor]) => [cur, fromMinor(minor, cur)]),
  )
}

function sortCurrenciesDesc(map: Record<string, number>): string[] {
  return Object.keys(map).sort((a, b) => map[b] - map[a])
}

function countNounForTab(tab: InvoiceStatusTab, count: number): string {
  const single = count === 1
  switch (tab) {
    case "close":
      // The Close tab mixes Generate rows with within-budget "Close &
      // report" rows, so the noun is action-neutral.
      return single ? "billing action" : "billing actions"
    case "draft":
      return single ? "draft" : "drafts"
    case "outstanding":
      return single ? "invoice" : "invoices"
    case "paid":
      return single ? "paid invoice" : "paid invoices"
    case "void":
      return "voided"
  }
}

// Mirrors `InvoiceStatusBadge`'s isOverdue rule — en-CA gives YYYY-MM-DD,
// timeZone projects today into the org's calendar so a UTC midnight stamp
// doesn't shift the boundary for negative-offset orgs.
function todayYMDInTimezone(timezone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: timezone })
}

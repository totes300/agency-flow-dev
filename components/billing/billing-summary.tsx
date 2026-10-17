"use client"

import Link from "next/link"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency, pluralize } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The Billing hub's three headline numbers — what is waiting to be invoiced,
 * what can be closed without an invoice, and what clients owe. Each tile
 * links to the tab where you act on it. Multi-currency sums never mix: each
 * currency is shown on its own.
 */
export function BillingSummary({
  readyAmountByCurrency,
  readyCount,
  closeCount,
  outstandingByCurrency,
  outstandingCount,
  overdueCount,
}: {
  readyAmountByCurrency: Record<string, number>
  readyCount: number
  closeCount: number
  outstandingByCurrency: Record<string, number>
  outstandingCount: number
  overdueCount: number
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SummaryTile
        href="/billing"
        label="Ready to invoice"
        value={formatAmounts(readyAmountByCurrency)}
        detail={readyCount > 0 ? `${readyCount} ${pluralize(readyCount, "period", "periods")}` : "Nothing to invoice"}
      />
      <SummaryTile
        href="/billing"
        label="Close without invoice"
        value={String(closeCount)}
        detail={closeCount > 0 ? "Within budget" : "Nothing to close"}
      />
      <SummaryTile
        href="/billing?status=outstanding"
        label="Outstanding"
        value={formatAmounts(outstandingByCurrency)}
        detail={
          overdueCount > 0
            ? `${overdueCount} overdue`
            : outstandingCount > 0
              ? `${outstandingCount} ${pluralize(outstandingCount, "invoice", "invoices")}`
              : "Nothing outstanding"
        }
        detailTone={overdueCount > 0 ? "danger" : "muted"}
      />
    </div>
  )
}

function SummaryTile({
  href,
  label,
  value,
  detail,
  detailTone = "muted",
}: {
  href: string
  label: string
  value: string
  detail: string
  detailTone?: "muted" | "danger"
}) {
  return (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card size="sm" className="transition-colors hover:bg-muted/40">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle>
            <span className="text-2xl font-semibold tabular-nums tracking-tight">{value}</span>
          </CardTitle>
          <p className={cn("text-xs", detailTone === "danger" ? "text-destructive" : "text-muted-foreground")}>
            {detail}
          </p>
        </CardHeader>
      </Card>
    </Link>
  )
}

/** "$4,880" — or "$4,880 · €300" across currencies; "—" when empty. */
function formatAmounts(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency).filter(([, v]) => v !== 0)
  if (entries.length === 0) return "—"
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cur, v]) => formatCurrency(v, cur))
    .join(" · ")
}

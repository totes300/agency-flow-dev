"use client"

import { formatCurrency, formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

export type RetainerUsageRow = {
  label: string
  availableMinutes: number
  usedMinutes: number
  balanceMinutes: number
}

export type RetainerUsageTotal = {
  availableMinutes: number
  usedMinutes: number
  balanceMinutes: number
  amountDue?: number
}

/**
 * Shared retainer usage table for invoice and monthly report documents.
 * Currency, totalLabel, balanceLabel, and subtitle are passed in — this
 * component owns nothing about copy or money formatting other than rendering.
 */
export function RetainerUsageTable({
  title = "Retainer usage",
  subtitle,
  rows,
  total,
  totalLabel,
  balanceLabel = "Balance",
  currency,
  showPayment = true,
}: {
  title?: string
  subtitle?: string
  rows: RetainerUsageRow[]
  total: RetainerUsageTotal
  totalLabel: string
  balanceLabel?: string
  currency: string
  showPayment?: boolean
}) {
  const isOverBudget = total.balanceMinutes < 0
  const amountDue = total.amountDue ?? 0

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <table className="w-full text-sm">
        <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 text-left font-semibold">Month</th>
            <th className="px-3 py-2 text-right font-semibold">Available</th>
            <th className="px-3 py-2 text-right font-semibold">Used</th>
            <th className="py-2 pl-3 text-right font-semibold">{balanceLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.label}
              className={cn(index < rows.length - 1 && "border-b")}
            >
              <td className="py-3 pr-3 font-medium">{row.label}</td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatMinutes(row.availableMinutes)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatMinutes(row.usedMinutes)}
              </td>
              <td
                className={cn(
                  "py-3 pl-3 text-right font-semibold tabular-nums",
                  row.balanceMinutes < 0
                    ? "text-destructive"
                    : "text-emerald-700 dark:text-emerald-400",
                )}
              >
                {formatSignedMinutes(row.balanceMinutes)}
              </td>
            </tr>
          ))}

          <tr className="bg-muted/70">
            <td className="px-3 py-3 font-semibold">
              {totalLabel}
            </td>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">
              {formatMinutes(total.availableMinutes)}
            </td>
            <td className="px-3 py-3 text-right font-semibold tabular-nums">
              {formatMinutes(total.usedMinutes)}
            </td>
            <td
              className={cn(
                "px-3 py-3 text-right font-semibold tabular-nums",
                isOverBudget
                  ? "text-destructive"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isOverBudget
                ? showPayment
                  ? `${formatMinutes(Math.abs(total.balanceMinutes))} over budget · ${formatCurrency(amountDue, currency)} to pay`
                  : `${formatMinutes(Math.abs(total.balanceMinutes))} over budget`
                : showPayment
                  ? `${formatMinutes(total.balanceMinutes)} left · ${formatCurrency(0, currency)} to pay`
                  : `${formatMinutes(total.balanceMinutes)} left`}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function formatSignedMinutes(minutes: number): string {
  if (minutes === 0) return formatMinutes(0)
  return `${minutes > 0 ? "+" : "-"}${formatMinutes(Math.abs(minutes))}`
}

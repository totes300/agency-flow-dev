"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { BudgetRing } from "@/components/ui/budget-ring"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCurrency, formatHoursShort, pluralize } from "@/lib/format"
import type { CloseQueueRow } from "@/convex/billingViews"

/**
 * One project-period in the Close queue, on a single line like a payments
 * list: period, project, client, what closing it does (status chip), time
 * against budget, and the amount it bills. The amount carries the
 * weight; logged hours are regular with a retainer's budget muted beside them
 * and a thin grey `BudgetRing` as the glanceable signal — no colored overage. The whole row opens the Close
 * workspace, where the period is reviewed and committed; the button names
 * the outcome ("Create invoice" / "Close period"). For an over-budget
 * retainer without an overage rate, that action routes to the project's
 * settings instead.
 */
export function CloseQueueRow({ row }: { row: CloseQueueRow }) {
  const router = useRouter()
  const workspaceHref = `/billing/close/${row.projectId}/${row.periodToken}`
  const settingsHref = `/projects/${row.projectId}?tab=settings`
  const needsRate = row.configIssue === "missing-overage-rate"
  const hasBudget = row.billingType === "retainer" && row.includedMinutes > 0

  return (
    <TableRow
      className="group h-12 cursor-pointer"
      onClick={() => router.push(workspaceHref)}
    >
      <TableCell className="max-w-0 truncate pl-3 font-medium">
        {row.periodLabel}
        {row.pendingPeriods > 0 && (
          <span
            className="ml-2 text-xs font-normal text-muted-foreground"
            title={`${row.pendingPeriods} more ${pluralize(row.pendingPeriods, "period", "periods")} waiting`}
          >
            +{row.pendingPeriods} more
          </span>
        )}
      </TableCell>
      <TableCell className="max-w-0 truncate font-medium">{row.projectName}</TableCell>
      <TableCell className="hidden max-w-0 truncate text-muted-foreground md:table-cell">
        {row.clientName}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <OutcomeChip row={row} />
      </TableCell>
      <TableCell className="hidden text-right tabular-nums lg:table-cell">
        {row.loggedMinutes === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center gap-2">
            {hasBudget && <BudgetRing used={row.loggedMinutes} budget={row.includedMinutes} />}
            <span>
              {formatHoursShort(row.loggedMinutes)}
              {hasBudget && (
                <span className="text-muted-foreground"> / {formatHoursShort(row.includedMinutes)}</span>
              )}
            </span>
          </span>
        )}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {row.isCloseRow ? (
          <span className="font-normal text-muted-foreground">—</span>
        ) : (
          formatCurrency(row.amount, row.currency)
        )}
      </TableCell>
      <TableCell className="hidden pr-3 text-right sm:table-cell" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" asChild>
          <Link href={needsRate ? settingsHref : workspaceHref}>
            {needsRate ? "Set overage rate" : row.isCloseRow ? "Close period" : "Create invoice"}
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** What closing this period produces — an invoice, a no-charge close, or a blocker. */
function OutcomeChip({ row }: { row: CloseQueueRow }) {
  if (row.configIssue === "missing-overage-rate") {
    return <ColoredPillBadge tone="amber" showDot label="Needs overage rate" />
  }
  if (row.isCloseRow) {
    return <ColoredPillBadge tone="green" showDot label="Within budget" />
  }
  return <ColoredPillBadge tone="blue" showDot label="Ready to invoice" />
}

"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCurrency, formatHoursShort, pluralize } from "@/lib/format"
import type { CloseQueueRow } from "@/convex/billingViews"

/**
 * One project in the Close queue. Three things only: what it is (project,
 * then client · period · how many periods wait behind it), how much time it
 * carries against its budget, and what closing it bills. The button names the
 * outcome — "Create invoice" or "Close period" — and, like the row itself,
 * opens the Close workspace, where the period is reviewed and committed.
 * An over-budget retainer without an overage rate routes to the project's
 * settings instead.
 */
export function CloseQueueRow({ row }: { row: CloseQueueRow }) {
  const router = useRouter()
  const workspaceHref = `/billing/close/${row.projectId}/${row.periodToken}`
  const isRetainer = row.billingType === "retainer"
  const overageMinutes = row.overageHours != null ? Math.round(row.overageHours * 60) : 0

  return (
    <TableRow className="cursor-pointer" onClick={() => router.push(workspaceHref)}>
      <TableCell className="max-w-0 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium">{row.projectName}</span>
          <span className="truncate text-xs text-muted-foreground">
            {row.clientName} · {row.periodLabel}
            {row.pendingPeriods > 0 &&
              ` · ${row.pendingPeriods} more ${pluralize(row.pendingPeriods, "period", "periods")} waiting`}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden py-3 text-right tabular-nums md:table-cell">
        {row.loggedMinutes === 0 ? (
          <span className="text-muted-foreground">No time</span>
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <span>
              {formatHoursShort(row.loggedMinutes)}
              {isRetainer && (
                <span className="text-muted-foreground"> / {formatHoursShort(row.includedMinutes)}</span>
              )}
            </span>
            {overageMinutes > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-500">
                {formatHoursShort(overageMinutes)} over
              </span>
            )}
          </div>
        )}
      </TableCell>
      <TableCell className="py-3 text-right tabular-nums">
        {row.isCloseRow ? (
          <span className="text-muted-foreground">No charge</span>
        ) : (
          <span className="font-medium">{formatCurrency(row.amount, row.currency)}</span>
        )}
      </TableCell>
      <TableCell className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
        {row.configIssue === "missing-overage-rate" ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/projects/${row.projectId}?tab=settings`}>Set overage rate</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href={workspaceHref}>{row.isCloseRow ? "Close period" : "Create invoice"}</Link>
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

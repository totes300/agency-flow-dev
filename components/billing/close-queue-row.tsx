"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatHoursCompact } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseQueueRow } from "@/convex/billingViews"

const BILLING_TYPE_META: Record<
  CloseQueueRow["billingType"],
  { label: string; dot: string }
> = {
  retainer: { label: "Retainer", dot: "bg-emerald-500" },
  t_and_m: { label: "T&M", dot: "bg-sky-500" },
  fixed: { label: "Fixed", dot: "bg-violet-500" },
  non_billable: { label: "Non-billable", dot: "bg-muted-foreground" },
}

/**
 * One queue row in the month card — strictly single-line: project (primary) +
 * client (muted, same line), billing type as dot + muted text, hours colored
 * by budget with the overage inline (never wrapping), "N to review" muted,
 * amount right-aligned, and an always-visible quiet Review button — this is an
 * action table, so the CTA is never hidden behind hover.
 *
 * Over-budget rows missing an overage rate route to Set rate instead of Review.
 */
export function CloseQueueRow({ row }: { row: CloseQueueRow }) {
  const meta = BILLING_TYPE_META[row.billingType]

  return (
    <div className="flex h-12 items-center gap-3 px-3 text-sm hover:bg-muted/30">
      {/* Project + client */}
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-medium">{row.projectName}</span>
        <span className="truncate text-muted-foreground">{row.clientName}</span>
      </div>

      {/* Billing type — dot + muted text, never a pill */}
      <span className="hidden w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
        {meta.label}
      </span>

      {/* Hours, colored by budget state — overage inline, never wrapping */}
      <span
        className={cn(
          "w-36 shrink-0 whitespace-nowrap text-right tabular-nums",
          row.badgeKind === "over-budget"
            ? "text-amber-600 dark:text-amber-500"
            : row.badgeKind === "within-budget"
              ? "text-emerald-600 dark:text-emerald-500"
              : "text-muted-foreground",
        )}
      >
        {formatHoursCompact(row.loggedMinutes)}
        {row.badgeKind === "over-budget" && row.overageHours != null && (
          <span className="ml-1 text-xs">
            (+{formatHoursCompact(Math.round(row.overageHours * 60))})
          </span>
        )}
      </span>

      {/* Review readiness */}
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
        {row.flagCount > 0
          ? `${row.flagCount} to review`
          : row.entryCount === 0
            ? "No entries"
            : "Ready"}
      </span>

      {/* Amount — close rows carry no billable amount */}
      <span
        className={cn(
          "w-24 shrink-0 text-right tabular-nums",
          row.isCloseRow ? "text-muted-foreground" : "font-medium",
        )}
      >
        {row.isCloseRow ? "—" : formatCurrency(row.amount, row.currency)}
      </span>

      {/* Action slot — fixed width so amounts align; hints stay one line */}
      <div className="flex w-40 shrink-0 items-center justify-end">
        {row.configIssue === "missing-overage-rate" ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/projects/${row.projectId}?tab=settings`}>Set rate</Link>
          </Button>
        ) : (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/billing/close/${row.projectId}/${row.periodToken}`}>
              Review
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}

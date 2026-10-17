"use client"

import { CalendarClockIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { useBillingActions } from "@/lib/hooks/use-billing-actions"
import { pluralize } from "@/lib/format"

export type UninvoicedMonth = { year: number; month: number; label: string }

/**
 * Callout bar above the invoice list for retainer projects with one or more
 * elapsed, unclosed periods with overage. Surfaces the month labels for
 * context and links the next one to the Close workspace, where the close is
 * committed (docs/prd-billing-refactor.md D8).
 */
export function ProjectInvoicesRetainerCallout({
  projectId,
  uninvoicedMonths,
}: {
  projectId: Id<"projects">
  uninvoicedMonths: UninvoicedMonth[]
}) {
  const { reviewClose } = useBillingActions()

  if (uninvoicedMonths.length === 0) return null

  // Oldest first (server-sorted) — invoice the earliest closed month first.
  const next = uninvoicedMonths[0]
  const labels = uninvoicedMonths.map((m) => m.label)
  const shownLabels = labels.slice(0, 3).join(", ")
  const overflow = labels.length - 3
  const summary = overflow > 0 ? `${shownLabels} +${overflow} more` : shownLabels

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <CalendarClockIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {uninvoicedMonths.length}{" "}
          {pluralize(
            uninvoicedMonths.length,
            "uninvoiced month",
            "uninvoiced months",
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">{summary}</p>
      </div>
      <Button size="sm" onClick={() => reviewClose(projectId, next)}>
        Review {next.label}
      </Button>
    </div>
  )
}

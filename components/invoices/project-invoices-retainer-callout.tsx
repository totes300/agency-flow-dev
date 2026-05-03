"use client"

import { CalendarClockIcon, PlusIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { useGenerateInvoice } from "@/lib/hooks/use-generate-invoice"
import { pluralize } from "@/lib/format"

export type UninvoicedMonth = { year: number; month: number; label: string }

/**
 * Callout bar above the invoice list for retainer projects with one or more
 * uninvoiced closed months. Surfaces the month labels for context and offers
 * a single primary action — "Create <next month> invoice" — that calls
 * `createInvoice` directly and routes to the resulting draft (D10 in
 * `docs/invoicing-refactor.md` — the modal preview surface is gone; the draft
 * IS the preview surface).
 */
export function ProjectInvoicesRetainerCallout({
  projectId,
  uninvoicedMonths,
}: {
  projectId: Id<"projects">
  uninvoicedMonths: UninvoicedMonth[]
}) {
  const { generate, pending } = useGenerateInvoice()

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
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          void generate({
            projectId,
            retainerYear: next.year,
            retainerMonth: next.month,
          })
        }
      >
        <PlusIcon data-icon="inline-start" className="size-3.5" />
        Create {next.label} invoice
      </Button>
    </div>
  )
}

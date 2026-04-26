"use client"

import { useState } from "react"
import { CalendarClockIcon, PlusIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { pluralize } from "@/lib/format"

export type UninvoicedMonth = { year: number; month: number; label: string }

/**
 * Callout bar above the invoice list for retainer projects with one or more
 * uninvoiced closed months. Surfaces the month labels for context and offers
 * a single primary action — "Create <next month> invoice" — that pre-fills
 * the CreateInvoiceModal for the oldest uninvoiced month (the 90% case:
 * "invoice last month").
 *
 * The modal is keyed so remounting it between months resets the prefill
 * cleanly — same pattern as `ready-to-invoice-card`.
 */
export function ProjectInvoicesRetainerCallout({
  projectId,
  projectName,
  currency,
  uninvoicedMonths,
}: {
  projectId: Id<"projects">
  projectName: string
  currency: string
  uninvoicedMonths: UninvoicedMonth[]
}) {
  const [modalOpen, setModalOpen] = useState(false)

  if (uninvoicedMonths.length === 0) return null

  // Oldest first (server-sorted) — invoice the earliest closed month first.
  const next = uninvoicedMonths[0]
  const labels = uninvoicedMonths.map((m) => m.label)
  const shownLabels = labels.slice(0, 3).join(", ")
  const overflow = labels.length - 3
  const summary =
    overflow > 0 ? `${shownLabels} +${overflow} more` : shownLabels

  return (
    <>
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
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <PlusIcon data-icon="inline-start" className="size-3.5" />
          Create {next.label} invoice
        </Button>
      </div>

      {modalOpen && (
        <CreateInvoiceModal
          key={`${projectId}-${next.year}-${next.month}`}
          open={modalOpen}
          onOpenChange={setModalOpen}
          projectId={projectId}
          projectName={projectName}
          billingType="retainer"
          currency={currency}
          initialRetainerYear={next.year}
          initialRetainerMonth={next.month}
        />
      )}
    </>
  )
}

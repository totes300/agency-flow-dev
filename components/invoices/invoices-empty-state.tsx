"use client"

import Link from "next/link"
import { ReceiptIcon, SearchXIcon } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

/**
 * One empty state for every invoice list in the app — the global
 * `/invoices` page, the project detail "Invoices" tab, and filtered
 * result sets. Pick a `reason`; copy and CTA follow.
 */
export type InvoicesEmptyReason =
  | "global-no-invoices"
  | "project-no-invoices"
  | "no-matches"

/** Copy for `project-no-invoices` depends on the project's billing type so
 *  the description points at the right next action (log time vs. hit a
 *  milestone vs. wait for the next retainer month). */
const PROJECT_EMPTY_COPY: Record<string, { description: string }> = {
  t_and_m: {
    description:
      "Log time on the Time tab, then create an invoice here when you're ready to bill.",
  },
  fixed: {
    description: "Create invoices as you hit delivery milestones on this project.",
  },
  retainer: {
    description:
      "Retainer invoices appear here once you create them. Create this month's invoice from the banner above the list.",
  },
}

export interface InvoicesEmptyStateProps {
  reason: InvoicesEmptyReason
  /** Required for `project-no-invoices` when the user can create; enables the CTA. */
  onCreateInvoice?: () => void
  /** Optional clear-filters handler for `no-matches`. */
  onClearFilters?: () => void
  /** Tailors the `project-no-invoices` description per billing type. */
  billingType?: string
  className?: string
}

export function InvoicesEmptyState({
  reason,
  onCreateInvoice,
  onClearFilters,
  billingType,
  className,
}: InvoicesEmptyStateProps) {
  return (
    <div
      className={
        className ??
        "flex flex-1 items-center justify-center py-20"
      }
    >
      {reason === "global-no-invoices" && (
        <EmptyState
          icon={ReceiptIcon}
          title="No invoices yet"
          description="Create your first invoice from a project's Invoices tab."
          action={
            <Button variant="outline" asChild>
              <Link href="/projects">View billable projects</Link>
            </Button>
          }
        />
      )}

      {reason === "project-no-invoices" && (
        <EmptyState
          icon={ReceiptIcon}
          title="No invoices"
          description={
            PROJECT_EMPTY_COPY[billingType ?? ""]?.description ??
            "Create an invoice to start billing for this project."
          }
          action={
            <Button onClick={onCreateInvoice} disabled={!onCreateInvoice}>
              Create Invoice
            </Button>
          }
        />
      )}

      {reason === "no-matches" && (
        <EmptyState
          icon={SearchXIcon}
          title="No invoices match your filters"
          description="Try clearing or adjusting the filters to see more results."
          action={
            onClearFilters ? (
              <Button variant="outline" onClick={onClearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}

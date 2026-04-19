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

export interface InvoicesEmptyStateProps {
  reason: InvoicesEmptyReason
  /** Required for `project-no-invoices` when the user can create; enables the CTA. */
  onCreateInvoice?: () => void
  /** Optional clear-filters handler for `no-matches`. */
  onClearFilters?: () => void
  className?: string
}

export function InvoicesEmptyState({
  reason,
  onCreateInvoice,
  onClearFilters,
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
          description="Create an invoice to start billing for this project."
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

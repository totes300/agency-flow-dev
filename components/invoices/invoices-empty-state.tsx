"use client"

import Link from "next/link"
import {
  BanIcon,
  CircleCheckIcon,
  ClockIcon,
  FilePenIcon,
  ReceiptIcon,
  SearchXIcon,
} from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"

/**
 * One empty state for every invoice list in the app — the global
 * `/invoices` page, the project detail "Invoices" tab, and filtered
 * result sets. Pick a `reason`; copy and CTA follow.
 *
 * Per-tab variants (`tab-draft`, `tab-outstanding`, `tab-paid`, `tab-void`)
 * fire on the global page when a status tab is genuinely empty (no filters
 * active). Each one uses its own icon + descriptive copy so the user reads
 * what *would* live there. The Ready tab has its own celebratory
 * "all caught up" state in `InboxEmptyState` and isn't represented here.
 */
export type InvoicesEmptyReason =
  | "global-no-invoices"
  | "project-no-invoices"
  | "no-matches"
  | "tab-draft"
  | "tab-outstanding"
  | "tab-paid"
  | "tab-void"

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
        // No `flex-1` — empty states for list views sit near the top of the
        // content area, not centered to viewport. Centering looks like a
        // 404; the Notion/Linear/ClickUp pattern is "label the empty
        // space," with the icon+copy a comfortable distance below the
        // toolbar so the eye finds it without it dominating the page.
        className ?? "flex items-center justify-center py-16"
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

      {reason === "tab-draft" && (
        <EmptyState
          icon={FilePenIcon}
          title="No drafts"
          description="Generate an invoice from the Ready tab to save it as a draft before sending."
        />
      )}

      {reason === "tab-outstanding" && (
        <EmptyState
          icon={ClockIcon}
          title="Nothing outstanding"
          description="Invoices you've issued and sent appear here while they wait to be paid."
        />
      )}

      {reason === "tab-paid" && (
        <EmptyState
          icon={CircleCheckIcon}
          title="No paid invoices yet"
          description="Once you mark an invoice as paid, it'll live here for your records."
        />
      )}

      {reason === "tab-void" && (
        <EmptyState
          icon={BanIcon}
          title="No voided invoices"
          description="Cancelled invoices are kept here so your audit trail stays complete."
        />
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { InvoiceList, type InvoiceRow } from "@/components/invoices/invoice-list"
import { toInvoiceListRow } from "@/lib/invoices/list-rows"
import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { ProjectInvoicesSkeleton } from "@/components/invoices/project-invoices-skeleton"
import { ProjectInvoicesPaymentCards } from "@/components/invoices/project-invoices-payment-cards"
import { ProjectInvoicesRetainerCallout } from "@/components/invoices/project-invoices-retainer-callout"
import { formatCurrency } from "@/lib/format"
import { ORG_TIMEZONE_FALLBACK } from "@/lib/hooks/use-org-timezone"
import { PlusIcon } from "lucide-react"

/**
 * Project → Invoices tab.
 *
 * Layout (top to bottom):
 *   1. Header: title + Create Invoice
 *   2. Muted "Paid lifetime: $X" summary line (hidden when 0)
 *   3. Payment-health metric strip (2 or 3 cards depending on billing type)
 *   4. Retainer callout bar (only for retainer projects with uninvoiced months)
 *   5. Invoice list (or empty state with billing-type-aware copy)
 */
export function ProjectInvoices({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: { name: string; billingType: string; currency: string }
}) {
  const { isAuthenticated } = useConvexAuth()
  const invoices = useQuery(api.invoices.listInvoices, isAuthenticated ? { projectId } : "skip")
  const metrics = useQuery(api.invoices.getProjectInvoiceMetrics, isAuthenticated ? { projectId } : "skip")
  const overview = useQuery(api.timeEntries.projectOverview, isAuthenticated ? { projectId } : "skip")
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")
  const [modalOpen, setModalOpen] = useState(false)

  if (invoices === undefined || metrics === undefined || overview === undefined) {
    return <ProjectInvoicesSkeleton />
  }
  // metrics === null only when the project itself was deleted between the
  // initial render and this query — the parent <ProjectDetailPage> already
  // routes to notFound() in that case, so this branch is just defensive
  // alignment with the loading skeleton (no blank flash on race).
  if (metrics === null) return <ProjectInvoicesSkeleton />

  const { billingType, currency } = project
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK
  const hasInvoices = invoices.length > 0
  const paidLifetime = metrics.paidLifetime.amount

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Invoices</h2>
          {paidLifetime > 0 && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              Paid lifetime: {formatCurrency(paidLifetime, currency)}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <PlusIcon data-icon="inline-start" className="size-4" />
          Create Invoice
        </Button>
      </div>

      {/* Payment-health strip */}
      <ProjectInvoicesPaymentCards
        billingType={billingType}
        currency={currency}
        metrics={metrics}
        uninvoicedAmount={overview?.uninvoicedAmount ?? 0}
      />

      {/* Retainer callout — replaces a 3rd card with a primary CTA */}
      {billingType === "retainer" && (
        <ProjectInvoicesRetainerCallout
          projectId={projectId}
          projectName={project.name}
          currency={currency}
          uninvoicedMonths={metrics.uninvoicedMonths}
        />
      )}

      {/* Invoice list or empty state */}
      {hasInvoices ? (
        <InvoiceList
          rows={(invoices as InvoiceRow[]).map(toInvoiceListRow)}
          timezone={timezone}
          fromProject={{ projectId }}
        />
      ) : (
        <InvoicesEmptyState
          reason="project-no-invoices"
          billingType={billingType}
          onCreateInvoice={() => setModalOpen(true)}
        />
      )}

      <CreateInvoiceModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        projectId={projectId}
        projectName={project.name}
        billingType={billingType}
        currency={currency}
      />
    </div>
  )
}

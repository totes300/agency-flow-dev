"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { MetricCard } from "@/components/metric-card"
import { InvoiceList, type InvoiceRow } from "@/components/invoices/invoice-list"
import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { ProjectInvoicesSkeleton } from "@/components/invoices/project-invoices-skeleton"
import { formatCurrency } from "@/lib/format"
import { PlusIcon } from "lucide-react"

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

  const currency = project.currency
  const timezone = orgSettings?.timezone ?? "UTC"
  const canCreateInvoice = project.billingType === "t_and_m" || project.billingType === "fixed" || project.billingType === "retainer"
  const hasInvoices = invoices && invoices.length > 0

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Invoices</h2>
        {canCreateInvoice && (
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            Create Invoice
          </Button>
        )}
      </div>

      {/* T&M MetricCards */}
      {project.billingType === "t_and_m" && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="Total Invoiced"
            value={formatCurrency(metrics?.totalInvoiced ?? 0, currency)}
          />
          <MetricCard
            label="Uninvoiced"
            value={formatCurrency(overview?.uninvoicedAmount ?? 0, currency)}
          />
        </div>
      )}

      {/* Fixed MetricCards — always shown, even with zero invoices */}
      {project.billingType === "fixed" && metrics && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="Invoiced"
            value={formatCurrency(metrics.fixedBilled, currency)}
            detail={metrics.fixedPrice > 0 ? `${metrics.fixedPercentInvoiced}% of ${formatCurrency(metrics.fixedPrice, currency)}` : undefined}
          />
          <MetricCard
            label="Remaining"
            value={formatCurrency(metrics.fixedRemaining, currency)}
          />
        </div>
      )}

      {/* Retainer MetricCards */}
      {project.billingType === "retainer" && metrics && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="Total Invoiced"
            value={formatCurrency(metrics.totalInvoiced, currency)}
            detail={`${metrics.invoiceCount} invoice${metrics.invoiceCount !== 1 ? "s" : ""}`}
          />
          <MetricCard
            label="Uninvoiced Months"
            value={String(metrics.uninvoicedMonthCount)}
            detail={
              metrics.uninvoicedMonthCount === 0
                ? "All caught up"
                : metrics.uninvoicedMonthLabels.slice(0, 3).join(", ") +
                  (metrics.uninvoicedMonthLabels.length > 3
                    ? ` +${metrics.uninvoicedMonthLabels.length - 3} more`
                    : "")
            }
          />
        </div>
      )}

      {/* Invoice list or empty state */}
      {hasInvoices ? (
        <InvoiceList
          invoices={invoices as InvoiceRow[]}
          timezone={timezone}
          fromProject={{ projectId }}
        />
      ) : (
        <InvoicesEmptyState
          reason="project-no-invoices"
          onCreateInvoice={canCreateInvoice ? () => setModalOpen(true) : undefined}
        />
      )}

      {canCreateInvoice && (
        <CreateInvoiceModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          projectId={projectId}
          projectName={project.name}
          billingType={project.billingType}
          currency={currency}
        />
      )}
    </div>
  )
}

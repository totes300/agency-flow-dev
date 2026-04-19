"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { MonthlyTimeBreakdown, TimeLogSkeleton } from "./monthly-time-breakdown"
import { ProjectSummaryCard } from "./summary/project-summary-card"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { ReceiptIcon } from "lucide-react"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"

type TmProject = {
  name: string
  currency: string
}

export function TmOverview({
  projectId,
  project,
}: {
  projectId: Id<"projects">
  project: TmProject
}) {
  const handleTaskClick = useTaskDetailNav()
  const overview = useQuery(api.timeEntries.projectOverview, { projectId })
  const monthlyData = useQuery(api.timeEntries.projectMonthlyBreakdown, { projectId })
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false)

  const currency = project.currency

  return (
    <div className="flex flex-col gap-6">
      <ProjectSummaryCard projectId={projectId} />

      {/* Uninvoiced nudge — neutral info, not warning. T&M billing is
          discretionary; the banner surfaces the opportunity + shortcut. */}
      {overview && overview.uninvoicedAmount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <ReceiptIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            Uninvoiced balance:{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatCurrencyPrecise(overview.uninvoicedAmount, currency)}
            </span>{" "}
            across{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatMinutes(overview.uninvoicedMinutes)}
            </span>{" "}
            billable hours.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setInvoiceModalOpen(true)}
            className="ml-auto shrink-0"
          >
            Create Invoice
          </Button>
        </div>
      )}

      <CreateInvoiceModal
        open={invoiceModalOpen}
        onOpenChange={setInvoiceModalOpen}
        projectId={projectId}
        projectName={project.name}
        billingType="t_and_m"
        currency={currency}
      />

      {/* Time Log */}
      {monthlyData === undefined ? (
        <TimeLogSkeleton />
      ) : (
        <MonthlyTimeBreakdown
          months={monthlyData}
          showAmounts
          currency={currency}
          onTaskClick={handleTaskClick}
        />
      )}
    </div>
  )
}


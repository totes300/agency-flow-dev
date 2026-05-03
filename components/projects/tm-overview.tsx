"use client"

import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { InvoiceBanner, type InvoiceBannerState } from "@/components/invoices/invoice-banner"
import { MonthlyTimeBreakdown, TimeLogSkeleton } from "./monthly-time-breakdown"
import { ProjectSummaryCard } from "./summary/project-summary-card"
import { useTaskDetailNav } from "@/lib/hooks/use-task-detail-nav"
import { daysSinceLastInvoice } from "@/lib/format"
import { ORG_TIMEZONE_FALLBACK } from "@/lib/hooks/use-org-timezone"

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
  const metrics = useQuery(api.invoices.getProjectInvoiceMetrics, { projectId })
  const orgSettings = useQuery(api.orgSettings.get)

  const currency = project.currency
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK

  // Banner state — render only when there are uninvoiced billable hours.
  // Computed during render (no useEffect sync) per CLAUDE.md derived-state rule.
  const bannerState: InvoiceBannerState | null =
    overview && metrics && overview.uninvoicedAmount > 0
      ? {
          kind: "tm",
          uninvoicedAmount: overview.uninvoicedAmount,
          uninvoicedMinutes: overview.uninvoicedMinutes,
          lastInvoicedAt: metrics.lastInvoicedAt,
          daysSinceLastInvoice: daysSinceLastInvoice(metrics.lastInvoicedAt, { timezone }),
        }
      : null

  return (
    <div className="flex flex-col gap-6">
      <ProjectSummaryCard projectId={projectId} />

      <InvoiceBanner
        state={bannerState}
        projectId={projectId}
        currency={currency}
        timezone={timezone}
      />

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

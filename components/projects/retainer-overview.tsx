"use client"

import { useSearchParams } from "next/navigation"
import { useQuery } from "convex/react"
import type { FunctionReturnType } from "convex/server"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Card,
  CardHeader,
  CardContent,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { InvoiceBanner, type InvoiceBannerState } from "@/components/invoices/invoice-banner"
import { MonthlyBreakdownCard, ROW_GRID } from "./monthly-breakdown-card"
import { ProjectSummaryCard } from "./summary/project-summary-card"
import { formatMinutes } from "@/lib/format"
import { ORG_TIMEZONE_FALLBACK } from "@/lib/hooks/use-org-timezone"
import { AlertTriangleIcon } from "lucide-react"

/**
 * Tab-separated short-month list, prototype-style: "Mar", "Mar & Apr",
 * "Mar, Apr & May". Used by the monthly-settlement banner subline.
 */
function formatMonthList(months: Array<{ year: number; month: number }>): string {
  const short = (m: { year: number; month: number }) =>
    new Date(m.year, m.month - 1, 1).toLocaleDateString("en-US", { month: "short" })
  if (months.length === 0) return ""
  if (months.length === 1) return short(months[0])
  if (months.length === 2) return `${short(months[0])} & ${short(months[1])}`
  return `${months.slice(0, -1).map(short).join(", ")} & ${short(months[months.length - 1])}`
}

/**
 * Pure helper — derives the banner state from `getRetainerData` output and
 * `getProjectInvoiceMetrics`. Returns `null` for the no-banner cases.
 *
 * Only the **monthly-settlement** path (rollover OFF) renders a banner: it
 * aggregates closed-uninvoiced months across the project history. Rollover
 * cycle invoicing lives on the cycle-end row of the Monthly Breakdown card
 * (PRD § User Story 4: single primary action per row). The previous
 * `retainer-cycle-closed` banner branch was dead code — it required
 * `cycleOffset === 0 && isCycleClosed`, which is mutually exclusive
 * (the cycle containing today is by definition not yet closed).
 */
type RetainerData = NonNullable<FunctionReturnType<typeof api.projects.getRetainerData>>
type Metrics = NonNullable<FunctionReturnType<typeof api.invoices.getProjectInvoiceMetrics>>

function computeRetainerBannerState(
  data: RetainerData,
  metrics: Metrics | undefined,
): InvoiceBannerState | null {
  const { rolloverEnabled, overageDue } = data
  if (rolloverEnabled) return null

  if (!metrics || metrics.uninvoicedMonths.length === 0) return null
  const ready = metrics.uninvoicedMonths
  return {
    kind: "retainer-monthly",
    readyMonthCount: ready.length,
    readyMonthsLabel: formatMonthList(ready),
    overageDue,
    lastInvoicedAt: metrics.lastInvoicedAt,
    targetYear: ready[0].year,
    targetMonth: ready[0].month,
  }
}

export function RetainerOverview({
  projectId,
  currency: projectCurrency,
}: {
  projectId: Id<"projects">
  currency: string
}) {
  const searchParams = useSearchParams()
  const cycleOffsetParam = Number(searchParams.get("cycleOffset") ?? "0")
  const cycleOffset = Number.isFinite(cycleOffsetParam) ? cycleOffsetParam : 0
  const data = useQuery(api.projects.getRetainerData, { id: projectId, cycleOffset })
  const metrics = useQuery(api.invoices.getProjectInvoiceMetrics, { projectId })
  const orgSettings = useQuery(api.orgSettings.get)
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <ProjectSummaryCard projectId={projectId} />
        <MonthlyBreakdownSkeleton />
      </div>
    )
  }

  if (data === null) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Retainer data not available. Check project configuration.
      </p>
    )
  }

  const { overageMinutes, overageRate } = data

  const bannerState = computeRetainerBannerState(data, metrics ?? undefined)

  return (
    <div className="flex flex-col gap-6">
      <ProjectSummaryCard projectId={projectId} />

      <InvoiceBanner
        state={bannerState}
        projectId={projectId}
        currency={projectCurrency}
        timezone={timezone}
      />

      {overageRate === 0 && overageMinutes > 0 && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Overage rate not set</AlertTitle>
          <AlertDescription>
            This retainer has {formatMinutes(overageMinutes)} over budget but no overage rate configured. Set an overage rate in project settings to calculate overage charges.
          </AlertDescription>
        </Alert>
      )}

      <MonthlyBreakdownCard
        data={data}
        projectId={projectId}
        currency={projectCurrency}
      />
    </div>
  )
}

function MonthlyBreakdownSkeleton() {
  // Reuses the live card's `ROW_GRID` so the skeleton-to-content swap doesn't
  // shift any pixel (CLAUDE.md content-aware skeletons rule).
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-6 py-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-32" />
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className={`${ROW_GRID} border-b py-2`}>
          <span aria-hidden />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-10 justify-self-end" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-12 justify-self-end" />
          <span aria-hidden />
        </div>
        <ul className="divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className={`${ROW_GRID} py-3`}>
              <Skeleton className="size-1.5 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20 justify-self-end" />
              <Skeleton className="h-5 w-24 rounded-[5px]" />
              <Skeleton className="h-4 w-14 justify-self-end" />
              <Skeleton className="h-7 w-20 justify-self-end" />
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-5 border-t px-6 py-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

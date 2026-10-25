"use client"

import { useState } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { TargetIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { ProjectBillingPeriods } from "@/convex/lib/billing/projectPeriods"
import type { Profitability } from "@/convex/lib/projectSummary"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BudgetEstimatesModal } from "@/components/projects/budget-estimates-modal"
import { BudgetArc } from "@/components/projects/summary/primitives/budget-arc"
import { MetricGroup } from "@/components/projects/summary/primitives/metric-group"
import { MetricRow } from "@/components/projects/summary/primitives/metric-row"
import { SummaryColumn } from "@/components/projects/summary/primitives/summary-column"
import { formatCurrencyPrecise, formatMinor, formatMinutes } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The finance card (docs/prd-project-billing-redesign.md §7.2 step 3): the
 * original Project Finances columns for the selected period, without a card
 * header — the period header above names the period. Overage shows here and
 * on the period card on purpose (analysis vs. action, P7).
 */
export function FinanceCard({
  projectId,
  periodKey,
  model,
}: {
  projectId: Id<"projects">
  /** "YYYY-MM"; ignored for fixed fee (project to date). */
  periodKey: string
  model: ProjectBillingPeriods
}) {
  const { isAuthenticated } = useConvexAuth()
  const [estimatesOpen, setEstimatesOpen] = useState(false)
  const summary = useQuery(api.projects.getSummary, isAuthenticated ? { projectId, period: periodKey } : "skip")
  if (summary === undefined) return <FinanceCardSkeleton columns={model.billingType === "non_billable" ? 1 : 3} />
  if (summary === null) return null

  switch (summary.billingType) {
    case "retainer": {
      const { timeBreakdown: t, overage, profitability, currency } = summary
      return (
        <Shell>
          <SummaryColumn title="Time breakdown">
            <div className="flex items-center gap-7">
              <BudgetArc usedMinutes={t.totalMinutes} budgetMinutes={t.cycleBudgetMinutes} />
              <div className="flex flex-col gap-3">
                <MetricRow label="Billable hours" value={formatMinutes(t.billableMinutes)} />
                <MetricRow label="Non-billable hours" value={formatMinutes(t.nonBillableMinutes)} />
              </div>
            </div>
          </SummaryColumn>
          <SummaryColumn title="Overage">
            <MetricRow
              label="Over budget"
              value={overage && overage.overBudgetMinutes > 0 ? `+${formatMinutes(overage.overBudgetMinutes)}` : "—"}
              variant={overage && overage.overBudgetMinutes > 0 ? "destructive" : "default"}
            />
            <MetricRow
              label="Overage due"
              value={overage && overage.overageDueAmount > 0 ? formatCurrencyPrecise(overage.overageDueAmount, currency) : "—"}
              variant={overage && overage.overageDueAmount > 0 ? "destructive" : "default"}
            />
          </SummaryColumn>
          <ProfitabilityColumn profitability={profitability} currency={currency} />
        </Shell>
      )
    }
    case "t_and_m": {
      const { timeBreakdown: t, billingStatus: b, profitability, currency } = summary
      return (
        <Shell>
          <SummaryColumn title="Time breakdown">
            <MetricRow label="Total hours" value={formatMinutes(t.totalMinutes)} />
            <MetricGroup>
              <MetricRow label="Billable hours" value={formatMinutes(t.billableMinutes)} />
              <MetricRow label="Non-billable hours" value={formatMinutes(t.nonBillableMinutes)} />
            </MetricGroup>
          </SummaryColumn>
          <SummaryColumn title="Billing">
            {/* §6.8: billed = covered by a live close, draft or final. */}
            <MetricRow
              label="Unbilled"
              value={formatCurrencyPrecise(b?.unbilledAmount ?? 0, currency)}
              detail={`${formatMinutes(b?.unbilledMinutes ?? 0)} h`}
            />
            <MetricRow
              label="Billed"
              value={formatCurrencyPrecise(b?.billedAmount ?? 0, currency)}
              detail={`${formatMinutes(b?.billedMinutes ?? 0)} h`}
            />
          </SummaryColumn>
          <ProfitabilityColumn profitability={profitability} currency={currency} />
        </Shell>
      )
    }
    case "fixed": {
      const { timeBreakdown: t, profitability, currency } = summary
      const fixed = model.fixed
      const budget = t.estimatedBudgetMinutes ?? 0
      return (
        <Shell>
          <SummaryColumn title="Time breakdown">
            {budget > 0 ? (
              <div className="flex items-center gap-7">
                <BudgetArc usedMinutes={t.totalMinutes} budgetMinutes={budget} />
                <MetricRow
                  label="Remaining"
                  value={t.remainingMinutes !== null ? formatMinutes(t.remainingMinutes) : "—"}
                  variant={t.remainingMinutes !== null && t.remainingMinutes < 0 ? "destructive" : "default"}
                />
              </div>
            ) : (
              <>
                <MetricRow label="Total hours" value={formatMinutes(t.totalMinutes)} />
                <div className="flex flex-col gap-0.5">
                  <p className="text-xs text-muted-foreground">Scope estimates</p>
                  <span className="text-lg leading-tight font-semibold tracking-tight text-muted-foreground">Not set</span>
                  <Button size="sm" variant="outline" className="mt-2 self-start" onClick={() => setEstimatesOpen(true)}>
                    <TargetIcon />
                    Set estimates
                  </Button>
                </div>
                <BudgetEstimatesModal open={estimatesOpen} onOpenChange={setEstimatesOpen} projectId={projectId} />
              </>
            )}
          </SummaryColumn>
          <SummaryColumn title="Billing">
            <MetricRow label="Fixed fee" value={formatMinor(fixed?.priceMinor ?? 0, currency)} />
            <MetricGroup>
              <MetricRow label="Invoiced" value={formatMinor(fixed?.invoicedMinor ?? 0, currency)} />
              <MetricRow label="Remaining" value={formatMinor(Math.max(0, fixed?.remainingMinor ?? 0), currency)} />
            </MetricGroup>
          </SummaryColumn>
          <ProfitabilityColumn profitability={profitability} currency={currency}>
            {profitability?.expectedHourlyRate != null ? (
              <MetricRow label="Expected rate" value={`${formatCurrencyPrecise(profitability.expectedHourlyRate, currency)}/h`} />
            ) : null}
            {profitability?.expectedHourlyRate != null && profitability.effectiveHourlyRate != null ? (
              <MetricRow
                label="Effective rate"
                value={`${formatCurrencyPrecise(profitability.effectiveHourlyRate, currency)}/h`}
                variant={profitability.effectiveHourlyRate < profitability.expectedHourlyRate ? "destructive" : "default"}
                trailing={
                  profitability.effectiveHourlyRate > profitability.expectedHourlyRate ? (
                    <TrendingUpIcon aria-hidden className="size-4 text-success" />
                  ) : profitability.effectiveHourlyRate < profitability.expectedHourlyRate ? (
                    <TrendingDownIcon aria-hidden className="size-4 text-destructive" />
                  ) : null
                }
              />
            ) : null}
          </ProfitabilityColumn>
        </Shell>
      )
    }
    case "non_billable": {
      const t = summary.timeBreakdown
      return (
        <Shell columns={1}>
          <SummaryColumn title="Time breakdown">
            <MetricGroup columns={3}>
              <MetricRow label="Total hours" value={formatMinutes(t.totalMinutes)} />
              <MetricRow label="Billable hours" value={formatMinutes(t.billableMinutes)} />
              <MetricRow label="Non-billable hours" value={formatMinutes(t.nonBillableMinutes)} />
            </MetricGroup>
          </SummaryColumn>
        </Shell>
      )
    }
  }
}

function ProfitabilityColumn({
  profitability,
  currency,
  children,
}: {
  profitability?: Profitability
  currency: string
  children?: React.ReactNode
}) {
  if (!profitability) return null
  return (
    <SummaryColumn title="Profitability">
      <MetricGroup>
        <MetricRow label="Earned revenue" value={formatCurrencyPrecise(profitability.revenue, currency)} />
        <MetricRow
          label="Profit"
          value={formatCurrencyPrecise(profitability.profit, currency)}
          variant={profitability.profit < 0 ? "destructive" : "default"}
        />
        <MetricRow label="Total cost" value={formatCurrencyPrecise(profitability.totalCost, currency)} />
        <MetricRow
          label="Margin"
          value={profitability.marginPercent !== null ? `${profitability.marginPercent}%` : "—"}
          variant={profitability.marginPercent !== null && profitability.marginPercent < 0 ? "destructive" : "default"}
        />
        {children}
      </MetricGroup>
    </SummaryColumn>
  )
}

function Shell({ children, columns = 3 }: { children: React.ReactNode; columns?: 1 | 3 }) {
  return (
    <div
      className={cn(
        "grid divide-y divide-border/60 rounded-xl bg-background ring-1 ring-border/70 md:divide-x md:divide-y-0",
        columns === 3 && "md:grid-cols-[1.15fr_0.85fr_1.15fr]",
      )}
    >
      {children}
    </div>
  )
}

function FinanceCardSkeleton({ columns }: { columns: 1 | 3 }) {
  return (
    <Shell columns={columns}>
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="flex flex-col gap-4 px-5 py-4">
          <Skeleton className="h-4 w-28" />
          <div className="flex flex-col gap-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
      ))}
    </Shell>
  )
}

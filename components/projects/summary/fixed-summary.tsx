"use client"

import { useState } from "react"
import Link from "next/link"
import type { Id } from "@/convex/_generated/dataModel"
import type { FixedSummary } from "@/convex/lib/projectSummary"
import { SummaryCardShell } from "./primitives/summary-card-shell"
import { SummaryColumn } from "./primitives/summary-column"
import { MetricRow } from "./primitives/metric-row"
import { MetricGroup } from "./primitives/metric-group"
import { RoleGatedColumn } from "./primitives/role-gated-column"
import { Button } from "@/components/ui/button"
import { BudgetEstimatesModal } from "../budget-estimates-modal"
import { formatCurrencyPrecise, formatMinutes } from "@/lib/format"
import { CheckIcon, SettingsIcon, TargetIcon, TrendingUpIcon, TrendingDownIcon } from "lucide-react"

export function FixedSummaryCard({
  projectId,
  summary,
}: {
  projectId: Id<"projects">
  summary: FixedSummary
}) {
  const { currency, subtitle, timeBreakdown, billingStatus, profitability } = summary
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)

  const fixedPriceSet = billingStatus?.fixedPrice !== null && billingStatus?.fixedPrice !== undefined
  // Budget is "set" when the sum of category estimates is > 0. 0/null both render
  // the empty-state: no budget → no Expected rate → no scope-creep signal.
  const budgetMinutes = timeBreakdown.estimatedBudgetMinutes
  const budgetSet = budgetMinutes !== null && budgetMinutes > 0
  // Admin proxy — billingStatus + profitability are only populated for admins
  // (see computeFixedSummary in convex/lib/projectSummary.ts). Use this to
  // suppress mutation CTAs for members, since projectCategoryEstimates.upsert
  // requires admin and would throw on click.
  const canEdit = billingStatus !== undefined

  return (
    <SummaryCardShell title="Project Finances" subtitle={subtitle}>
      {billingStatus ? (
        fixedPriceSet ? (
          <SummaryColumn title="Billing status">
            <MetricRow
              label="Fixed fee"
              value={formatCurrencyPrecise(billingStatus.fixedPrice ?? 0, currency)}
            />
            <MetricRow
              label="Billed Amount"
              value={formatCurrencyPrecise(billingStatus.billedAmount, currency)}
            />
            {billingStatus.slot === "unbilled" && (
              <MetricRow
                label="Unbilled Amount"
                value={formatCurrencyPrecise(billingStatus.slotAmount, currency)}
              />
            )}
            {billingStatus.slot === "fully_invoiced" && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CheckIcon className="size-3.5 text-success" />
                <span>Fully invoiced</span>
              </div>
            )}
            {billingStatus.slot === "extra_billed" && (
              <MetricRow
                label="Extra billed"
                value={`+${formatCurrencyPrecise(billingStatus.slotAmount, currency)}`}
                detail={`beyond ${formatCurrencyPrecise(billingStatus.fixedPrice ?? 0, currency)} fixed fee`}
                variant="positive"
              />
            )}
          </SummaryColumn>
        ) : (
          <SummaryColumn title="Billing status">
            <p className="text-sm text-muted-foreground">
              Set a fixed fee to track billing.
            </p>
            <Button asChild variant="outline" size="sm" className="self-start">
              <Link href={`/projects/${projectId}?tab=settings`}>
                <SettingsIcon className="size-3.5" />
                Open settings
              </Link>
            </Button>
          </SummaryColumn>
        )
      ) : (
        <RoleGatedColumn title="Billing status" />
      )}

      <SummaryColumn title="Time breakdown">
        <MetricRow
          label="Total hours"
          value={formatMinutes(timeBreakdown.totalMinutes)}
          detail={
            budgetSet && budgetMinutes !== null
              ? `of ${formatMinutes(budgetMinutes)} budget`
              : undefined
          }
        />
        {budgetSet && timeBreakdown.remainingMinutes !== null ? (
          <MetricRow
            label="Total remaining"
            value={formatMinutes(timeBreakdown.remainingMinutes)}
            variant={timeBreakdown.remainingMinutes < 0 ? "destructive" : "default"}
          />
        ) : (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">Scope estimates</p>
            <span className="text-lg font-semibold leading-tight tracking-tight text-muted-foreground">
              Not set
            </span>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2 self-start"
                onClick={() => setBudgetModalOpen(true)}
              >
                <TargetIcon className="size-3.5" />
                Set estimates
              </Button>
            )}
          </div>
        )}
      </SummaryColumn>

      {profitability ? (
        <SummaryColumn title="Project Profitability">
          <MetricGroup>
            <MetricRow
              label="Contract Value"
              value={formatCurrencyPrecise(profitability.revenue, currency)}
            />
            <MetricRow
              label="Total cost"
              value={formatCurrencyPrecise(profitability.totalCost, currency)}
            />
            <MetricRow
              label="Profit"
              value={formatCurrencyPrecise(profitability.profit, currency)}
              variant={profitability.profit < 0 ? "destructive" : "default"}
            />
            <MetricRow
              label="Margin"
              value={profitability.marginPercent !== null ? `${profitability.marginPercent}%` : "—"}
              variant={profitability.marginPercent !== null && profitability.marginPercent < 0 ? "destructive" : "default"}
            />
            {profitability.expectedHourlyRate !== null && (
              <MetricRow
                label="Expected rate"
                value={`${formatCurrencyPrecise(profitability.expectedHourlyRate, currency)}/h`}
              />
            )}
            {profitability.expectedHourlyRate !== null && profitability.effectiveHourlyRate !== null && (
              <EffectiveRateMetric
                expected={profitability.expectedHourlyRate}
                effective={profitability.effectiveHourlyRate}
                currency={currency}
              />
            )}
          </MetricGroup>
        </SummaryColumn>
      ) : (
        <RoleGatedColumn title="Project Profitability" />
      )}

      <BudgetEstimatesModal
        open={budgetModalOpen}
        onOpenChange={setBudgetModalOpen}
        projectId={projectId}
      />
    </SummaryCardShell>
  )
}

function EffectiveRateMetric({
  expected,
  effective,
  currency,
}: {
  expected: number
  effective: number
  currency: string
}) {
  const trend =
    effective > expected ? "ahead" : effective < expected ? "behind" : "on_track"

  const trailing =
    trend === "ahead" ? (
      <TrendingUpIcon aria-hidden className="size-4 text-success" />
    ) : trend === "behind" ? (
      <TrendingDownIcon aria-hidden className="size-4 text-destructive" />
    ) : null

  return (
    <MetricRow
      label="Effective rate"
      value={`${formatCurrencyPrecise(effective, currency)}/h`}
      variant={trend === "ahead" ? "positive" : trend === "behind" ? "destructive" : "default"}
      trailing={trailing}
    />
  )
}

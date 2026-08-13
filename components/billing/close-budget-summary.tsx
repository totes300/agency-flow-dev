"use client"

import { ChevronDownIcon, InfoIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  CloseCycleBreakdown,
  type CycleMonthLens,
} from "@/components/billing/close-cycle-breakdown"
import {
  formatHoursCompact,
  formatSignedHours,
  formatCurrency,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CloseWorkspaceData } from "@/convex/close"

/**
 * Inline budget summary line for the Close workspace header — the single place
 * the money consequence is stated while reviewing (PRD story 7). Every number
 * comes from the server `billingScope` report; this component only formats.
 *
 * Shape adapts by billing type:
 *   - retainer (monthly): Included · Logged · Balance ( · Overage × rate = amount )
 *   - retainer (rollover cycle): Included (N × Xh) · Logged · Balance to date /
 *     Ending balance ( · Overage tail ) + a collapsible month-by-month balance
 *     ladder (`CloseCycleBreakdown`) — the full rollover story on demand.
 *   - T&M:      Logged · Billable amount
 *   - fixed:    Remaining fee
 *
 * Raw ledger note (PRD story 8) states explicitly that nothing is rounded and
 * nothing locks until commit — so the owner trusts that reviewing is safe.
 */
export function CloseBudgetSummary({
  data,
  breakdownOpen = false,
  onBreakdownOpenChange,
  monthLens = null,
  onMonthLensChange,
}: {
  data: CloseWorkspaceData
  breakdownOpen?: boolean
  onBreakdownOpenChange?: (open: boolean) => void
  monthLens?: CycleMonthLens | null
  onMonthLensChange?: (lens: CycleMonthLens | null) => void
}) {
  const isCycle =
    data.billingType === "retainer" && data.monthlyBalances.length > 1
  return (
    <Collapsible
      open={isCycle && breakdownOpen}
      onOpenChange={onBreakdownOpenChange}
      className="flex flex-col gap-1.5"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        {data.billingType === "retainer" && (
          <RetainerSummary data={data} isCycle={isCycle} />
        )}
        {data.billingType === "t_and_m" && <TmSummary data={data} />}
        {data.billingType === "fixed" && <FixedSummary data={data} />}
        {isCycle && (
          <>
            <Sep />
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {breakdownOpen ? "Hide breakdown" : "How this balance builds"}
                <ChevronDownIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 transition-transform",
                    breakdownOpen && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
          </>
        )}
        {/* Reassurance copy on demand, not as a permanent line — the money
            numbers are the content here; the explanation is a tool. */}
        {!data.fromSettlementStamps && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <InfoIcon
                  aria-label="About these numbers"
                  className="size-3.5 shrink-0 translate-y-0.5 cursor-default text-muted-foreground/70"
                />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-64">
                Raw hours — nothing is rounded here, and nothing locks until
                you commit.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      {/* A closed period keeps its one-line state marker — it's the only
          signal that this view is committed history. */}
      {data.fromSettlementStamps && (
        <p className="text-xs text-muted-foreground">
          Closed period — the ledger below is the committed record.
        </p>
      )}
      {isCycle && (
        <CollapsibleContent className="pt-1.5">
          <CloseCycleBreakdown
            data={data}
            activeLens={monthLens}
            onLensChange={onMonthLensChange}
          />
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "over" | "within"
}) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium tabular-nums",
          tone === "over" && "text-destructive",
          tone === "within" && "text-emerald-600 dark:text-emerald-500",
        )}
      >
        {value}
      </span>
    </span>
  )
}

function Sep() {
  return <span aria-hidden className="text-muted-foreground/40">·</span>
}

/** "10h" for whole hours, "7h 30m" otherwise — the (N × Xh) parenthetical. */
function perMonthShort(minutes: number): string {
  return minutes % 60 === 0
    ? `${minutes / 60}h`
    : formatHoursCompact(minutes)
}

function RetainerSummary({
  data,
  isCycle,
}: {
  data: CloseWorkspaceData
  isCycle: boolean
}) {
  const over = !data.withinBudget
  // Cycle: the honest running number ("Ending balance" once the cycle is over,
  // "Balance to date" while months are still pending). Monthly: unchanged.
  const balance = isCycle ? data.balanceToDateMinutes : data.balanceMinutes
  const balanceLabel = !isCycle
    ? "Balance"
    : data.periodElapsed || data.fromSettlementStamps
      ? "Ending balance"
      : "Balance to date"
  return (
    <>
      <span className="inline-flex items-baseline gap-1">
        <span className="text-muted-foreground">Included</span>
        <span className="font-medium tabular-nums">
          {formatHoursCompact(data.includedMinutes)}
        </span>
        {isCycle && data.project.includedMinutesPerMonth != null && (
          <span className="tabular-nums text-muted-foreground">
            ({data.monthlyBalances.length} ×{" "}
            {perMonthShort(data.project.includedMinutesPerMonth)})
          </span>
        )}
      </span>
      <Sep />
      <Stat label="Logged" value={formatHoursCompact(data.usageMinutes)} />
      <Sep />
      <Stat
        label={balanceLabel}
        value={isCycle ? formatSignedHours(balance) : formatHoursCompact(balance)}
        tone={balance < 0 ? "over" : "within"}
      />
      {over && (
        <>
          <Sep />
          <span className="inline-flex items-baseline gap-1">
            <span className="text-muted-foreground">Overage</span>
            <span className="font-medium tabular-nums text-destructive">
              {formatHoursCompact(data.overageMinutes)}
            </span>
            {data.overageRate != null && data.overageRate > 0 ? (
              <>
                <span className="text-muted-foreground">×</span>
                <span className="tabular-nums">
                  {formatCurrency(data.overageRate, data.currency)}/h
                </span>
                <span className="text-muted-foreground">=</span>
                <span className="font-semibold tabular-nums">
                  {formatCurrency(data.amount, data.currency)}
                </span>
              </>
            ) : (
              <span className="text-destructive">· no overage rate set</span>
            )}
          </span>
        </>
      )}
    </>
  )
}

function TmSummary({ data }: { data: CloseWorkspaceData }) {
  return (
    <>
      <Stat label="Logged" value={formatHoursCompact(data.usageMinutes)} />
      <Sep />
      <span className="inline-flex items-baseline gap-1">
        <span className="text-muted-foreground">Billable</span>
        <span className="font-semibold tabular-nums">
          {formatCurrency(data.amount, data.currency)}
        </span>
      </span>
    </>
  )
}

function FixedSummary({ data }: { data: CloseWorkspaceData }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">Remaining fee</span>
      <span className="font-semibold tabular-nums">
        {formatCurrency(data.amount, data.currency)}
      </span>
    </span>
  )
}

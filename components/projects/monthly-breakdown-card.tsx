"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { FunctionReturnType } from "convex/server"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import { useGenerateInvoice } from "@/lib/hooks/use-generate-invoice"
import {
  formatCurrency,
  formatCycleLabel,
  formatInvoiceNumber,
  formatMinutes,
  formatShortDate,
} from "@/lib/format"
import {
  decideRetainerRowAction,
  type RetainerRowAction,
} from "@/lib/retainer-row-action"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────────

type RetainerData = NonNullable<FunctionReturnType<typeof api.projects.getRetainerData>>
type MonthData = RetainerData["months"][number]
type BillingState = "within_budget" | "over_budget" | "in_progress"

// Fixed 3-value pill dictionary — never embeds dynamic data. See PRD § Module Design #5.
function billingStateOf(month: MonthData): BillingState {
  if (!month.isMonthClosed) return "in_progress"
  return month.endBalance >= 0 ? "within_budget" : "over_budget"
}

type ToneKey = "green" | "amber" | "neutral"

const TONE_DOT: Record<ToneKey, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  neutral: "bg-muted-foreground/50",
}

// Single source of truth for label + tone — pill, dot, and legend all read
// from one record so the mapping never drifts.
const STATE_META: Record<BillingState, { label: string; tone: ToneKey }> = {
  within_budget: { label: "within budget", tone: "green" },
  over_budget: { label: "over budget", tone: "amber" },
  in_progress: { label: "in progress", tone: "neutral" },
}

function MetricDot({ tone }: { tone: ToneKey }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
    />
  )
}

// ─── Layout tokens ──────────────────────────────────────────────────────────────

/**
 * dot · month · hours · state pill · amount · action — fixed 6-col grid so
 * every row aligns vertically regardless of state.
 *
 * Exported so the skeleton in `retainer-overview.tsx` can mirror the live
 * card pixel-for-pixel (CLAUDE.md content-aware skeletons rule). Single
 * source of truth.
 */
export const ROW_GRID = "grid grid-cols-[14px_minmax(0,1fr)_92px_112px_92px_112px] items-center gap-3 px-5"

// ─── Main Component ─────────────────────────────────────────────────────────────

export function MonthlyBreakdownCard({
  data,
  projectId,
  currency,
}: {
  data: RetainerData
  projectId: Id<"projects">
  currency: string
}) {
  const {
    months,
    rolloverEnabled,
    isCycleClosed,
    cycleLength,
    utilization,
    cycleEnd,
    overageRate,
    monthlyFee,
    overageDue,
  } = data

  // Component-state-only sort — intentional deviation from the URL-state rule
  // (PRD § Further Notes): the toggle is a transient per-visit preference, not
  // part of the page's shareable view.
  const [sortDir, setSortDir] = useState<"oldest" | "newest">("oldest")
  const { generate, pending } = useGenerateInvoice()

  // Compute view rows during render — no useEffect sync. Resort is cheap.
  const sortedMonths = useMemo(() => {
    if (sortDir === "oldest") return months
    return [...months].reverse()
  }, [months, sortDir])

  // Per-row action decided once per render — same source of truth the
  // ActionCell consumes. Highlight then picks the row whose action is
  // "generate" (the one the user is being asked to do). Both modes use the
  // shared `decideRetainerRowAction` rule.
  const actionByMonthKey = useMemo(() => {
    const ctx = {
      isRollover: rolloverEnabled,
      cycleLength,
      cycleHasOverage: overageDue > 0,
      overageRate,
    }
    const out = new Map<string, RetainerRowAction>()
    for (const m of months) out.set(monthKey(m), decideRetainerRowAction(m, ctx))
    return out
  }, [months, rolloverEnabled, cycleLength, overageDue, overageRate])

  const highlightKey = useMemo(() => {
    for (const m of months) {
      const key = monthKey(m)
      if (actionByMonthKey.get(key) === "generate") return key
    }
    return null
  }, [months, actionByMonthKey])

  const closedCount = months.filter((m) => m.isMonthClosed).length
  const cycleLabel = formatCycleLabel(months)
  const utilizationPct = Math.round(utilization)
  const cycleEndLabel = formatShortDate(cycleEnd)

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Monthly Breakdown</CardTitle>
          {rolloverEnabled && (
            <p className="truncate text-xs text-muted-foreground">
              {cycleLabel} cycle · {closedCount}/{cycleLength} months closed · {utilizationPct}% used
            </p>
          )}
          <StripeDisclaimer monthlyFee={monthlyFee} currency={currency} />
        </div>
        {rolloverEnabled ? (
          <ColoredPillBadge
            tone="neutral"
            label={`Cycle ${isCycleClosed ? "closed" : "closes"} ${cycleEndLabel}`}
          />
        ) : (
          <SortToggle
            dir={sortDir}
            onToggle={() => setSortDir((d) => (d === "oldest" ? "newest" : "oldest"))}
          />
        )}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        {/* Column header strip — anchors the 6-col grid. Single bottom border
            avoids stacking with the rows' divide-y. */}
        <div
          className={cn(
            ROW_GRID,
            "border-b py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
          )}
        >
          <span aria-hidden />
          <span>Month</span>
          <span className="text-right">Hours</span>
          <span>State</span>
          <span className="text-right">Amount</span>
          <span aria-hidden />
        </div>

        <ul className="divide-y">
          {sortedMonths.map((month) => {
            const key = monthKey(month)
            return (
              <MonthRow
                key={key}
                month={month}
                action={actionByMonthKey.get(key) ?? "report"}
                currency={currency}
                overageRate={overageRate}
                projectId={projectId}
                isHighlighted={key === highlightKey}
                isPending={pending}
                onGenerate={() =>
                  void generate({
                    projectId,
                    retainerYear: month.year,
                    retainerMonth: month.month,
                  })
                }
              />
            )
          })}
        </ul>

        {/* Footer legend — documents the dot semantics so the row chrome stays minimal */}
        <div className="flex items-center gap-5 border-t px-6 py-3 text-xs text-muted-foreground">
          {(Object.keys(STATE_META) as BillingState[]).map((state) => (
            <span key={state} className="flex items-center gap-1.5">
              <MetricDot tone={STATE_META[state].tone} />
              {STATE_META[state].label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────────

function MonthRow({
  month,
  action,
  currency,
  overageRate,
  projectId,
  isHighlighted,
  isPending,
  onGenerate,
}: {
  month: MonthData
  action: RetainerRowAction
  currency: string
  overageRate: number
  projectId: Id<"projects">
  isHighlighted: boolean
  isPending: boolean
  onGenerate: () => void
}) {
  const state = billingStateOf(month)
  const meta = STATE_META[state]

  return (
    <li
      className={cn(
        ROW_GRID,
        "py-3 text-sm transition-colors hover:bg-muted/30",
        isHighlighted && "bg-muted/30",
      )}
    >
      <MetricDot tone={meta.tone} />
      <span
        className={cn(
          "truncate",
          isHighlighted && "font-medium",
          state === "in_progress" && "text-muted-foreground",
        )}
      >
        {month.label}
      </span>
      <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
        {formatMinutes(month.workedMinutes)} / {formatMinutes(month.available)}
      </span>
      <span>
        <ColoredPillBadge tone={meta.tone} label={meta.label} />
      </span>
      <AmountCell month={month} state={state} currency={currency} overageRate={overageRate} />
      <ActionCell
        action={action}
        invoice={month.invoice}
        projectId={projectId}
        month={month}
        isPending={isPending}
        onGenerate={onGenerate}
      />
    </li>
  )
}

function AmountCell({
  month,
  state,
  currency,
  overageRate,
}: {
  month: MonthData
  state: BillingState
  currency: string
  overageRate: number
}) {
  if (state === "in_progress") return <span aria-hidden />

  // Raw ledger view — no rounding (CLAUDE.md: rounding only at invoice generation).
  // Within-budget = €0 (the retainer fee covered the work); over-budget = overage
  // hours × project overageRate.
  const overageHours = state === "over_budget" ? Math.abs(month.endBalance) / 60 : 0
  const amount = state === "over_budget" ? overageHours * overageRate : 0

  return (
    <span
      className={cn(
        "whitespace-nowrap text-right tabular-nums",
        amount === 0 ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {formatCurrency(amount, currency)}
    </span>
  )
}

/** Pure render — see `decideRetainerRowAction` for the rule. */
function ActionCell({
  action,
  invoice,
  projectId,
  month,
  isPending,
  onGenerate,
}: {
  action: RetainerRowAction
  invoice: MonthData["invoice"]
  projectId: Id<"projects">
  month: MonthData
  isPending: boolean
  onGenerate: () => void
}) {
  if (action === "invoice-link" && invoice) {
    return (
      <Link
        href={`/invoices/${formatInvoiceNumber(invoice.prefix, invoice.number)}?from=project&projectId=${projectId}&tab=invoices`}
        className="inline-flex items-center gap-1 justify-self-end font-mono text-xs text-foreground/80 hover:text-foreground hover:underline"
      >
        {formatInvoiceNumber(invoice.prefix, invoice.number)}
        <ExternalLinkIcon className="size-3" />
      </Link>
    )
  }
  if (action === "generate") {
    return (
      <Button
        size="sm"
        onClick={onGenerate}
        disabled={isPending}
        className="justify-self-end"
      >
        Generate
      </Button>
    )
  }
  return <ReportLink projectId={projectId} month={month} />
}

function ReportLink({
  projectId,
  month,
}: {
  projectId: Id<"projects">
  month: MonthData
}) {
  // URL period token: month.month is 1-indexed (1-12).
  const period = `${month.year}-${String(month.month).padStart(2, "0")}`
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="justify-self-end"
    >
      <Link
        href={`/projects/${projectId}/reports/${period}`}
        // Open in a new tab so the user can use the browser's native
        // Print → Save as PDF dialog (PRD user story 18).
        target="_blank"
        rel="noopener"
      >
        <DownloadIcon data-icon="inline-start" className="size-3.5" />
        Report
      </Link>
    </Button>
  )
}

/**
 * Stripe disclaimer line — D11 in `docs/invoicing-refactor.md`. Hardcoded text
 * sourced from project config; no Stripe API integration.
 */
function StripeDisclaimer({
  monthlyFee,
  currency,
}: {
  monthlyFee: number
  currency: string
}) {
  return (
    <p className="text-xs text-muted-foreground">
      Monthly retainer fee ({formatCurrency(monthlyFee, currency)}/mo) is billed
      separately via Stripe. This panel shows hours used and overage billed
      through this tool.
    </p>
  )
}

// ─── Bits ───────────────────────────────────────────────────────────────────────

function SortToggle({
  dir,
  onToggle,
}: {
  dir: "oldest" | "newest"
  onToggle: () => void
}) {
  return (
    <Button variant="ghost" size="sm" onClick={onToggle} className="text-xs text-muted-foreground">
      Sort: {dir} first
      {dir === "oldest" ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />}
    </Button>
  )
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────

function monthKey(m: { year: number; month: number }): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`
}

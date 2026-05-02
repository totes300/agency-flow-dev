"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { FunctionReturnType } from "convex/server"
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon, ExternalLinkIcon } from "lucide-react"
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
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { formatCurrency, formatCycleLabel, formatInvoiceNumber, formatMinutes, formatShortDate } from "@/lib/format"
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

// dot · month · hours · state pill · amount · action — fixed 6-col grid so
// every row aligns vertically regardless of state. Column widths tightened to
// match `prototypes/invoicing-final.html`; gap-3 + px-5 gives the row rhythm
// while keeping the card breathable on 1024px viewports.
const ROW_GRID = "grid grid-cols-[14px_minmax(0,1fr)_92px_112px_92px_112px] items-center gap-3 px-5"

// ─── Main Component ─────────────────────────────────────────────────────────────

export function MonthlyBreakdownCard({
  data,
  projectId,
  projectName,
  currency,
}: {
  data: RetainerData
  projectId: Id<"projects">
  projectName: string
  currency: string
}) {
  const { months, rolloverEnabled, isCycleClosed, cycleLength, utilization, cycleEnd, overageRate, monthlyFee } = data

  // Component-state-only sort — intentional deviation from the URL-state rule
  // (PRD § Further Notes): the toggle is a transient per-visit preference, not
  // part of the page's shareable view.
  const [sortDir, setSortDir] = useState<"oldest" | "newest">("oldest")
  const [activeMonth, setActiveMonth] = useState<{ year: number; month: number } | null>(null)

  // Compute view rows during render — no useEffect sync. Resort is cheap.
  const sortedMonths = useMemo(() => {
    if (sortDir === "oldest") return months
    return [...months].reverse()
  }, [months, sortDir])

  // Oldest closed-uninvoiced row index (in original chronological order) gets
  // the subtle highlight. Only meaningful in monthly settlement mode — rollover
  // cycles bill via the banner, not per-row.
  const highlightKey = useMemo(() => {
    if (rolloverEnabled) return null
    const next = months.find((m) => m.isMonthClosed && !m.invoice)
    return next ? monthKey(next) : null
  }, [months, rolloverEnabled])

  const closedCount = months.filter((m) => m.isMonthClosed).length
  const cycleLabel = formatCycleLabel(months)
  const utilizationPct = Math.round(utilization)
  const cycleEndLabel = formatShortDate(cycleEnd)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 px-6 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Monthly Breakdown</CardTitle>
          {rolloverEnabled && (
            <p className="truncate text-xs text-muted-foreground">
              {cycleLabel} cycle · {closedCount}/{cycleLength} months closed · {utilizationPct}% used
            </p>
          )}
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
          {sortedMonths.map((month) => (
            <MonthRow
              key={monthKey(month)}
              month={month}
              currency={currency}
              overageRate={overageRate}
              monthlyFee={monthlyFee}
              projectId={projectId}
              isHighlighted={!rolloverEnabled && monthKey(month) === highlightKey}
              showGenerate={!rolloverEnabled}
              onGenerate={() => setActiveMonth({ year: month.year, month: month.month + 1 })}
            />
          ))}
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

      {activeMonth && (
        <CreateInvoiceModal
          // Remount per month so prefill resets cleanly
          key={`${projectId}-${activeMonth.year}-${activeMonth.month}`}
          open={true}
          onOpenChange={(next) => {
            if (!next) setActiveMonth(null)
          }}
          projectId={projectId}
          projectName={projectName}
          billingType="retainer"
          currency={currency}
          initialRetainerYear={activeMonth.year}
          initialRetainerMonth={activeMonth.month}
        />
      )}
    </Card>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────────

function MonthRow({
  month,
  currency,
  overageRate,
  monthlyFee,
  projectId,
  isHighlighted,
  showGenerate,
  onGenerate,
}: {
  month: MonthData
  currency: string
  overageRate: number
  monthlyFee: number
  projectId: Id<"projects">
  isHighlighted: boolean
  showGenerate: boolean
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
        month={month}
        projectId={projectId}
        monthlyFee={monthlyFee}
        overageRate={overageRate}
        showGenerate={showGenerate}
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
  // hours × project overageRate. When overageRate isn't configured the cell
  // shows €0 — the missing-rate warning lives in a sibling alert on the page.
  //
  // Color: zero amounts stay muted, non-zero amounts use foreground so the cell
  // reads as a number, not a warning. The state pill carries the warning signal —
  // amber-on-amount + amber pill in the same row was two signals shouting.
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

function ActionCell({
  month,
  projectId,
  monthlyFee,
  overageRate,
  showGenerate,
  onGenerate,
}: {
  month: MonthData
  projectId: Id<"projects">
  monthlyFee: number
  overageRate: number
  showGenerate: boolean
  onGenerate: () => void
}) {
  if (!month.isMonthClosed) return <span aria-hidden />

  // Already invoiced: invoice number IS the link. The statement is omitted
  // here — the invoice document carries the same balance breakdown plus
  // billing detail, so a sibling "Statement" link would be redundant.
  if (month.invoice) {
    return (
      <Link
        href={`/invoices/${month.invoice.id}?from=project&projectId=${projectId}&tab=invoices`}
        className="inline-flex items-center gap-1 justify-self-end font-mono text-xs text-foreground/80 hover:text-foreground hover:underline"
      >
        {formatInvoiceNumber(month.invoice.prefix, month.invoice.number)}
        <ExternalLinkIcon className="size-3" />
      </Link>
    )
  }

  // Closed, no invoice. Decide between Generate (billable) and Statement
  // (informational only). The invariant matches `isInvoiceable` on the
  // server: monthlyFee + overage > 0 → billable. We compute overage from
  // the row's endBalance + project rate so the gate matches what the
  // server-side createInvoice guard would do — no UI / server drift.
  const overageMinutes = month.endBalance < 0 ? Math.abs(month.endBalance) : 0
  const overageAmount = (overageMinutes / 60) * overageRate
  const isInvoiceable = monthlyFee + overageAmount > 0

  // Mid-cycle months in rollover mode: the cycle-end banner handles
  // generation, so we only show Statement here. `showGenerate` mirrors
  // `!rolloverEnabled` from the parent.
  if (isInvoiceable && showGenerate) {
    return (
      <Button size="sm" onClick={onGenerate} className="justify-self-end">
        Generate
      </Button>
    )
  }

  return <StatementLink projectId={projectId} month={month} />
}

function StatementLink({
  projectId,
  month,
}: {
  projectId: Id<"projects">
  month: MonthData
}) {
  // URL period token: month.month is 0-indexed in MonthData.
  const period = `${month.year}-${String(month.month + 1).padStart(2, "0")}`
  return (
    <Button
      asChild
      size="sm"
      variant="outline"
      className="justify-self-end"
    >
      <Link
        href={`/projects/${projectId}/statements/${period}`}
        // Open in a new tab so the user keeps their place on the project
        // page — same gesture as other "view document" links in the app.
        target="_blank"
        rel="noopener"
      >
        <DownloadIcon data-icon="inline-start" className="size-3.5" />
        Statement
      </Link>
    </Button>
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
  return `${m.year}-${String(m.month + 1).padStart(2, "0")}`
}


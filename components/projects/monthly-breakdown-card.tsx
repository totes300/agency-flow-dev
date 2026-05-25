"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import type { FunctionReturnType } from "convex/server"
import { useOrganization } from "@clerk/nextjs"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  ExternalLinkIcon,
  EyeIcon,
  InfoIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
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
import { ColoredPillBadge, type ColoredPillTone } from "@/components/ui/colored-pill-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ClosePeriodModal } from "@/components/projects/close-period-modal"
import { CloseCycleModal } from "@/components/projects/close-cycle-modal"
import { ReopenPeriodDialog } from "@/components/projects/reopen-period-dialog"
import { PeriodDetailSheet } from "@/components/projects/period-detail-sheet"
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
  decideRetainerRowCloseAction,
  type RetainerRowAction,
  type RetainerRowCloseAction,
} from "@/lib/retainer-row-action"
import { cn } from "@/lib/utils"

// ─── Types ──────────────────────────────────────────────────────────────────────

type RetainerData = NonNullable<FunctionReturnType<typeof api.projects.getRetainerData>>
type MonthData = RetainerData["months"][number]
type MonthInvoice = NonNullable<MonthData["invoice"]>

// Phase 8 — pill is lifecycle, not budget. Six states, derived from four axes:
//   calendar  (`periodEnded`)      — has the month ended yet?
//   admin     (`isClosed`)         — did someone click Close (period / cycle)?
//   document  (effective invoice)  — what's the linked invoice's status?
//   structure (rollover position)  — is this row mid-cycle on a rollover project?
//
// States, in priority order:
//   in_progress = current month, still accumulating                 (neutral)
//   closed      = settled via admin close (period OR cycle)         (green)
//   invoiced    = covered by finalized non-void invoice             (green)
//   draft       = on a DRAFT invoice; billing flow started, awaits finalize (amber)
//   rolling     = rollover mid-cycle, ended, no cycle action yet    (neutral)
//   open        = needs action HERE (Close / Generate / Close cycle)(blue)
//
// Tone semantics (Stripe-grade visual hierarchy):
//   neutral (gray)  → passive, nothing for the admin to do right now
//   amber           → billing flow IN FLIGHT, awaits finalize action
//   blue            → admin must MAKE the billing decision here
//   green           → done
//
// Why `rolling` exists: on rollover projects the billing unit is the CYCLE,
// not the month. Mid-cycle rows have no per-row action — settlement happens
// on the cycle-end row (Generate for overage, Close cycle for within-budget).
// `rolling` communicates "tracked, deferred to cycle-end" without lying about
// where the action is.
//
// Why `draft` exists: once `createInvoice` runs, EVERY included entry gets
// `invoiceId` stamped (`convex/invoices.ts:1880`) — so backend-wise those
// entries are in the billing flow. The pill must reflect this honestly.
// Leaving them as `rolling` would lie ("nothing has started yet") when the
// truth is "a draft invoice exists and links to these entries." On rollover
// mid-cycle rows the draft state INHERITS from the cycle-end row's invoice
// (only the anchor carries the link, but all cycle rows are in the flow).
//
// Mid-cycle rows ALSO inherit the `invoiced` terminal state from the cycle's
// finalized invoice. `closed` is per-row (each `retainerPeriods.closedAt`).
//
// `closed` and `invoiced` share green: both are "done." Different reopen
// paths (Reopen period vs void invoice) drive the distinct labels.
//
// Budget signal (within/over) lives in the Amount column, not the pill.
type LifecycleState =
  | "in_progress"
  | "open"
  | "rolling"
  | "draft"
  | "invoiced"
  | "closed"

/**
 * Does an invoice represent a finalized (revenue-bearing) billing event?
 * `draft` doesn't count — the admin is still in the billing flow — and
 * `void` doesn't count — voiding frees the period to be re-billed (the
 * convention used everywhere else in the codebase, see
 * `convex/projects.ts:618`).
 */
function isInvoiceFinalized(inv: MonthInvoice | null | undefined): boolean {
  return inv != null && inv.status !== "draft" && inv.status !== "void"
}

/**
 * Is the invoice in DRAFT state? This is the in-flight billing state — the
 * admin clicked Generate, line items + `invoiceId` stamps exist, but the
 * document hasn't been finalized yet. The row should reflect this as a
 * distinct state from `open` ("nothing has started") and `invoiced`
 * ("billing complete").
 */
function isInvoiceDraft(inv: MonthInvoice | null | undefined): boolean {
  return inv != null && inv.status === "draft"
}

type LifecycleCtx = {
  /** True if the parent project has rolloverEnabled. */
  isRollover: boolean
  /** True if THIS row is the last month of its cycle. */
  isCycleEndRow: boolean
  /**
   * The cycle-end row's `invoice` value (or null). Threaded down from the
   * parent so mid-cycle rows can inherit the cycle's invoice state —
   * `getRetainerData` only anchors the invoice on one row per cycle, but
   * the BILLING flow it represents covers every row in the cycle.
   */
  cycleEndInvoice: MonthInvoice | null
}

function lifecycleStateOf(month: MonthData, ctx: LifecycleCtx): LifecycleState {
  if (!month.periodEnded) return "in_progress"
  if (month.isClosed) return "closed"

  // Rollover mid-cycle rows: state inherits from the CYCLE (not from this
  // row's `month.invoice`, which is null for non-anchor rows). The cycle
  // invoice — draft or finalized — covers EVERY entry in the cycle (each
  // gets `invoiceId` stamped at `createInvoice`), so mid-cycle rows must
  // reflect that. `rolling` is the residual state for "cycle has ended but
  // no billing flow has started yet."
  if (ctx.isRollover && !ctx.isCycleEndRow) {
    if (isInvoiceFinalized(ctx.cycleEndInvoice)) return "invoiced"
    if (isInvoiceDraft(ctx.cycleEndInvoice)) return "draft"
    return "rolling"
  }

  // Cycle-end row of rollover, OR any row of a non-rollover project.
  if (isInvoiceFinalized(month.invoice)) return "invoiced"
  if (isInvoiceDraft(month.invoice)) return "draft"

  // Dev-build invariant: a non-void invoice must be classified either as
  // finalized or draft. If neither branch caught it, an unknown status
  // exists upstream — update the helpers.
  if (process.env.NODE_ENV !== "production" && month.invoice) {
    const inv = month.invoice
    if (inv.status !== "void") {
      console.error(
        `[lifecycleStateOf] Invariant violated: month "${month.label}" with ` +
          `${inv.prefix}${inv.number} (status: ${inv.status}) fell through to ` +
          `"open". Add the status to isInvoiceFinalized / isInvoiceDraft.`,
      )
    }
  }
  return "open"
}

// Use the pill component's own tone vocabulary so the standalone MetricDot
// can never drift from the pill chrome.
type ToneKey = ColoredPillTone

const TONE_DOT: Record<ToneKey, string> = {
  neutral: "bg-muted-foreground/40",
  blue: "bg-blue-500",
  green: "bg-green-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
}

// Single source of truth for label + tone — pill, dot, and legend all read
// from one record so the mapping never drifts.
//
//   in_progress → neutral (muted, the eye skips it)
//   rolling     → neutral (tracked, no action — defers to cycle-end)
//   open        → blue    (admin must MAKE the billing decision here)
//   draft       → amber   (billing flow STARTED — finalize the draft invoice)
//   invoiced    → green   (done; billed via a finalized invoice)
//   closed      → green   (done; admin-closed via Close period or Close cycle)
const STATE_META: Record<LifecycleState, { label: string; tone: ToneKey }> = {
  in_progress: { label: "in progress", tone: "neutral" },
  rolling: { label: "rolling", tone: "neutral" },
  open: { label: "open", tone: "blue" },
  draft: { label: "draft", tone: "amber" },
  invoiced: { label: "invoiced", tone: "green" },
  closed: { label: "closed", tone: "green" },
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
  // Phase 8 Slice 3 — close/reopen are admin-only actions. Members render
  // the row without `Close` / `Reopen` affordances; the read-only `↓ Report`
  // primary stays for them on `open` rows.
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"

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

  // Phase 8 Slice 4 — parallel CLOSE action axis. The billing axis above
  // is "should this row Generate / link to an invoice?"; this one is
  // "should this row offer admin close — month or cycle?". They coexist
  // because the close button only appears when the billing axis is `report`.
  const allCycleMonthsEnded = useMemo(
    () => months.every((m) => m.periodEnded),
    [months],
  )
  const closeActionByMonthKey = useMemo(() => {
    const ctx = {
      isRollover: rolloverEnabled,
      cycleLength,
      cycleHasOverage: overageDue > 0,
      overageRate,
      isCycleClosed,
      allCycleMonthsEnded,
      isAdmin: !!isAdmin,
      isMonthAlreadyClosed: false, // overridden per-row below
    }
    const out = new Map<string, RetainerRowCloseAction>()
    for (const m of months) {
      out.set(
        monthKey(m),
        decideRetainerRowCloseAction(m, {
          ...ctx,
          isMonthAlreadyClosed: m.isClosed,
        }),
      )
    }
    return out
  }, [
    months,
    rolloverEnabled,
    cycleLength,
    overageDue,
    overageRate,
    isCycleClosed,
    allCycleMonthsEnded,
    isAdmin,
  ])

  // Cycle-end metadata — used by the cycle close modal to render the right
  // statement and call the right mutation. `cycleStart` is the first
  // month's `startDate`; cycle label is the existing `formatCycleLabel`.
  const firstCycleMonth = months[0]
  const lastCycleMonth = months[months.length - 1]
  const cycleStartDate = firstCycleMonth?.startDate ?? ""

  // Cycle-end row's invoice — single source of truth for "is the cycle
  // billed?" on rollover projects. `getRetainerData` only anchors the
  // cycle invoice on the cycle-end month (`getInvoiceAnchorMonthKey`);
  // mid-cycle rows have `month.invoice = null` even when the cycle has
  // been invoiced. We thread this down so `lifecycleStateOf` can derive
  // the inherited `invoiced` state on mid-cycle rows.
  const cycleEndInvoice = lastCycleMonth?.invoice ?? null

  const highlightKey = useMemo(() => {
    for (const m of months) {
      const key = monthKey(m)
      if (actionByMonthKey.get(key) === "generate") return key
    }
    return null
  }, [months, actionByMonthKey])

  // Phase 8 — header counter is calendar-based ("N of N ended"), not admin.
  // Picking the calendar meaning keeps the number stable across the same
  // visit regardless of whether someone has clicked Close yet; per-row
  // closed-vs-open is visible from the pill.
  const endedCount = months.filter((m) => m.periodEnded).length
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
              {cycleLabel} cycle · {endedCount}/{cycleLength} months ended · {utilizationPct}% used
            </p>
          )}
          <StripeDisclaimer monthlyFee={monthlyFee} currency={currency} />
        </div>
        {rolloverEnabled ? (
          // Phase 8 lexicon: `ended` for calendar, `closed` for admin close
          // (Slice 2 Revision Pass #1). Using "closed" here would collide
          // with the row-level `closed` pill on the same card, which
          // means admin-settled — different concept, same screen.
          <ColoredPillBadge
            tone="neutral"
            label={`Cycle ${isCycleClosed ? "ended" : "ends"} ${cycleEndLabel}`}
          />
        ) : (
          <SortToggle
            dir={sortDir}
            onToggle={() => setSortDir((d) => (d === "oldest" ? "newest" : "oldest"))}
          />
        )}
      </CardHeader>

      <CardContent className="px-0 pb-0">
        <TooltipProvider>
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
            <BilledHereHeader />
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
                  closeAction={closeActionByMonthKey.get(key) ?? null}
                  cycleStart={cycleStartDate}
                  cycleEndYear={lastCycleMonth?.year ?? month.year}
                  cycleEndMonth={lastCycleMonth?.month ?? month.month}
                  cycleLabel={cycleLabel}
                  cycleEndInvoice={cycleEndInvoice}
                  currency={currency}
                  overageRate={overageRate}
                  isRollover={rolloverEnabled}
                  isCycleEndRow={month.cyclePosition === cycleLength}
                  projectId={projectId}
                  isAdmin={isAdmin}
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
        </TooltipProvider>

        {/* Footer legend — documents the dot semantics so the row chrome stays
            minimal. `rolling` only applies to rollover projects, so we hide it
            on non-rollover to keep the legend tight and accurate. */}
        <div className="flex items-center gap-5 border-t px-6 py-3 text-xs text-muted-foreground">
          {(Object.keys(STATE_META) as LifecycleState[])
            .filter((state) => state !== "rolling" || rolloverEnabled)
            .map((state) => (
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
  closeAction,
  cycleStart,
  cycleEndYear,
  cycleEndMonth,
  cycleLabel,
  cycleEndInvoice,
  currency,
  overageRate,
  isRollover,
  isCycleEndRow,
  projectId,
  isAdmin,
  isHighlighted,
  isPending,
  onGenerate,
}: {
  month: MonthData
  action: RetainerRowAction
  closeAction: RetainerRowCloseAction
  cycleStart: string
  cycleEndYear: number
  cycleEndMonth: number
  cycleLabel: string
  cycleEndInvoice: MonthInvoice | null
  currency: string
  overageRate: number
  isRollover: boolean
  isCycleEndRow: boolean
  projectId: Id<"projects">
  isAdmin: boolean
  isHighlighted: boolean
  isPending: boolean
  onGenerate: () => void
}) {
  const state = lifecycleStateOf(month, {
    isRollover,
    isCycleEndRow,
    cycleEndInvoice,
  })
  const meta = STATE_META[state]
  // Slice 4 — period drill-down opens on row click (and from `View
  // entries` overflow). Row click is the affordance for "what was
  // logged?"; the existing buttons/overflow handle "act on this row".
  const [drillDownOpen, setDrillDownOpen] = useState(false)

  return (
    <>
      <li
        className={cn(
          ROW_GRID,
          "py-3 text-sm transition-colors hover:bg-muted/30",
          isHighlighted && "bg-muted/30",
        )}
      >
        <MetricDot tone={meta.tone} />
        {/* The month label is the row-click target — buttoned for keyboard
            access. Action buttons in the right-most cell don't bubble into
            the drill-down because they stop propagation themselves. */}
        <button
          type="button"
          onClick={() => setDrillDownOpen(true)}
          aria-label={`View entries for ${month.label}`}
          className={cn(
            "min-w-0 truncate text-left hover:underline focus-visible:underline focus-visible:outline-none",
            isHighlighted && "font-medium",
            state === "in_progress" && "text-muted-foreground",
          )}
        >
          {month.label}
        </button>
        <span className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
          {formatMinutes(month.workedMinutes)} / {formatMinutes(month.available)}
        </span>
        <span>
          <ColoredPillBadge tone={meta.tone} label={meta.label} />
        </span>
        <AmountCell
          month={month}
          state={state}
          currency={currency}
          overageRate={overageRate}
          isRollover={isRollover}
          isCycleEndRow={isCycleEndRow}
        />
        <ActionCell
          action={action}
          closeAction={closeAction}
          invoice={month.invoice}
          projectId={projectId}
          month={month}
          state={state}
          isAdmin={isAdmin}
          isPending={isPending}
          onGenerate={onGenerate}
          onOpenDrillDown={() => setDrillDownOpen(true)}
          cycleStart={cycleStart}
          cycleEndYear={cycleEndYear}
          cycleEndMonth={cycleEndMonth}
          cycleLabel={cycleLabel}
        />
      </li>
      <PeriodDetailSheet
        open={drillDownOpen}
        onOpenChange={setDrillDownOpen}
        projectId={projectId}
        periodStart={month.startDate}
        periodEnd={month.endDate}
        periodLabel={month.label}
        currency={currency}
      />
    </>
  )
}

function AmountCell({
  month,
  state,
  currency,
  overageRate,
  isRollover,
  isCycleEndRow,
}: {
  month: MonthData
  state: LifecycleState
  currency: string
  overageRate: number
  isRollover: boolean
  isCycleEndRow: boolean
}) {
  if (state === "in_progress") return <span aria-hidden />

  // Rollover mid-cycle rows are NOT a billing unit. In rollover mode, mid-
  // cycle deficits roll forward — only the cycle-end row carries the real
  // bill. Showing a per-month dollar amount here would imply this month is
  // owed money it isn't (e.g. on a 3-month cycle with a single $720 cycle
  // overage, displaying $240/$480/$720 across the three rows reads as a
  // $1,440 total — a wrong-action hazard if an admin trusts the column).
  //
  // The em-dash (`—`) is the Stripe convention for "not applicable to this
  // row" and is semantically distinct from `$0.00` ("this row has zero").
  // The Hours column already communicates the rollover dynamic via the
  // shrinking "available" denominator, so no information is lost — only
  // the false billing implication.
  if (isRollover && !isCycleEndRow) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="whitespace-nowrap text-right text-muted-foreground/70 tabular-nums">
            —
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          Rollover: this month&apos;s hours roll into the cycle. The cycle&apos;s
          overage is billed once on the final month.
        </TooltipContent>
      </Tooltip>
    )
  }

  // Raw ledger view — no rounding (CLAUDE.md: rounding only at invoice generation).
  // Over-budget = overage hours × project overageRate; otherwise $0 (the
  // retainer fee covered the work). For non-rollover this is the per-month
  // overage; for rollover cycle-end the chained `endBalance` equals the
  // cycle aggregate, so the same formula yields the cycle total.
  const overageHours = month.endBalance < 0 ? Math.abs(month.endBalance) / 60 : 0
  const amount = overageHours * overageRate

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

/**
 * Phase 8 Slice 3 + Slice 4 — per-row primary CTA + `⋯` overflow.
 *
 * Two-axis dispatch:
 *   - Billing axis (`action`) decides Generate / invoice link / Report.
 *   - Close axis (`closeAction`) decides whether the "Report" branch
 *     becomes `Close` (month) or `Close cycle` (cycle-end row).
 *
 * Overflow contents per state (Slice 4 completes the matrix):
 *   - any closed row (admin):       `Reopen period`, `View entries`.
 *   - open within-budget (admin):   `Download report`, `View entries`.
 *   - in_progress / open-overage:   `View entries` (Slice 4 — drill-down
 *     is the same surface for any row that has logged time).
 */
function ActionCell({
  action,
  closeAction,
  invoice,
  projectId,
  month,
  state,
  isAdmin,
  isPending,
  onGenerate,
  onOpenDrillDown,
  cycleStart,
  cycleEndYear,
  cycleEndMonth,
  cycleLabel,
}: {
  action: RetainerRowAction
  closeAction: RetainerRowCloseAction
  invoice: MonthData["invoice"]
  projectId: Id<"projects">
  month: MonthData
  state: LifecycleState
  isAdmin: boolean
  isPending: boolean
  onGenerate: () => void
  onOpenDrillDown: () => void
  cycleStart: string
  cycleEndYear: number
  cycleEndMonth: number
  cycleLabel: string
}) {
  // Modal/dialog state lives at the cell level — each row has its own
  // instance so the modal anchors visually to the row that triggered it
  // and unmounts cleanly when the row scrolls/re-orders.
  const [closeMonthOpen, setCloseMonthOpen] = useState(false)
  const [closeCycleOpen, setCloseCycleOpen] = useState(false)
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false)

  const viewEntriesItem = (
    <DropdownMenuItem onSelect={onOpenDrillDown}>
      <EyeIcon className="size-3.5" aria-hidden />
      View entries
    </DropdownMenuItem>
  )

  // Invoice link short-circuit — primary stays the existing link.
  if (action === "invoice-link" && invoice) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Link
          href={`/invoices/${formatInvoiceNumber(invoice.prefix, invoice.number)}?from=project&projectId=${projectId}&tab=invoices`}
          className="inline-flex items-center gap-1 font-mono text-xs text-foreground/80 hover:text-foreground hover:underline"
        >
          {formatInvoiceNumber(invoice.prefix, invoice.number)}
          <ExternalLinkIcon className="size-3" />
        </Link>
        <RowOverflow ariaLabel={`More actions for ${month.label}`}>
          {viewEntriesItem}
        </RowOverflow>
      </div>
    )
  }

  // Overage bill — primary stays Generate.
  if (action === "generate") {
    return (
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" onClick={onGenerate} disabled={isPending}>
          Generate
        </Button>
        <RowOverflow ariaLabel={`More actions for ${month.label}`}>
          {viewEntriesItem}
        </RowOverflow>
      </div>
    )
  }

  // `action === "report"` from here on — three sub-states.
  if (state === "closed") {
    return (
      <div className="flex items-center justify-end gap-1">
        <ReportLink projectId={projectId} month={month} />
        <RowOverflow ariaLabel={`More actions for ${month.label}`}>
          {isAdmin && (
            <DropdownMenuItem onSelect={() => setReopenDialogOpen(true)}>
              <RotateCcwIcon className="size-3.5" aria-hidden />
              Reopen period
            </DropdownMenuItem>
          )}
          {viewEntriesItem}
        </RowOverflow>
        {isAdmin && (
          <ReopenPeriodDialog
            open={reopenDialogOpen}
            onOpenChange={setReopenDialogOpen}
            projectId={projectId}
            periodStart={month.startDate}
            periodLabel={month.label}
            workedMinutes={month.workedMinutes}
          />
        )}
      </div>
    )
  }

  // open + admin — `closeAction` decides whether the primary button is
  // `Close` (single month) or `Close cycle` (rollover, on the cycle-end
  // row when the whole cycle is settled-shaped and within budget).
  if (state === "open" && isAdmin && closeAction !== null) {
    const isCycleVariant = closeAction === "close-cycle"
    return (
      <div className="flex items-center justify-end gap-1">
        <Button
          size="sm"
          onClick={() =>
            isCycleVariant ? setCloseCycleOpen(true) : setCloseMonthOpen(true)
          }
        >
          {isCycleVariant ? "Close cycle" : "Close"}
        </Button>
        <RowOverflow ariaLabel={`More actions for ${month.label}`}>
          <DropdownMenuItem asChild>
            <Link
              href={`/projects/${projectId}/reports/${periodToken(month)}`}
              target="_blank"
              rel="noopener"
            >
              <DownloadIcon className="size-3.5" aria-hidden />
              Download report
            </Link>
          </DropdownMenuItem>
          {viewEntriesItem}
        </RowOverflow>
        <ClosePeriodModal
          open={closeMonthOpen}
          onOpenChange={setCloseMonthOpen}
          projectId={projectId}
          year={month.year}
          month={month.month}
          periodStart={month.startDate}
          periodLabel={month.label}
        />
        {isCycleVariant && (
          <CloseCycleModal
            open={closeCycleOpen}
            onOpenChange={setCloseCycleOpen}
            projectId={projectId}
            cycleStart={cycleStart}
            cycleEndYear={cycleEndYear}
            cycleEndMonth={cycleEndMonth}
            cycleLabel={cycleLabel}
          />
        )}
      </div>
    )
  }

  // in_progress (current month) OR open + member → standalone Report link
  // + `View entries` in the overflow (Slice 4).
  return (
    <div className="flex items-center justify-end gap-1">
      <ReportLink projectId={projectId} month={month} />
      <RowOverflow ariaLabel={`More actions for ${month.label}`}>
        {viewEntriesItem}
      </RowOverflow>
    </div>
  )
}

/** `⋯` overflow trigger with consistent sizing across rows. */
function RowOverflow({
  ariaLabel,
  children,
}: {
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={ariaLabel}
          className="text-muted-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
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

// ─── Column header bits ─────────────────────────────────────────────────────────

/**
 * Amount-column header — Principle #6 of the parent PRD revision pass. The
 * label is `Billed here` (not `Amount`) and a tooltip clarifies that this
 * column shows only overage billed through this tool; the monthly retainer
 * fee is charged separately (Stripe today). Without the label change the
 * column reads as if it should equal the total bill to the client and
 * silently misleads.
 */
function BilledHereHeader() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center justify-end gap-1 self-end justify-self-end">
          <span>Billed here</span>
          <InfoIcon
            className="size-3 text-muted-foreground/70"
            aria-hidden
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        Only overage billed through this tool. The retainer monthly fee is
        charged separately (currently via Stripe). In rollover cycles, only
        the final month carries the cycle&apos;s overage amount — earlier
        months show &ldquo;—&rdquo; because their hours roll into the cycle.
      </TooltipContent>
    </Tooltip>
  )
}

// ─── Pure helpers ───────────────────────────────────────────────────────────────

function monthKey(m: { year: number; month: number }): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`
}

/** URL period token used by the report page route. Matches `ReportLink`. */
function periodToken(m: { year: number; month: number }): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`
}

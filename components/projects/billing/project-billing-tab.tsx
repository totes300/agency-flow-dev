"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { ConvexError } from "convex/values"
import { FileSpreadsheetIcon, FileTextIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import type { PeriodInvoice, PeriodRow, ProjectBillingPeriods } from "@/convex/lib/billing/projectPeriods"
import { periodPrimaryAction, periodUndoActions, type PeriodState } from "@/convex/lib/billing/periodState"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InvoiceStateChip, PeriodStateChip } from "@/components/billing/period-state-chip"
import {
  DocumentIconLink,
  PeriodActionButton,
  PeriodMenu,
  WorksheetIconButton,
  invoiceHref,
  monthlyReportHref,
  usePeriodActions,
} from "@/components/billing/period-actions"
import { PeriodDetailSheet } from "@/components/projects/period-detail-sheet"
import { rateRangeLabel } from "@/components/projects/overview/project-side-panel"
import { shortDate } from "@/components/projects/overview/period-card"
import { formatMinor, formatMinutes } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/**
 * The project Billing tab (docs/prd-project-billing-redesign.md §7.4,
 * replaces Invoices): every period of the project with its state, its one
 * action and its documents — the cross-period view the period card leaves
 * out (P4/P5). Fixed fee lists its installment invoices instead.
 */
export function ProjectBillingTab({
  projectId,
  model,
  onSelectPeriod,
}: {
  projectId: Id<"projects">
  model: ProjectBillingPeriods | undefined | null
  onSelectPeriod: (key: string) => void
}) {
  const from = `/projects/${projectId}?tab=billing`
  const actions = usePeriodActions(from)
  const [entriesFor, setEntriesFor] = useState<PeriodRow | null>(null)

  if (model === undefined) return <BillingTabSkeleton />
  if (model === null) return null

  const retainer = model.billingType === "retainer"
  const fixed = model.billingType === "fixed"
  const latest = model.latestInvoice
  const cols = "grid-cols-[minmax(120px,1fr)_128px_116px_84px_84px_132px_84px]"

  return (
    <div className="flex flex-col">
      <h2 className="text-2xl leading-tight font-semibold tracking-tight">Billing</h2>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">{termsLine(model)}</p>

      <div className="mt-5 grid grid-cols-3 divide-x divide-border/60 rounded-xl bg-background ring-1 ring-border/70">
        <Tile label={retainer ? "Unbilled overage" : "Unbilled"}>
          <span className={cn(model.totals.unbilledMinor === 0 && "text-muted-foreground")}>
            {formatMinor(model.totals.unbilledMinor, model.currency)}
          </span>
        </Tile>
        <Tile label="Outstanding">
          {formatMinor(model.totals.outstandingMinor, model.currency)}
          {model.pastDueCount > 0 ? (
            <span className="ml-1.5 text-xs font-medium text-destructive">· {model.pastDueCount} past due</span>
          ) : null}
        </Tile>
        <Tile label="Latest invoice">
          {latest ? (
            <span className="text-sm">
              {latest.number ? (
                <>
                  <span className="font-mono">{latest.number}</span>
                  <span className="font-normal text-muted-foreground"> · {latest.status.replace("_", " ")}</span>
                </>
              ) : (
                <span>Draft invoice</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Tile>
      </div>

      {fixed ? (
        <FixedInvoices projectId={projectId} model={model} from={from} actions={actions} />
      ) : model.periods.length === 0 ? (
        <Empty className="mt-8">
          <EmptyHeader>
            <EmptyTitle>No billing periods yet</EmptyTitle>
            <EmptyDescription>
              {retainer ? "Set the retainer start date in Settings to start its periods." : "Billable time appears here by month."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-7 overflow-x-auto" role="table">
          <div
            role="row"
            className={cn("grid h-[34px] items-center gap-x-3 border-b border-border/60 px-2 text-xs text-muted-foreground", cols)}
          >
            <span>{model.terms.rolloverEnabled && model.terms.cycleLength > 1 ? "Cycle" : "Month"}</span>
            <span>Status</span>
            <span>Hours</span>
            <span>{retainer ? "Overage" : "Amount"}</span>
            <span>Invoice</span>
            <span />
            <span className="text-right">Files</span>
          </div>
          {model.periods.map((row) => {
            const over = row.includedMinutes !== null && row.usageMinutes > row.includedMinutes
            return (
              <div
                key={row.key}
                role="row"
                tabIndex={0}
                onClick={() => onSelectPeriod(row.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelectPeriod(row.key)
                }}
                className={cn(
                  "group/row grid min-h-11 cursor-pointer items-center gap-x-3 border-b border-border/60 px-2 py-1.5 text-sm hover:bg-muted/50",
                  cols,
                )}
              >
                <span className="truncate font-medium">{row.label}</span>
                <span>
                  <PeriodStateChip state={row.state} />
                </span>
                <span className={cn("font-mono text-xs", over ? "text-destructive" : "text-muted-foreground")}>
                  {formatMinutes(row.usageMinutes)}
                  {row.includedMinutes !== null ? (
                    <span className="text-muted-foreground"> / {formatMinutes(row.includedMinutes)}</span>
                  ) : null}
                </span>
                <span className={cn("font-mono text-xs", row.amountMinor > 0 ? "text-foreground" : "text-muted-foreground")}>
                  {row.amountMinor > 0 ? formatMinor(row.amountMinor, model.currency) : "—"}
                </span>
                <span className="font-mono text-xs">
                  {row.invoice?.number ?? (row.invoice ? "Draft" : <span className="text-muted-foreground">—</span>)}
                </span>
                <span className="flex flex-col items-start gap-0.5">
                  {row.action ? (
                    <PeriodActionButton
                      action={row.action}
                      className="h-[26px] px-2.5 text-xs"
                      onRun={() => actions.primary({ row, invoice: row.invoice, projectId }, row.action!)}
                    />
                  ) : null}
                  {row.action?.blocked ? (
                    <span className="text-[11px] text-muted-foreground">{row.action.blocked.reason}</span>
                  ) : null}
                </span>
                <span className="flex items-center justify-end">
                  {row.documents.monthlyReport ? (
                    <DocumentIconLink
                      href={monthlyReportHref(projectId, row, model.timezoneToday)}
                      label="Monthly report"
                      icon={<FileTextIcon />}
                    />
                  ) : null}
                  <WorksheetIconButton projectId={projectId} row={row} icon={<FileSpreadsheetIcon />} />
                  <PeriodMenu
                    projectId={projectId}
                    row={row}
                    undoItems={row.undo}
                    onViewEntries={() => setEntriesFor(row)}
                    onUndo={(item) => actions.undo({ row, invoice: row.invoice, projectId }, item)}
                    triggerClassName="size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  />
                </span>
              </div>
            )
          })}
        </div>
      )}

      {entriesFor ? (
        <PeriodDetailSheet
          open
          onOpenChange={(open) => {
            if (!open) setEntriesFor(null)
          }}
          projectId={projectId}
          periodStart={entriesFor.start}
          periodEnd={entriesFor.end}
          periodLabel={entriesFor.label}
          currency={model.currency}
        />
      ) : null}
      {actions.dialogs}
    </div>
  )
}

/** "Retainer · 08:00 included · $800.00 / month · overage $100.00 / h" and the T&M / fixed variants. */
function termsLine(model: ProjectBillingPeriods): string {
  const { terms, currency } = model
  if (model.billingType === "retainer") {
    return [
      "Retainer",
      terms.includedMinutesPerMonth !== null ? `${formatMinutes(terms.includedMinutesPerMonth)} included` : null,
      terms.monthlyFeeMinor !== null ? `${formatMinor(terms.monthlyFeeMinor, currency)} / month` : null,
      terms.overageRateMinor !== null ? `overage ${formatMinor(terms.overageRateMinor, currency)} / h` : "no overage rate",
      terms.rolloverEnabled ? `${terms.cycleLength}-month rollover` : null,
    ]
      .filter(Boolean)
      .join(" · ")
  }
  if (model.billingType === "t_and_m") {
    return ["Time & materials", rateRangeLabel(terms.rateRangeMinor, currency)].filter(Boolean).join(" · ")
  }
  return `Fixed fee · ${formatMinor(terms.fixedPriceMinor ?? 0, currency)}`
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-[18px] py-3.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tracking-tight tabular-nums">{children}</span>
    </div>
  )
}

/** Fixed fee (§7.4): the installment invoices + Create invoice / Open draft. */
function FixedInvoices({
  projectId,
  model,
  from,
  actions,
}: {
  projectId: Id<"projects">
  model: ProjectBillingPeriods
  from: string
  actions: ReturnType<typeof usePeriodActions>
}) {
  const router = useRouter()
  const createFixedInvoice = useMutation(api.billingInvoices.createFixedInvoice)
  const [creating, setCreating] = useState(false)
  const fixed = model.fixed
  const cols = "grid-cols-[100px_minmax(120px,1fr)_88px_88px_110px_120px_150px_28px]"

  async function create() {
    setCreating(true)
    try {
      const { invoiceId } = await createFixedInvoice({ projectId })
      router.push(invoiceHref(invoiceId, from))
    } catch (err) {
      const data = err instanceof ConvexError ? (err.data as { code?: string; invoiceId?: Id<"invoices"> }) : null
      if (data?.code === "DRAFT_EXISTS" && data.invoiceId) router.push(invoiceHref(data.invoiceId, from))
      else toastError(err, "Failed to create the invoice")
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <div className="mt-7 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Invoices</h3>
        {fixed?.draft ? (
          <Button asChild variant="outline" size="sm">
            <Link href={invoiceHref(fixed.draft.id, from)}>Open draft</Link>
          </Button>
        ) : fixed && fixed.remainingMinor > 0 ? (
          <Button size="sm" className="bg-foreground text-background hover:bg-foreground/85" onClick={create} disabled={creating}>
            Create invoice
          </Button>
        ) : null}
      </div>
      {model.invoices.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No invoices yet. Create the first installment.</p>
      ) : (
        <div className="-mx-4 mt-3 overflow-x-auto md:-mx-6" role="table">
          <div role="row" className={cn("grid h-[34px] items-center gap-x-3 border-b border-border/60 px-4 text-xs text-muted-foreground md:px-6", cols)}>
            <span>Number</span>
            <span>Status</span>
            <span>Issued</span>
            <span>Due</span>
            <span>Amount</span>
            <span />
            <span />
            <span />
          </div>
          {model.invoices.map((inv) => (
            <FixedInvoiceRow key={inv.id} projectId={projectId} inv={inv} currency={model.currency} cols={cols} from={from} actions={actions} />
          ))}
        </div>
      )}
    </>
  )
}

function FixedInvoiceRow({
  projectId,
  inv,
  currency,
  cols,
  from,
  actions,
}: {
  projectId: Id<"projects">
  inv: PeriodInvoice
  currency: string
  cols: string
  from: string
  actions: ReturnType<typeof usePeriodActions>
}) {
  const router = useRouter()
  const state: PeriodState | null = inv.status === "void" ? null : inv.status
  const action = state ? periodPrimaryAction(state, { isCommittable: false }) : null
  const undo = state ? periodUndoActions(state, { draftNumbered: inv.number !== null }) : []
  const target = { row: null, invoice: inv, projectId }
  return (
    <div
      role="row"
      onClick={() => router.push(invoiceHref(inv.id, from))}
      className={cn("group/row grid h-11 cursor-pointer items-center gap-x-3 border-b border-border/60 px-4 text-sm hover:bg-muted/50 md:px-6", cols)}
    >
      <span className="font-mono text-xs">{inv.number ?? "Draft"}</span>
      <span>
        <InvoiceStateChip status={inv.status} />
      </span>
      <span className="font-mono text-xs text-muted-foreground">{shortDate(inv.issueDate)}</span>
      <span className={cn("font-mono text-xs", inv.status === "past_due" ? "text-destructive" : "text-muted-foreground")}>
        {inv.dueDate ? shortDate(inv.dueDate) : "—"}
      </span>
      <span className="font-mono text-xs">{formatMinor(inv.totalMinor, currency)}</span>
      <span />
      <span>
        {action ? (
          <PeriodActionButton action={action} className="h-[26px] px-2.5 text-xs" onRun={() => actions.primary(target, action)} />
        ) : null}
      </span>
      <span>
        {undo.length > 0 ? (
          <PeriodMenu
            projectId={projectId}
            undoItems={undo}
            onUndo={(item) => actions.undo(target, item)}
            triggerClassName="size-6 opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100"
          />
        ) : null}
      </span>
    </div>
  )
}

function BillingTabSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-4 w-80" />
      <Skeleton className="mt-3 h-[72px] w-full rounded-xl" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

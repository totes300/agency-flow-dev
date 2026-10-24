"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { CheckCircle2Icon, Loader2Icon, XIcon } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  INVOICE_STATUS_COPY,
  invoiceDisplayStatus,
  periodPrimaryAction,
  periodUndoActions,
  type InvoiceDisplayStatus,
  type PeriodState,
} from "@/convex/lib/billing/periodState"
import type { PeriodInvoice } from "@/convex/lib/billing/projectPeriods"
import { periodRangeLabel } from "@/convex/lib/billing/projectPeriods"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { InvoiceStateChip } from "@/components/billing/period-state-chip"
import { PeriodActionButton, PeriodMenu, invoiceHref, usePeriodActions } from "@/components/billing/period-actions"
import { shortDate } from "@/components/projects/overview/period-card"
import { shortPeriod } from "@/components/billing/needs-action-list"
import { formatInvoiceNumber, formatMinor, pluralize } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

/** One `listAllInvoices` row. */
export type HubInvoice = {
  _id: Id<"invoices">
  number?: number
  prefix: string
  status: "draft" | "invoiced" | "paid" | "void"
  currency: string
  totalMinor: number
  issueDate: string
  dueDate?: string
  paidAt?: number
  projectId: Id<"projects">
  clientId: Id<"clients">
  projectName: string
  clientName: string
  period: { start: string; end: string } | null
}

export type InvoiceStatusFilter = "all" | InvoiceDisplayStatus
export const INVOICE_STATUS_FILTERS: InvoiceStatusFilter[] = ["all", "draft", "invoiced", "past_due", "paid", "void"]

export function displayStatusOf(inv: HubInvoice, todayStr: string): InvoiceDisplayStatus {
  return invoiceDisplayStatus(inv.status, inv.dueDate, todayStr)
}

const COLS = "grid-cols-[28px_96px_minmax(140px,1fr)_minmax(140px,1fr)_110px_72px_72px_104px_104px_28px]"

/**
 * Billing hub → Invoices (§8 step 5): the invoice ledger. Status pills and
 * "+ Filter" live in the page; this renders the rows, the per-row action and
 * undo, and the bulk Mark as paid with its 5-second undo. There is no bulk
 * void (drafts are deleted one by one, A8).
 */
export function HubInvoiceTable({
  invoices,
  todayStr,
  from,
}: {
  invoices: HubInvoice[]
  todayStr: string
  from: string
}) {
  const router = useRouter()
  const actions = usePeriodActions(from)
  const [selected, setSelected] = useState<ReadonlySet<Id<"invoices">>>(new Set())
  const selectedRows = invoices.filter((i) => selected.has(i._id))

  if (invoices.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>No invoices</EmptyTitle>
          <EmptyDescription>Nothing matches this status and filter.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const payable = invoices.filter((i) => i.status === "invoiced")
  const allPayableSelected = payable.length > 0 && payable.every((i) => selected.has(i._id))

  return (
    <div className="overflow-x-auto" role="table">
      <div role="row" className={cn("grid h-[34px] items-center gap-x-3 border-b border-border/60 px-3 text-xs text-muted-foreground", COLS)}>
        <span>
          <Checkbox
            aria-label="Select all invoiced"
            checked={allPayableSelected}
            disabled={payable.length === 0}
            onCheckedChange={(v) => setSelected(v ? new Set(payable.map((i) => i._id)) : new Set())}
          />
        </span>
        <span>Number</span>
        <span>Client</span>
        <span>Project</span>
        <span>Period</span>
        <span>Issued</span>
        <span>Due</span>
        <span>Amount</span>
        <span>Status</span>
        <span />
      </div>
      {invoices.map((inv) => {
        const status = displayStatusOf(inv, todayStr)
        const state: PeriodState | null = status === "void" ? null : status
        const view: PeriodInvoice = {
          id: inv._id,
          number: inv.number != null ? formatInvoiceNumber(inv.prefix, inv.number) : null,
          status,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate ?? null,
          paidAt: inv.paidAt ?? null,
          totalMinor: inv.totalMinor,
        }
        const action = state ? periodPrimaryAction(state, { isCommittable: false }) : null
        const undo = state ? periodUndoActions(state, { draftNumbered: inv.number != null }) : []
        const target = { row: null, invoice: view, projectId: inv.projectId }
        return (
          <div
            key={inv._id}
            role="row"
            onClick={() => router.push(invoiceHref(inv._id, from))}
            className={cn(
              "group/row grid h-11 cursor-pointer items-center gap-x-3 border-b border-border/60 px-3 text-sm hover:bg-muted/50",
              selected.has(inv._id) && "bg-blue-500/5",
              COLS,
            )}
          >
            <span onClick={(e) => e.stopPropagation()}>
              {inv.status === "invoiced" ? (
                <Checkbox
                  aria-label={`Select ${view.number ?? "invoice"}`}
                  checked={selected.has(inv._id)}
                  onCheckedChange={(v) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(inv._id)
                      else next.delete(inv._id)
                      return next
                    })
                  }
                />
              ) : null}
            </span>
            <span className="font-mono text-xs">{view.number ?? "Draft"}</span>
            <span className="truncate">{inv.clientName}</span>
            <span className="truncate text-muted-foreground">{inv.projectName}</span>
            <span className="truncate text-muted-foreground">
              {inv.period ? shortPeriod({ ...inv.period, label: periodRangeLabel(inv.period.start, inv.period.end) }) : "Fixed fee"}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{inv.number != null ? shortDate(inv.issueDate) : "—"}</span>
            <span className={cn("font-mono text-xs", status === "past_due" ? "text-destructive" : "text-muted-foreground")}>
              {inv.dueDate && inv.status !== "draft" ? shortDate(inv.dueDate) : "—"}
            </span>
            <span className="font-mono text-xs">{formatMinor(inv.totalMinor, inv.currency)}</span>
            <span className="flex items-center gap-2">
              <InvoiceStateChip status={status} />
            </span>
            <span className="flex items-center justify-end gap-1">
              {action && action.kind === "mark_paid" ? (
                <span className="hidden group-hover/row:inline-flex">
                  <PeriodActionButton action={action} className="h-[26px] px-2.5 text-xs" onRun={() => actions.primary(target, action)} />
                </span>
              ) : null}
              {undo.length > 0 ? (
                <PeriodMenu
                  projectId={inv.projectId}
                  undoItems={undo}
                  onUndo={(item) => actions.undo(target, item)}
                  triggerClassName="size-6 opacity-0 group-hover/row:opacity-100 aria-expanded:opacity-100"
                />
              ) : null}
            </span>
          </div>
        )
      })}
      <BulkMarkPaid rows={selectedRows} onClear={() => setSelected(new Set())} />
      {actions.dialogs}
    </div>
  )
}

/**
 * Bulk Mark as paid (§8 step 5) with the existing 5-second undo
 * (`markInvoicesPaid` / `undoMarkInvoicesPaid`). Totals never sum across
 * currencies.
 */
function BulkMarkPaid({ rows, onClear }: { rows: HubInvoice[]; onClear: () => void }) {
  const markPaid = useMutation(api.invoices.markInvoicesPaid)
  const undoMarkPaid = useMutation(api.invoices.undoMarkInvoicesPaid)
  const [pending, setPending] = useState(false)
  const totals = useMemo(() => {
    const byCurrency = new Map<string, number>()
    for (const r of rows) byCurrency.set(r.currency, (byCurrency.get(r.currency) ?? 0) + r.totalMinor)
    return [...byCurrency].map(([cur, minor]) => formatMinor(minor, cur)).join(" · ")
  }, [rows])

  async function run() {
    if (pending || rows.length === 0) return
    setPending(true)
    try {
      const res = await markPaid({ invoiceIds: rows.map((r) => r._id) })
      onClear()
      toast.success(`${res.updated} ${pluralize(res.updated, "invoice", "invoices")} marked as paid`, {
        duration: 5000,
        description: res.skipped.length > 0 ? `${res.skipped.length} skipped: ${res.skipped[0].reason}` : undefined,
        action: {
          label: "Undo",
          onClick: () => {
            void undoMarkPaid({ priorStates: res.priorStates })
              .then((u) => toast.info(`${u.reverted} ${pluralize(u.reverted, "invoice", "invoices")} marked as unpaid`))
              .catch((err) => toastError(err, "Undo failed"))
          },
        },
      })
    } catch (err) {
      toastError(err, "Failed to mark as paid")
    } finally {
      setPending(false)
    }
  }

  return (
    <AnimatePresence>
      {rows.length > 0 && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-lg">
            <span className="text-sm font-medium tabular-nums">
              {rows.length} {pluralize(rows.length, "invoice", "invoices")}
            </span>
            <Button variant="ghost" size="icon-xs" aria-label="Clear selection" onClick={onClear}>
              <XIcon />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <span className="text-sm text-muted-foreground tabular-nums">{totals}</span>
            <Button size="sm" variant="outline" onClick={() => void run()} disabled={pending}>
              {pending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckCircle2Icon data-icon="inline-start" />}
              Mark as paid
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function invoiceStatusLabel(status: InvoiceStatusFilter): string {
  return status === "all" ? "All" : INVOICE_STATUS_COPY[status].chip
}

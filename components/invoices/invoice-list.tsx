"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { useRowSelection } from "@/lib/hooks/use-row-selection"
import {
  InvoiceRowItem,
  ReadyRowItem,
} from "@/components/invoices/invoice-row"
import { useGenerateInvoice } from "@/lib/hooks/use-generate-invoice"
import { InvoiceBulkBar } from "@/components/invoices/invoice-bulk-bar"
import { ClosePeriodModal } from "@/components/projects/close-period-modal"
import { CloseCycleModal } from "@/components/projects/close-cycle-modal"
import { type ListRow, type ReadyRow } from "@/lib/invoices/list-rows"
import { buildCycleMonths, invoiceUrlSegment } from "@/lib/format"

export type InvoiceRow = {
  _id: string
  /** Undefined on unnumbered drafts — the number is allocated at finalization. */
  number?: number
  prefix: string
  subject?: string
  status: "draft" | "invoiced" | "paid" | "void"
  currency: string
  total: number
  issueDate: string
  dueDate?: string
  paidAt?: number
  clientName: string
  projectName: string
  projectBillingType: string
}

export type DateColumn = "due" | "paid"

/**
 * Unified invoice table. Rows can be in two states:
 *
 *   - `ready`   — no invoice exists yet (project work waiting to be billed)
 *   - `invoice` — an invoice row in any lifecycle status (draft → void)
 *
 * Both render with the same column grammar — Number / Issue / Due cells
 * em-dash for ready rows, encoding "not yet issued" without a separate
 * column structure. Selection is unified across both kinds; the bulk bar
 * surfaces actions per-kind (Generate for ready, Mark paid / Void for
 * invoices) and gracefully handles mixed selection by acting on each
 * kind's slice.
 */
export function InvoiceList({
  rows,
  showProject = false,
  showType = true,
  showStatus = true,
  showDate = true,
  timezone = "UTC",
  dateColumn = "due",
  fromProject,
  emptyState,
}: {
  rows: ListRow[]
  showProject?: boolean
  showType?: boolean
  showDate?: boolean
  /**
   * Hide the Status column on tabs where every row has the same status
   * (Draft, Paid, Void) — the tab nav already names that status, so the
   * column is dead weight. Keep it on Ready (within-budget / over) and
   * Outstanding (overdue accent), and on the project detail tab where
   * statuses mix.
  */
  showStatus?: boolean
  timezone?: string
  dateColumn?: DateColumn
  fromProject?: { projectId: string }
  /**
   * Rendered instead of the table when `rows` is empty. Pass an
   * `<InvoicesEmptyState>` variant so filtered views don't blank-flash.
   */
  emptyState?: React.ReactNode
}) {
  const router = useRouter()
  const { generate, pending } = useGenerateInvoice()
  // Within-budget close rows open the same review-then-confirm modals the
  // project's Monthly Breakdown card uses — one close flow everywhere.
  const [closeTarget, setCloseTarget] = useState<ReadyRow | null>(null)

  // Memoize visible keys so `useRowSelection`'s range + header-state logic
  // stays stable across unrelated re-renders.
  const visibleKeys = useMemo(() => rows.map((r) => r.key), [rows])
  const selection = useRowSelection<string>(visibleKeys)

  // Escape clears selection. Ignored when a Radix dropdown/dialog owns focus,
  // since Radix handles its own Escape first (same guard the Time tab uses).
  useEffect(() => {
    if (selection.size === 0) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      const target = e.target as HTMLElement | null
      if (target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
      selection.clear()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selection])

  if (rows.length === 0) return emptyState ?? null

  function handleInvoiceOpen(invoice: InvoiceRow) {
    const params = fromProject
      ? `?from=project&projectId=${fromProject.projectId}&tab=invoices`
      : ""
    router.push(`/invoices/${invoiceUrlSegment(invoice)}${params}`)
  }

  function handleGenerate(row: ReadyRow) {
    if (pending) return
    void generate({
      projectId: row.projectId,
      // Retainer rows carry the period; T&M rows carry the month for context
      // but the server resolves the date range from uninvoiced entries when
      // we omit it. Send retainer year/month only for retainer rows so the
      // server takes the retainer code path.
      retainerYear:
        row.kind === "retainer-monthly" || row.kind === "retainer-cycle"
          ? row.period?.year
          : undefined,
      retainerMonth:
        row.kind === "retainer-monthly" || row.kind === "retainer-cycle"
          ? row.period?.month
          : undefined,
      navigateTo: (identifier) => `/invoices/${identifier}`,
    })
  }

  // Selected slices, keyed back to source rows for the bulk bar.
  const selectedReady: ReadyRow[] = []
  const selectedInvoices: InvoiceRow[] = []
  for (const r of rows) {
    if (!selection.isSelected(r.key)) continue
    if (r.kind === "ready") selectedReady.push(r.ready)
    else selectedInvoices.push(r.invoice)
  }

  const headerChecked: boolean | "indeterminate" =
    selection.headerState === "all"
      ? true
      : selection.headerState === "some"
        ? "indeterminate"
        : false

  return (
    <>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pr-0">
              <Checkbox
                checked={headerChecked}
                onCheckedChange={() => selection.toggleAllVisible()}
                aria-label={
                  selection.headerState === "all"
                    ? "Deselect all rows"
                    : "Select all rows"
                }
              />
            </TableHead>
            <TableHead className="w-24">Number</TableHead>
            <TableHead>Subject</TableHead>
            {showProject && <TableHead className="w-40">Client</TableHead>}
            {showProject && <TableHead className="w-48">Project</TableHead>}
            {showType && <TableHead className="w-24">Type</TableHead>}
            {showStatus && <TableHead className="w-32">Status</TableHead>}
            <TableHead className="w-28 text-right">Total</TableHead>
            {showDate && (
              <TableHead className="w-32">
                {dateColumn === "paid" ? "Paid Date" : "Due Date"}
              </TableHead>
            )}
            <TableHead
              className={dateColumn === "paid" ? "w-12 pl-0" : "w-44 pl-0"}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            if (row.kind === "ready") {
              return (
                <ReadyRowItem
                  key={row.key}
                  row={row.ready}
                  showProject={showProject}
                  showType={showType}
                  showStatus={showStatus}
                  showDate={showDate}
                  selected={selection.isSelected(row.key)}
                  onSelect={(shiftKey) =>
                    selection.toggle(row.key, { shiftKey })
                  }
                  onGenerate={() => handleGenerate(row.ready)}
                  onClose={() => setCloseTarget(row.ready)}
                />
              )
            }
            return (
              <InvoiceRowItem
                key={row.key}
                invoice={row.invoice}
                showProject={showProject}
                showType={showType}
                showStatus={showStatus}
                showDate={showDate}
                timezone={timezone}
                dateColumn={dateColumn}
                selected={selection.isSelected(row.key)}
                onSelect={(_id, shiftKey) =>
                  selection.toggle(row.key, { shiftKey })
                }
                onOpen={handleInvoiceOpen}
              />
            )
          })}
        </TableBody>
      </Table>

      <InvoiceBulkBar
        selectedReady={selectedReady}
        selectedInvoices={selectedInvoices}
        onClear={selection.clear}
      />

      {closeTarget?.kind === "retainer-close" &&
        closeTarget.period &&
        closeTarget.periodStart && (
          <ClosePeriodModal
            open
            onOpenChange={(next) => {
              if (!next) setCloseTarget(null)
            }}
            projectId={closeTarget.projectId}
            year={closeTarget.period.year}
            month={closeTarget.period.month}
            periodStart={closeTarget.periodStart}
            periodLabel={monthLabel(closeTarget.period)}
          />
        )}
      {closeTarget?.kind === "retainer-cycle-close" &&
        closeTarget.period &&
        closeTarget.cycleStart && (
          <CloseCycleModal
            open
            onOpenChange={(next) => {
              if (!next) setCloseTarget(null)
            }}
            projectId={closeTarget.projectId}
            cycleStart={closeTarget.cycleStart}
            cycleEndYear={closeTarget.period.year}
            cycleEndMonth={closeTarget.period.month}
            cycleLabel={cycleRangeLabel(
              closeTarget.period,
              closeTarget.cycleLengthMonths ?? 1,
            )}
          />
        )}
    </>
  )
}

function monthLabel(p: { year: number; month: number }): string {
  return new Date(p.year, p.month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

/** "Jan-Mar 2026" style range label for a cycle ending at `closing`. */
function cycleRangeLabel(
  closing: { year: number; month: number },
  cycleLength: number,
): string {
  if (cycleLength <= 1) return monthLabel(closing)
  const months = buildCycleMonths(closing.year, closing.month, cycleLength)
  const first = months[0]
  const last = months[months.length - 1]
  if (!first || !last) return monthLabel(closing)
  const fmt = (p: { year: number; month: number }) =>
    new Date(p.year, p.month - 1, 1).toLocaleDateString("en-US", {
      month: "short",
    })
  if (first.year === last.year)
    return `${fmt(first)}-${fmt(last)} ${last.year}`
  return `${fmt(first)} ${first.year}-${fmt(last)} ${last.year}`
}

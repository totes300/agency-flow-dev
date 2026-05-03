"use client"

import { useEffect, useMemo } from "react"
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
import { type ListRow, type ReadyRow } from "@/lib/invoices/list-rows"
import { formatInvoiceNumber } from "@/lib/format"

export type InvoiceRow = {
  _id: string
  number: number
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
    router.push(`/invoices/${formatInvoiceNumber(invoice.prefix, invoice.number)}${params}`)
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
    </>
  )
}

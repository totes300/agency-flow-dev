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
import { InvoiceRowItem } from "@/components/invoices/invoice-row"
import { InvoiceBulkBar } from "@/components/invoices/invoice-bulk-bar"
import { type ListRow } from "@/lib/invoices/list-rows"
import { invoiceUrlSegment } from "@/lib/format"

export type InvoiceRow = {
  _id: string
  /** Undefined on unnumbered drafts — the number is allocated at finalization. */
  number?: number
  prefix: string
  subject?: string
  status: "draft" | "invoiced" | "paid" | "void"
  currency: string
  /** Display total (derived server-side from `totalMinor`). */
  total: number
  totalMinor: number
  /** The invoice's close (absent on fixed-fee invoices). */
  closeId?: string
  issueDate: string
  dueDate?: string
  paidAt?: number
  clientName: string
  projectName: string
  projectBillingType: string
}

export type DateColumn = "due" | "paid"

/**
 * Invoice table — one row per invoice in any lifecycle status (draft →
 * void). Work waiting to be billed lives in the Close queue, not here.
 * Selected rows feed the bulk bar (Mark paid / Void).
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
   * column is dead weight. Keep it on Outstanding (overdue accent) and on
   * the project detail tab where statuses mix.
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

  const selectedInvoices = rows
    .filter((r) => selection.isSelected(r.key))
    .map((r) => r.invoice)

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
        selectedInvoices={selectedInvoices}
        onClear={selection.clear}
      />
    </>
  )
}

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
import { CreateInvoiceModal } from "@/components/invoices/create-invoice-modal"
import { InvoiceBulkBar } from "@/components/invoices/invoice-bulk-bar"
import {
  readyRowKey,
  type ListRow,
  type ReadyRow,
} from "@/lib/invoices/list-rows"

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
  clientName: string
  projectName: string
  projectBillingType: string
}

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
  showStatus = true,
  timezone = "UTC",
  fromProject,
  emptyState,
}: {
  rows: ListRow[]
  showProject?: boolean
  /**
   * Hide the Status column on tabs where every row has the same status
   * (Draft, Paid, Void) — the tab nav already names that status, so the
   * column is dead weight. Keep it on Ready (within-budget / over) and
   * Outstanding (overdue accent), and on the project detail tab where
   * statuses mix.
   */
  showStatus?: boolean
  timezone?: string
  fromProject?: { projectId: string }
  /**
   * Rendered instead of the table when `rows` is empty. Pass an
   * `<InvoicesEmptyState>` variant so filtered views don't blank-flash.
   */
  emptyState?: React.ReactNode
}) {
  const router = useRouter()
  const [activeReady, setActiveReady] = useState<ReadyRow | null>(null)

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
    router.push(`/invoices/${invoice._id}${params}`)
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
      <Table>
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
            <TableHead className="w-28">Number</TableHead>
            <TableHead>Subject</TableHead>
            {showProject && <TableHead>Client</TableHead>}
            {showProject && <TableHead>Project</TableHead>}
            <TableHead className="w-24">Type</TableHead>
            {showStatus && <TableHead className="w-32">Status</TableHead>}
            <TableHead className="w-28 text-right">Total</TableHead>
            <TableHead className="w-28">Due Date</TableHead>
            <TableHead className="w-44 pl-0" />
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
                  showStatus={showStatus}
                  selected={selection.isSelected(row.key)}
                  onSelect={(shiftKey) =>
                    selection.toggle(row.key, { shiftKey })
                  }
                  onGenerate={() => setActiveReady(row.ready)}
                />
              )
            }
            return (
              <InvoiceRowItem
                key={row.key}
                invoice={row.invoice}
                showProject={showProject}
                showStatus={showStatus}
                timezone={timezone}
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

      {activeReady && (
        <CreateInvoiceModal
          // Remount per row so prefill resets cleanly
          key={readyRowKey(activeReady)}
          open={true}
          onOpenChange={(next) => {
            if (!next) setActiveReady(null)
          }}
          projectId={activeReady.projectId}
          projectName={activeReady.projectName}
          billingType={billingTypeForKind(activeReady.kind)}
          currency={activeReady.currency}
          initialRetainerYear={activeReady.period?.year}
          initialRetainerMonth={activeReady.period?.month}
          onCreated={(invoiceId) => router.push(`/invoices/${invoiceId}`)}
        />
      )}

      <InvoiceBulkBar
        selectedReady={selectedReady}
        selectedInvoices={selectedInvoices}
        onClear={selection.clear}
      />
    </>
  )
}

function billingTypeForKind(kind: ReadyRow["kind"]): string {
  switch (kind) {
    case "retainer-monthly":
    case "retainer-cycle":
      return "retainer"
    case "fixed":
      return "fixed"
    case "tm":
      return "t_and_m"
  }
}

"use client"

import { useEffect, useMemo } from "react"
import { useRouter } from "next/navigation"
import type { Id } from "@/convex/_generated/dataModel"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
} from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { useRowSelection } from "@/lib/hooks/use-row-selection"
import { InvoiceRow } from "@/components/invoices/invoice-row"
import { InvoiceBulkBar } from "@/components/invoices/invoice-bulk-bar"

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
 * Orchestrator: owns selection state, wires the sticky bulk bar, and renders
 * rows through `<InvoiceRow>`. Presentation of an individual row lives in
 * `invoice-row.tsx` — this file should stay thin.
 */
export function InvoiceList({
  invoices,
  showProject = false,
  timezone = "UTC",
  fromProject,
  emptyState,
}: {
  invoices: InvoiceRow[]
  showProject?: boolean
  timezone?: string
  fromProject?: { projectId: string }
  /**
   * Rendered instead of the table when `invoices` is empty. Pass an
   * `<InvoicesEmptyState>` variant so filtered views don't blank-flash.
   */
  emptyState?: React.ReactNode
}) {
  const router = useRouter()

  // Memoize visible IDs so `useRowSelection`'s range + header-state logic
  // stays stable across unrelated re-renders.
  const visibleIds = useMemo(
    () => invoices.map((i) => i._id as Id<"invoices">),
    [invoices],
  )
  const selection = useRowSelection<Id<"invoices">>(visibleIds)

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

  if (invoices.length === 0) return emptyState ?? null

  function handleRowClick(invoice: InvoiceRow) {
    const params = fromProject
      ? `?from=project&projectId=${fromProject.projectId}&tab=invoices`
      : ""
    router.push(`/invoices/${invoice._id}${params}`)
  }

  const selectedInvoices = invoices.filter((i) =>
    selection.isSelected(i._id as Id<"invoices">),
  )

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
                    ? "Deselect all invoices"
                    : "Select all invoices"
                }
              />
            </TableHead>
            <TableHead className="w-28">Number</TableHead>
            <TableHead>Subject</TableHead>
            {showProject && <TableHead>Client</TableHead>}
            {showProject && <TableHead>Project</TableHead>}
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead className="w-28 text-right">Total</TableHead>
            <TableHead className="w-28">Issue Date</TableHead>
            <TableHead className="w-28">Due Date</TableHead>
            <TableHead className="w-10 pl-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((invoice) => (
            <InvoiceRow
              key={invoice._id}
              invoice={invoice}
              showProject={showProject}
              timezone={timezone}
              selected={selection.isSelected(invoice._id as Id<"invoices">)}
              onSelect={(id, shiftKey) => selection.toggle(id, { shiftKey })}
              onOpen={handleRowClick}
            />
          ))}
        </TableBody>
      </Table>

      <InvoiceBulkBar
        selectedIds={selection.selectedIds}
        selectedInvoices={selectedInvoices}
        onClear={selection.clear}
      />
    </>
  )
}

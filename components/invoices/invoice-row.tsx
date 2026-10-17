"use client"

import { TableRow, TableCell } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import {
  formatCurrency,
  formatInvoiceDate,
  formatInvoiceIdentifier,
  invoiceUrlSegment,
} from "@/lib/format"
import { getYMDInTimezone } from "@/lib/workday"
import type { Id } from "@/convex/_generated/dataModel"
import type {
  DateColumn,
  InvoiceRow as InvoiceRowType,
} from "@/components/invoices/invoice-list"
import { cn } from "@/lib/utils"

// ─── Invoice row ───────────────────────────────────────────────────────────

export function InvoiceRowItem({
  invoice,
  showProject,
  showType,
  showStatus,
  showDate,
  timezone,
  dateColumn,
  selected,
  onSelect,
  onOpen,
}: {
  invoice: InvoiceRowType
  showProject: boolean
  showType: boolean
  showStatus: boolean
  showDate: boolean
  timezone: string
  dateColumn: DateColumn
  selected: boolean
  /**
   * `id` is forwarded for callers that need to track per-id state. The list
   * itself keys selection on a string built from the row, so most callers
   * can ignore the id.
   */
  onSelect: (id: Id<"invoices">, shiftKey: boolean) => void
  onOpen: (invoice: InvoiceRowType) => void
}) {
  const isVoid = invoice.status === "void"

  return (
    <TableRow
      className={cn(
        "group cursor-pointer",
        selected && "bg-muted/40",
        // Void rows read as historical — mute the text so live rows visually
        // dominate the scan. Badge already carries the line-through signal.
        isVoid && "text-muted-foreground",
      )}
      data-selected={selected || undefined}
      onClick={() => onOpen(invoice)}
    >
      <TableCell className="w-10 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={() => onSelect(invoice._id as Id<"invoices">, false)}
          onClick={(e) => {
            // Reach into the native event for shiftKey — Radix's
            // onCheckedChange doesn't forward the modifier.
            if (e.shiftKey) {
              e.preventDefault()
              onSelect(invoice._id as Id<"invoices">, true)
            }
          }}
          aria-label={`Select invoice ${formatInvoiceIdentifier(invoice.prefix, invoice.number)}`}
        />
      </TableCell>
      <TableCell
        className={invoice.number == null ? "text-muted-foreground" : "font-medium"}
      >
        {invoice.number == null
          ? "—"
          : formatInvoiceIdentifier(invoice.prefix, invoice.number)}
      </TableCell>
      <TableCell className="max-w-0 truncate text-muted-foreground">
        {invoice.subject ?? "—"}
      </TableCell>
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {invoice.clientName}
        </TableCell>
      )}
      {showProject && (
        <TableCell className="max-w-0 truncate text-muted-foreground">
          {invoice.projectName}
        </TableCell>
      )}
      {showType && (
        <TableCell>
          <BillingTypeBadge type={invoice.projectBillingType as BillingType} />
        </TableCell>
      )}
      {showStatus && (
        <TableCell>
          <InvoiceStatusBadge
            status={invoice.status}
            dueDate={invoice.dueDate}
            timezone={timezone}
          />
        </TableCell>
      )}
      <TableCell className="text-right font-medium tabular-nums">
        {formatCurrency(invoice.total, invoice.currency)}
      </TableCell>
      {showDate && (
        <TableCell className="text-muted-foreground">
          {dateColumn === "paid"
            ? formatPaidDate(invoice.paidAt, timezone)
            : invoice.dueDate
              ? formatInvoiceDate(invoice.dueDate)
              : "—"}
        </TableCell>
      )}
      <TableCell
        className={cn(
          invoice.status === "paid" ? "w-12" : "w-44",
          "pl-0 text-right",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <InvoiceRowActions
          invoiceId={invoice._id as Id<"invoices">}
          identifier={invoiceUrlSegment(invoice)}
          status={invoice.status}
        />
      </TableCell>
    </TableRow>
  )
}

function formatPaidDate(paidAt: number | undefined, timezone: string): string {
  if (paidAt == null) return "—"
  return formatInvoiceDate(getYMDInTimezone(new Date(paidAt), timezone))
}

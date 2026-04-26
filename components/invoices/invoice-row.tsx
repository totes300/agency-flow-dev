"use client"

import { TableRow, TableCell } from "@/components/ui/table"
import { Checkbox } from "@/components/ui/checkbox"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { InvoiceRowActions } from "@/components/invoices/invoice-row-actions"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import { formatCurrency, formatInvoiceDate, formatInvoiceNumber } from "@/lib/format"
import type { Id } from "@/convex/_generated/dataModel"
import type { InvoiceRow as InvoiceRowType } from "@/components/invoices/invoice-list"
import { cn } from "@/lib/utils"

export function InvoiceRow({
  invoice,
  showProject,
  timezone,
  selected,
  onSelect,
  onOpen,
}: {
  invoice: InvoiceRowType
  showProject: boolean
  timezone: string
  selected: boolean
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
          aria-label={`Select invoice ${formatInvoiceNumber(invoice.prefix, invoice.number)}`}
        />
      </TableCell>
      <TableCell className="font-medium">
        {formatInvoiceNumber(invoice.prefix, invoice.number)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {invoice.subject ?? "—"}
      </TableCell>
      {showProject && (
        <TableCell className="text-muted-foreground">
          {invoice.clientName}
        </TableCell>
      )}
      {showProject && (
        <TableCell className="text-muted-foreground">
          {invoice.projectName}
        </TableCell>
      )}
      <TableCell>
        <BillingTypeBadge type={invoice.projectBillingType as BillingType} />
      </TableCell>
      <TableCell>
        <InvoiceStatusBadge
          status={invoice.status}
          dueDate={invoice.dueDate}
          timezone={timezone}
        />
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {formatCurrency(invoice.total, invoice.currency)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatInvoiceDate(invoice.issueDate)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}
      </TableCell>
      <TableCell className="w-10 pl-0 text-right">
        <div
          className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected=true]:opacity-100"
        >
          <InvoiceRowActions
            invoiceId={invoice._id as Id<"invoices">}
            status={invoice.status}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

"use client"

import { useRouter } from "next/navigation"
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { BillingTypeBadge, type BillingType } from "@/components/billing-type-badge"
import { formatCurrency, formatInvoiceDate, formatInvoiceNumber } from "@/lib/format"

export type InvoiceRow = {
  _id: string
  number: number
  prefix: string
  subject?: string
  status: "draft" | "invoiced" | "paid"
  currency: string
  total: number
  issueDate: string
  dueDate?: string
  clientName: string
  projectName: string
  projectBillingType: string
}

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

  if (invoices.length === 0) return emptyState ?? null

  function handleRowClick(invoice: InvoiceRow) {
    const params = fromProject
      ? `?from=project&projectId=${fromProject.projectId}&tab=invoices`
      : ""
    router.push(`/invoices/${invoice._id}${params}`)
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Number</TableHead>
          <TableHead>Subject</TableHead>
          {showProject && <TableHead>Client</TableHead>}
          {showProject && <TableHead>Project</TableHead>}
          <TableHead className="w-24">Type</TableHead>
          <TableHead className="w-24">Status</TableHead>
          <TableHead className="w-28 text-right">Total</TableHead>
          <TableHead className="w-28">Issue Date</TableHead>
          <TableHead className="w-28">Due Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((invoice) => (
          <TableRow
            key={invoice._id}
            className="cursor-pointer"
            onClick={() => handleRowClick(invoice)}
          >
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
            <TableCell className="text-right font-medium">
              {formatCurrency(invoice.total, invoice.currency)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatInvoiceDate(invoice.issueDate)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

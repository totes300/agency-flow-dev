// Row type for the invoices table. Rows are keyed by a string (`key`) so
// selection is a single `Set<string>`.

import type { InvoiceRow } from "@/components/invoices/invoice-list"

export type ListRow = { kind: "invoice"; key: string; invoice: InvoiceRow }

export function invoiceRowKey(i: InvoiceRow): string {
  return `invoice:${i._id}`
}

export function toInvoiceListRow(i: InvoiceRow): ListRow {
  return { kind: "invoice", key: invoiceRowKey(i), invoice: i }
}

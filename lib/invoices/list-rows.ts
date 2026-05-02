// Unified row type for the invoices table. The list shows a mix of rows
// across the invoice lifecycle — from "ready to be generated" (no invoice
// row exists yet) through draft / outstanding / paid / void (actual
// invoices). Both render in the same table so the user reads them as one
// continuous data plane.
//
// Selection is keyed by a string built here (`key`) so a single
// `Set<string>` covers both kinds without collision.

import type { FunctionReturnType } from "convex/server"
import type { api } from "@/convex/_generated/api"
import type { InvoiceRow } from "@/components/invoices/invoice-list"

export type ReadyRow =
  FunctionReturnType<typeof api.invoices.getReadyToInvoiceUnified>[number]

export type ListRow =
  | { kind: "ready"; key: string; ready: ReadyRow }
  | { kind: "invoice"; key: string; invoice: InvoiceRow }

export function readyRowKey(r: ReadyRow): string {
  if (r.period) {
    return `ready:${r.kind}:${r.projectId}:${r.period.year}-${r.period.month}`
  }
  return `ready:${r.kind}:${r.projectId}`
}

export function invoiceRowKey(i: InvoiceRow): string {
  return `invoice:${i._id}`
}

export function toReadyListRow(r: ReadyRow): ListRow {
  return { kind: "ready", key: readyRowKey(r), ready: r }
}

export function toInvoiceListRow(i: InvoiceRow): ListRow {
  return { kind: "invoice", key: invoiceRowKey(i), invoice: i }
}

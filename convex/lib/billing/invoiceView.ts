/**
 * Read-boundary view of invoices and lines (docs/prd-billing-refactor.md N6).
 *
 * Storage holds money only as integer minor units. Queries hand documents to
 * the UI through these helpers, which add the decimal display amounts
 * (`subtotal`, `total`, `unitPrice`, `amount`) derived from them — a pure
 * conversion, never fed back into a calculation. Pure: safe in client code.
 */

import type { Doc } from "../../_generated/dataModel";
import { fromMinor } from "./money";

export type InvoiceView = Doc<"invoices"> & { subtotal: number; total: number };
export type InvoiceLineView = Doc<"invoiceLineItems"> & { unitPrice: number; amount: number };

export function toInvoiceView(invoice: Doc<"invoices">): InvoiceView {
  return {
    ...invoice,
    subtotal: fromMinor(invoice.subtotalMinor, invoice.currency),
    total: fromMinor(invoice.totalMinor, invoice.currency),
  };
}

export function toLineView(line: Doc<"invoiceLineItems">, currency: string): InvoiceLineView {
  return {
    ...line,
    unitPrice: fromMinor(line.unitPriceMinor, currency),
    amount: fromMinor(line.amountMinor, currency),
  };
}

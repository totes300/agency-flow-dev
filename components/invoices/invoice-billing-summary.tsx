"use client"

import type { Id } from "@/convex/_generated/dataModel"
import type { InvoiceLineView } from "@/convex/lib/billing/invoiceView"
import { InlineEditable, InlineEditableNumber } from "@/components/inline-editable"
import { formatCurrency, getCurrencySymbol } from "@/lib/format"
import { useInvoiceLineActions } from "@/lib/hooks/use-invoice-line-actions"
import { PlusIcon, Trash2Icon } from "lucide-react"

/**
 * Billing summary card for fixed fee / retainer charge rows.
 *
 * Layout decisions worth knowing:
 * - `table-fixed` + `<colgroup>` widths so columns don't reflow when a row
 *   enters edit mode (the previous content-driven layout caused visible
 *   column jumps as the user clicked between cells).
 * - Editable rows route through the `<InlineEditableNumber>` chip, which
 *   renders the currency symbol *inside* the chip so "$" and the number
 *   read as a single tight unit.
 */
export function InvoiceBillingSummary({
  invoiceId,
  billingItems,
  readOnly,
  currency,
}: {
  invoiceId: Id<"invoices">
  billingItems: InvoiceLineView[]
  readOnly: boolean
  currency: string
}) {
  const actions = useInvoiceLineActions(invoiceId)

  const total = billingItems.reduce((sum, item) => sum + item.amount, 0)
  const symbol = getCurrencySymbol(currency)

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold">Billing Summary</h2>
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col />
          <col className="w-24" />
          <col className="w-32" />
          <col className="w-36" />
          {!readOnly && <col className="w-10" />}
        </colgroup>
        <thead className="border-b text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 text-left font-semibold">Description</th>
            <th className="px-3 py-2 text-right font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Rate</th>
            <th className="py-2 pl-3 text-right font-semibold">Amount</th>
            {!readOnly && <th aria-label="Actions" />}
          </tr>
        </thead>
        <tbody>
          {billingItems.map((li) => {
            const isManual = li.lineType === "manual"
            const editable = !readOnly && isManual
            // The fixed line's amount IS editable server-side (partial
            // billing), but its edit surface is the sidebar's Fixed fee
            // control — the document canvas stays chrome-free.

            return (
              <tr key={li._id} className="group border-b">
                <td className="py-3 pr-3">
                  <InlineEditable
                    value={li.description}
                    onSave={(val) => actions.rename(li._id, val)}
                    readOnly={readOnly}
                    ariaLabel="Edit description"
                    errorMessage="Failed to update line item"
                  />
                </td>

                <td className="px-3 py-3 text-right tabular-nums">
                  {editable ? (
                    <InlineEditableNumber
                      value={li.quantity}
                      onSave={(val) => actions.updateManual(li._id, "quantity", val)}
                      ariaLabel="Edit quantity"
                      errorMessage="Failed to update line item"
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {renderQty(li)}
                    </span>
                  )}
                </td>

                <td className="px-3 py-3 text-right tabular-nums">
                  {editable ? (
                    <InlineEditableNumber
                      value={li.unitPrice}
                      onSave={(val) => actions.updateManual(li._id, "unitPrice", val)}
                      ariaLabel="Edit rate"
                      errorMessage="Failed to update line item"
                      prefix={symbol}
                    />
                  ) : (
                    <span className="text-muted-foreground">
                      {renderRate(li, currency)}
                    </span>
                  )}
                </td>

                <td className="py-3 pl-3 text-right font-medium tabular-nums">
                  {/* Always derived: quantity × unit price (manual), frozen at commit (others). */}
                  {formatCurrency(li.amount, currency)}
                </td>

                {!readOnly && (
                  <td className="py-3 pl-2 text-right">
                    {isManual && (
                      <button
                        type="button"
                        aria-label="Remove line item"
                        onClick={() => actions.removeManual(li._id)}
                        className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,color,background-color] hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}

          {!readOnly && (
            <tr>
              <td colSpan={5} className="py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground hover:text-foreground"
                  onClick={actions.addManual}
                >
                  <PlusIcon className="size-3.5" />
                  Add line item
                </button>
              </td>
            </tr>
          )}

          <tr className="border-t">
            <td className="py-4 pr-3 text-sm font-semibold" colSpan={3}>
              Total
            </td>
            <td className="py-4 pl-3 text-right text-base font-bold tabular-nums">
              {formatCurrency(total, currency)}
            </td>
            {!readOnly && <td />}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function renderQty(item: InvoiceLineView): string {
  if (item.lineType === "overage") return `${formatQuantity(item.quantity)}h`
  return "—"
}

function renderRate(item: InvoiceLineView, currency: string): string {
  if (item.lineType === "overage") return `${formatCurrency(item.unitPrice, currency)}/h`
  if (item.lineType === "fixed") return "Fixed"
  return "—"
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

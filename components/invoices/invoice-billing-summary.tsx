"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { InlineEditable, InlineEditableNumber } from "@/components/inline-editable"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency, getCurrencySymbol } from "@/lib/format"
import { PlusIcon, Trash2Icon } from "lucide-react"

type BillingField = "description" | "quantity" | "unitPrice" | "amount"

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
  billingItems: Doc<"invoiceLineItems">[]
  readOnly: boolean
  currency: string
}) {
  const updateLineItem = useMutation(api.invoices.updateInvoiceLineItem)
  const addLineItem = useMutation(api.invoices.addInvoiceLineItem)
  const removeLineItem = useMutation(api.invoices.removeInvoiceLineItem)

  function handleUpdate(
    lineItemId: Id<"invoiceLineItems">,
    field: BillingField,
    value: string | number,
  ) {
    void updateLineItem({ id: lineItemId, [field]: value }).catch((err) =>
      toastError(err, "Failed to update line item")
    )
  }

  function handleAddLine() {
    void addLineItem({ invoiceId }).catch((err) =>
      toastError(err, "Failed to add line item")
    )
  }

  function handleRemoveLine(lineItemId: Id<"invoiceLineItems">) {
    void removeLineItem({ id: lineItemId }).catch((err) =>
      toastError(err, "Failed to remove line item")
    )
  }

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
                    onSave={(val) => handleUpdate(li._id, "description", val)}
                    readOnly={readOnly}
                    ariaLabel="Edit description"
                    errorMessage="Failed to update line item"
                  />
                </td>

                <td className="px-3 py-3 text-right tabular-nums">
                  {editable ? (
                    <InlineEditableNumber
                      value={li.quantity}
                      onSave={(val) => handleUpdate(li._id, "quantity", val)}
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
                      onSave={(val) => handleUpdate(li._id, "unitPrice", val)}
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
                  {editable ? (
                    <InlineEditableNumber
                      value={li.amount}
                      onSave={(val) => handleUpdate(li._id, "amount", val)}
                      ariaLabel="Edit amount"
                      errorMessage="Failed to update line item"
                      prefix={symbol}
                    />
                  ) : (
                    formatCurrency(li.amount, currency)
                  )}
                </td>

                {!readOnly && (
                  <td className="py-3 pl-2 text-right">
                    {isManual && (
                      <button
                        type="button"
                        aria-label="Remove line item"
                        onClick={() => handleRemoveLine(li._id)}
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
                  onClick={handleAddLine}
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

function renderQty(item: Doc<"invoiceLineItems">): string {
  if (item.lineType === "overage") return `${formatQuantity(item.quantity)}h`
  return "—"
}

function renderRate(item: Doc<"invoiceLineItems">, currency: string): string {
  if (item.lineType === "overage") return `${formatCurrency(item.unitPrice, currency)}/h`
  if (item.lineType === "fixed") return "Fixed"
  return "—"
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value)
}

"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { InlineEditable, InlineEditableNumber } from "@/components/inline-editable"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency } from "@/lib/format"
import { PlusIcon, XIcon } from "lucide-react"

export type BalanceData = {
  startBalanceMinutes: number
  includedMinutes: number
  usedMinutes: number
  endBalanceMinutes: number
}

function formatMinutesAsHours(minutes: number): string {
  const hours = minutes / 60
  const sign = hours < 0 ? "−" : ""
  return `${sign}${Math.abs(hours).toFixed(1)}h`
}

/**
 * Billing summary card for Fixed Fee and Retainer invoices.
 * Renders optional balance section (retainer) + billing line items + total.
 */
export function InvoiceBillingSummary({
  invoiceId,
  billingItems,
  readOnly,
  currency,
  balanceData,
}: {
  invoiceId: Id<"invoices">
  billingItems: Doc<"invoiceLineItems">[]
  readOnly: boolean
  currency: string
  balanceData?: BalanceData
}) {
  const updateLineItem = useMutation(api.invoices.updateInvoiceLineItem)
  const addLineItem = useMutation(api.invoices.addInvoiceLineItem)
  const removeLineItem = useMutation(api.invoices.removeInvoiceLineItem)

  function handleUpdate(
    lineItemId: Id<"invoiceLineItems">,
    field: "description" | "amount",
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

  return (
    <div className="rounded-lg border bg-muted/30 p-6">
      <div className="flex flex-col gap-3">
        {/* Balance section (retainer only) */}
        {balanceData && (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Budget</p>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Starting balance</span>
                <span className="text-sm tabular-nums">{formatMinutesAsHours(balanceData.startBalanceMinutes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Included</span>
                <span className="text-sm tabular-nums">{formatMinutesAsHours(balanceData.includedMinutes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Used</span>
                <span className="text-sm tabular-nums">{formatMinutesAsHours(balanceData.usedMinutes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Ending balance</span>
                <span className={`text-sm font-medium tabular-nums ${balanceData.endBalanceMinutes < 0 ? "text-destructive" : ""}`}>
                  {formatMinutesAsHours(balanceData.endBalanceMinutes)}
                </span>
              </div>
            </div>
            <hr className="border-border" />
          </>
        )}

        {/* Billing line items — `fixed`, `retainer_fee`, `overage` rows are
            anchored to project snapshots, so their amounts are read-only. Use
            a manual adjustment line for discounts or one-off charges. */}
        {billingItems.map((li) => {
          const isAmountEditable = !readOnly && li.lineType === "manual"
          return (
            <div key={li._id} className="group flex items-center justify-between">
              <span className="flex-1 text-sm">
                <InlineEditable
                  value={li.description}
                  onSave={(val) => handleUpdate(li._id, "description", val)}
                  readOnly={readOnly}
                  ariaLabel="Edit description"
                  errorMessage="Failed to update line item"
                />
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {isAmountEditable ? (
                    <InlineEditableNumber
                      value={li.amount}
                      onSave={(val) => handleUpdate(li._id, "amount", val)}
                      ariaLabel="Edit amount"
                      errorMessage="Failed to update line item"
                    />
                  ) : (
                    formatCurrency(li.amount, currency)
                  )}
                </span>
                {!readOnly && li.lineType === "manual" && (
                  <button
                    type="button"
                    aria-label="Remove line item"
                    onClick={() => handleRemoveLine(li._id)}
                    className="invisible size-5 rounded text-muted-foreground/50 hover:text-destructive group-hover:visible"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Add line item */}
        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit text-muted-foreground"
            onClick={handleAddLine}
          >
            <PlusIcon className="mr-1.5 size-3.5" />
            Add line item
          </Button>
        )}

        {/* Total */}
        <hr className="border-border" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-base font-bold tabular-nums">
            {formatCurrency(total, currency)}
          </span>
        </div>
      </div>
    </div>
  )
}

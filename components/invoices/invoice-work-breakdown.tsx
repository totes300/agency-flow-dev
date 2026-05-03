"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { InlineEditable, InlineEditableNumber } from "@/components/inline-editable"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency, getCurrencySymbol } from "@/lib/format"
import { PlusIcon, Trash2Icon } from "lucide-react"

export type CategoryGroup = {
  categoryId: string | null
  categoryName: string
  categoryColor: string
  lineItems: Doc<"invoiceLineItems">[]
  subtotalHours: number
}

type LineField = "description" | "quantity" | "unitPrice" | "amount"

function LineItemRow({
  lineItem,
  showAmounts,
  readOnly,
  indented = false,
  currencySymbol,
  onUpdate,
  onRemove,
}: {
  lineItem: Doc<"invoiceLineItems">
  showAmounts: boolean
  readOnly: boolean
  /** Time-backed rows live inside a category group and are left-padded. */
  indented?: boolean
  currencySymbol: string
  onUpdate: (id: Id<"invoiceLineItems">, field: LineField, value: string | number) => void
  onRemove: (id: Id<"invoiceLineItems">) => void
}) {
  const { _id: id, description, quantity, unitPrice, amount } = lineItem

  return (
    <div
      className={`group flex items-center border-b border-border/70 py-2.5 ${
        indented ? "pl-3" : ""
      }`}
    >
      <span className="flex-1 text-sm leading-snug">
        <InlineEditable
          value={description}
          onSave={(val) => onUpdate(id, "description", val)}
          readOnly={readOnly}
          ariaLabel="Edit description"
          errorMessage="Failed to update line item"
        />
      </span>
      <span className="flex w-20 justify-end text-sm tabular-nums">
        <InlineEditableNumber
          value={quantity}
          onSave={(val) => onUpdate(id, "quantity", val)}
          readOnly={readOnly}
          suffix="h"
          ariaLabel="Edit hours"
          errorMessage="Failed to update line item"
        />
      </span>
      {showAmounts && (
        <>
          <span className="flex w-24 justify-end text-sm tabular-nums">
            <InlineEditableNumber
              value={unitPrice}
              onSave={(val) => onUpdate(id, "unitPrice", val)}
              readOnly={readOnly}
              prefix={currencySymbol}
              ariaLabel="Edit rate"
              errorMessage="Failed to update line item"
            />
          </span>
          <span className="flex w-28 justify-end text-sm font-medium tabular-nums">
            <InlineEditableNumber
              value={amount}
              onSave={(val) => onUpdate(id, "amount", val)}
              readOnly={readOnly}
              prefix={currencySymbol}
              ariaLabel="Edit amount"
              errorMessage="Failed to update line item"
            />
          </span>
        </>
      )}
      {!readOnly && (
        <span className="flex w-8 justify-end">
          <button
            type="button"
            aria-label="Remove line item"
            onClick={() => onRemove(id)}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,color,background-color] hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2Icon className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

/**
 * Dumb renderer. Parent (`InvoiceDocument`) owns all line item bucketing
 * (decision 2026-05-03 Q7); this component just paints what it receives.
 */
export function InvoiceWorkBreakdown({
  invoiceId,
  timeCategoryGroups,
  manualItems,
  showAmounts,
  readOnly,
  currency,
  subtotal,
  total,
}: {
  invoiceId: Id<"invoices">
  /** Pre-bucketed: only `lineType: "time"` rows, grouped by category. */
  timeCategoryGroups: CategoryGroup[]
  /** Pre-bucketed: only `lineType: "manual"` rows (T&M only — fixed/retainer
   * invoices route manual rows to the Billing Summary card instead). */
  manualItems: Doc<"invoiceLineItems">[]
  showAmounts: boolean
  readOnly: boolean
  currency: string
  subtotal: number
  total: number
}) {
  const updateLineItem = useMutation(api.invoices.updateInvoiceLineItem)
  const addLineItem = useMutation(api.invoices.addInvoiceLineItem)
  const removeLineItem = useMutation(api.invoices.removeInvoiceLineItem)
  const symbol = getCurrencySymbol(currency)

  function handleUpdateField(
    lineItemId: Id<"invoiceLineItems">,
    field: "description" | "quantity" | "unitPrice" | "amount",
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

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold">Work Breakdown</h2>
        <p className="text-xs text-muted-foreground">Grouped by category</p>
      </div>

      {/* Header */}
      <div className="flex items-center border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">{showAmounts ? "Description" : "Category / Task"}</span>
        <span className="w-20 text-right">Hours</span>
        {showAmounts && (
          <>
            <span className="w-24 text-right">Rate</span>
            <span className="w-28 text-right">Amount</span>
          </>
        )}
        {!readOnly && <span className="w-8" />}
      </div>

      {/* Category groups (time-backed rows) */}
      {timeCategoryGroups.map((group) => (
        <div key={group.categoryId ?? "uncategorized"} className="flex flex-col">
          <div className="mt-3 flex items-center bg-muted px-3 py-2">
            <div className="flex flex-1 items-center gap-2.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-xs font-semibold uppercase tracking-[0.08em]">
                  {group.categoryName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {group.lineItems.length} {group.lineItems.length === 1 ? "task" : "tasks"}
                </span>
              </div>
            </div>
            <span className="w-20 text-right text-sm font-medium tabular-nums">
              {group.subtotalHours}h
            </span>
            {showAmounts && (
              <>
                <span className="w-24" />
                <span className="w-28" />
              </>
            )}
            {!readOnly && <span className="w-8" />}
          </div>

          {/* Line item rows */}
          {group.lineItems.map((li) => (
            <LineItemRow
              key={li._id}
              lineItem={li}
              showAmounts={showAmounts}
              readOnly={readOnly}
              indented
              currencySymbol={symbol}
              onUpdate={handleUpdateField}
              onRemove={handleRemoveLine}
            />
          ))}
        </div>
      ))}

      {/* Manual line items — always rendered at the bottom */}
      {manualItems.length > 0 && (
        <div className="flex flex-col">
          <div className="mt-3 flex items-center bg-muted px-3 py-2">
            <div className="flex flex-1 items-center gap-2.5">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-xs font-semibold uppercase tracking-[0.08em]">
                  Additional items
                </span>
                <span className="text-xs text-muted-foreground">
                  {manualItems.length} {manualItems.length === 1 ? "line" : "lines"}
                </span>
              </div>
            </div>
            <span className="w-20" />
            {showAmounts && (
              <>
                <span className="w-24" />
                <span className="w-28" />
              </>
            )}
            {!readOnly && <span className="w-8" />}
          </div>
          {manualItems.map((li) => (
            <LineItemRow
              key={li._id}
              lineItem={li}
              showAmounts={showAmounts}
              readOnly={readOnly}
              currencySymbol={symbol}
              onUpdate={handleUpdateField}
              onRemove={handleRemoveLine}
            />
          ))}
        </div>
      )}

      {/* Add line item */}
      {!readOnly && showAmounts && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 w-fit text-muted-foreground"
          onClick={handleAddLine}
        >
          <PlusIcon className="mr-1.5 size-3.5" />
          Add line item
        </Button>
      )}

      {/* Totals */}
      {showAmounts && (
        <>
          <hr className="border-border" />
          <div className="flex items-center py-1">
            <span className="flex-1 text-right text-sm font-medium">Subtotal</span>
            <span className="w-20" />
            <span className="w-24" />
            <span className="w-28 text-right text-sm font-semibold tabular-nums">
              {formatCurrency(subtotal, currency)}
            </span>
            {!readOnly && <span className="w-8" />}
          </div>
          <div className="flex items-center py-1">
            <span className="flex-1 text-right text-sm font-semibold">Total</span>
            <span className="w-20" />
            <span className="w-24" />
            <span className="w-28 text-right text-base font-bold tabular-nums">
              {formatCurrency(total, currency)}
            </span>
            {!readOnly && <span className="w-8" />}
          </div>
        </>
      )}
    </div>
  )
}

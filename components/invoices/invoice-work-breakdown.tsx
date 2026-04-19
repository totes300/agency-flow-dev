"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { CategoryBadge } from "@/components/category-badge"
import { InlineEditable, InlineEditableNumber } from "@/components/inline-editable"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency } from "@/lib/format"
import { PlusIcon, XIcon } from "lucide-react"

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
  onUpdate,
  onRemove,
}: {
  lineItem: Doc<"invoiceLineItems">
  showAmounts: boolean
  readOnly: boolean
  /** Time-backed rows live inside a category group and are left-padded. */
  indented?: boolean
  onUpdate: (id: Id<"invoiceLineItems">, field: LineField, value: string | number) => void
  onRemove: (id: Id<"invoiceLineItems">) => void
}) {
  const { _id: id, description, quantity, unitPrice, amount } = lineItem

  return (
    <div className={`group flex items-center py-1 ${indented ? "pl-4" : ""}`}>
      <span className="flex-1 text-sm">
        <InlineEditable
          value={description}
          onSave={(val) => onUpdate(id, "description", val)}
          readOnly={readOnly}
          ariaLabel="Edit description"
          errorMessage="Failed to update line item"
        />
      </span>
      <span className="w-20 text-right text-sm">
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
          <span className="w-24 text-right text-sm">
            <InlineEditableNumber
              value={unitPrice}
              onSave={(val) => onUpdate(id, "unitPrice", val)}
              readOnly={readOnly}
              ariaLabel="Edit rate"
              errorMessage="Failed to update line item"
            />
          </span>
          <span className="w-28 text-right text-sm font-medium">
            <InlineEditableNumber
              value={amount}
              onSave={(val) => onUpdate(id, "amount", val)}
              readOnly={readOnly}
              ariaLabel="Edit amount"
              errorMessage="Failed to update line item"
            />
          </span>
        </>
      )}
      {!readOnly && (
        <span className="w-8 text-right">
          <button
            type="button"
            aria-label="Remove line item"
            onClick={() => onRemove(id)}
            className="invisible size-5 rounded text-muted-foreground/50 hover:text-destructive group-hover:visible"
          >
            <XIcon className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function InvoiceWorkBreakdown({
  invoiceId,
  categoryGroups,
  showAmounts,
  readOnly,
  currency,
  subtotal,
  total,
}: {
  invoiceId: Id<"invoices">
  categoryGroups: CategoryGroup[]
  showAmounts: boolean
  readOnly: boolean
  currency: string
  subtotal: number
  total: number
}) {
  const updateLineItem = useMutation(api.invoices.updateInvoiceLineItem)
  const addLineItem = useMutation(api.invoices.addInvoiceLineItem)
  const removeLineItem = useMutation(api.invoices.removeInvoiceLineItem)

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

  // Separate time-backed category groups from manual line items
  const timeCategoryGroups = categoryGroups.filter(
    (g) => g.lineItems.some((li) => li.lineType !== "manual"),
  ).map((g) => ({
    ...g,
    lineItems: g.lineItems.filter((li) => li.lineType !== "manual"),
  }))

  const manualItems = categoryGroups.flatMap(
    (g) => g.lineItems.filter((li) => li.lineType === "manual"),
  )

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">Description</span>
        <span className="w-20 text-right">Hours</span>
        {showAmounts && (
          <>
            <span className="w-24 text-right">Rate</span>
            <span className="w-28 text-right">Amount</span>
          </>
        )}
        {!readOnly && <span className="w-8" />}
      </div>

      <hr className="border-border" />

      {/* Category groups (time-backed rows) */}
      {timeCategoryGroups.map((group) => (
        <div key={group.categoryId ?? "uncategorized"} className="flex flex-col gap-1">
          {/* Category header */}
          <div className="flex items-center py-1.5">
            <div className="flex flex-1 items-center gap-2">
              <CategoryBadge name={group.categoryName} color={group.categoryColor} />
            </div>
            <span className="w-20 text-right text-sm tabular-nums text-muted-foreground">
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
              onUpdate={handleUpdateField}
              onRemove={handleRemoveLine}
            />
          ))}
        </div>
      ))}

      {/* Manual line items — always rendered at the bottom */}
      {manualItems.length > 0 && (
        <div className="flex flex-col gap-1">
          {manualItems.map((li) => (
            <LineItemRow
              key={li._id}
              lineItem={li}
              showAmounts={showAmounts}
              readOnly={readOnly}
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

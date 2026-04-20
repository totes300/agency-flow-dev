"use client"

import { useMemo } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { DatePicker } from "@/components/ui/date-picker"
import { InlineEditable } from "@/components/inline-editable"
import { InvoiceParties } from "@/components/invoices/invoice-parties"
import { InvoiceWorkBreakdown, type CategoryGroup } from "@/components/invoices/invoice-work-breakdown"
import { InvoiceBillingSummary, type BalanceData } from "@/components/invoices/invoice-billing-summary"
import { toastError } from "@/lib/toast-helpers"
import {
  formatDateToYMDOrUndefined,
  formatInvoiceDate,
  formatInvoiceNumber,
  parseYMDToLocalDate,
} from "@/lib/format"
import { LockIcon, XIcon } from "lucide-react"

/** Line types that belong in the billing summary card, not the work breakdown */
const BILLING_LINE_TYPES = new Set(["fixed", "retainer_fee", "overage", "manual"])

export function InvoiceDocument({
  invoice,
  categoryGroups,
  lineItems,
  project,
  client,
  brand,
  readOnly,
}: {
  invoice: Doc<"invoices">
  categoryGroups: CategoryGroup[]
  lineItems: Doc<"invoiceLineItems">[]
  project: { name: string; billingType: string; fixedPrice?: number } | null
  client: { name: string; billingName?: string; billingEmail?: string; billingStreet?: string; billingStreet2?: string; billingCity?: string; billingZip?: string; billingCountry?: string; taxId?: string } | null
  brand: { brandName?: string; brandAddress?: string; brandTaxId?: string; brandEmail?: string; brandPhone?: string } | null
  readOnly: boolean
}) {
  const updateInvoice = useMutation(api.invoices.updateInvoice)

  async function handleDateChange(field: "issueDate" | "dueDate", date: Date | undefined) {
    const dateStr = formatDateToYMDOrUndefined(date)
    // issueDate is required; ignore undefined. dueDate is optional — pass null to clear.
    if (!dateStr && field === "issueDate") return
    const value = dateStr ?? (field === "dueDate" ? null : undefined)
    void updateInvoice({ id: invoice._id, [field]: value }).catch((err) =>
      toastError(err, `Failed to update ${field === "issueDate" ? "issue date" : "due date"}`)
    )
  }

  const billingType = project?.billingType ?? "t_and_m"
  const showAmounts = billingType === "t_and_m"
  const hasBillingSummary = billingType === "fixed" || billingType === "retainer"

  // For Fixed/Retainer: separate time rows from billing rows
  // Work breakdown shows only lineType:"time" rows
  // Billing summary shows lineType:"fixed", "retainer_fee", "overage", "manual"
  const workBreakdownGroups = useMemo(() => {
    if (!hasBillingSummary) return categoryGroups

    // Filter category groups to only include time line items
    return categoryGroups
      .map((group) => {
        const timeItems = group.lineItems.filter((li) => !BILLING_LINE_TYPES.has(li.lineType))
        const subtotalHours = timeItems.reduce((sum, li) => sum + li.quantity, 0)
        return { ...group, lineItems: timeItems, subtotalHours: Math.round(subtotalHours * 100) / 100 }
      })
      .filter((group) => group.lineItems.length > 0)
  }, [categoryGroups, hasBillingSummary])

  const billingItems = useMemo(() => {
    if (!hasBillingSummary) return []
    return lineItems.filter((li) => BILLING_LINE_TYPES.has(li.lineType))
  }, [lineItems, hasBillingSummary])

  return (
    <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
      {/* Locked banner */}
      {readOnly && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-4 py-3 text-sm text-muted-foreground">
          <LockIcon className="size-4 shrink-0" />
          This invoice is locked. Revert to draft to make changes.
        </div>
      )}

      {/* Subject */}
      <InlineEditable
        value={invoice.subject ?? ""}
        onSave={async (next) => {
          await updateInvoice({ id: invoice._id, subject: next })
        }}
        ariaLabel="Edit invoice subject"
        placeholder="Untitled Invoice"
        errorMessage="Failed to update subject"
        readOnly={readOnly}
        className="text-xl font-semibold"
      />

      {/* FROM / TO */}
      <InvoiceParties brand={brand} client={client} />

      {/* Invoice meta */}
      <div className="flex gap-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Invoice</p>
          <p className="mt-1 text-sm font-medium">{formatInvoiceNumber(invoice.prefix, invoice.number)}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Issue Date</p>
          {readOnly ? (
            <p className="mt-1 text-sm">{formatInvoiceDate(invoice.issueDate)}</p>
          ) : (
            <div className="mt-1">
              <DatePicker
                value={parseYMDToLocalDate(invoice.issueDate)}
                onChange={(d) => handleDateChange("issueDate", d)}
                className="h-8 text-sm"
              />
            </div>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Due Date</p>
          {readOnly ? (
            <p className="mt-1 text-sm">{invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}</p>
          ) : (
            <div className="mt-1 flex items-center gap-1">
              <DatePicker
                value={parseYMDToLocalDate(invoice.dueDate)}
                onChange={(d) => handleDateChange("dueDate", d)}
                className="h-8 text-sm"
              />
              {invoice.dueDate && (
                <button
                  type="button"
                  onClick={() => handleDateChange("dueDate", undefined)}
                  aria-label="Clear due date"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Separator */}
      <hr className="border-border" />

      {/* Work breakdown */}
      <InvoiceWorkBreakdown
        invoiceId={invoice._id}
        categoryGroups={workBreakdownGroups}
        showAmounts={showAmounts}
        readOnly={readOnly}
        currency={invoice.currency}
        subtotal={invoice.subtotal}
        total={invoice.total}
      />

      {/* Billing summary card (Fixed / Retainer) */}
      {hasBillingSummary && billingItems.length > 0 && (
        <InvoiceBillingSummary
          invoiceId={invoice._id}
          billingItems={billingItems}
          readOnly={readOnly}
          currency={invoice.currency}
          balanceData={
            billingType === "retainer" && invoice.retainerStartBalanceMinutes != null
              ? {
                  startBalanceMinutes: invoice.retainerStartBalanceMinutes,
                  includedMinutes: invoice.retainerIncludedMinutes ?? 0,
                  usedMinutes: invoice.retainerUsedMinutes ?? 0,
                  endBalanceMinutes: invoice.retainerEndBalanceMinutes ?? 0,
                } satisfies BalanceData
              : undefined
          }
        />
      )}
    </div>
  )
}

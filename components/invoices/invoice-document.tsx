"use client"

import { useMemo } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { DatePicker } from "@/components/ui/date-picker"
import { InlineEditable } from "@/components/inline-editable"
import { DocumentParties } from "@/components/document/parties"
import { RetainerUsageTable } from "@/components/document/retainer-usage-table"
import { InvoiceMessageBlock } from "@/components/invoices/invoice-message-block"
import { PaymentInstructionsBlock } from "@/components/invoices/payment-instructions-block"
import { InvoiceWorkBreakdown, type CategoryGroup } from "@/components/invoices/invoice-work-breakdown"
import { InvoiceBillingSummary } from "@/components/invoices/invoice-billing-summary"
import { toastError } from "@/lib/toast-helpers"
import {
  formatCurrency,
  formatDateToYMDOrUndefined,
  formatInvoiceDate,
  formatInvoiceIdentifier,
  parseYMDToLocalDate,
} from "@/lib/format"
import { getDocumentBillingType } from "@/lib/documentBillingType"
import { getRetainerUsageLabels } from "@/lib/retainerLabels"
import { LockIcon } from "lucide-react"

type BillingType = "t_and_m" | "fixed" | "retainer" | "non_billable"

export type RetainerUsageDocData = {
  kind: "month" | "cycle"
  closed: boolean
  monthlyIncludedMinutes: number
  rows: Array<{
    label: string
    availableMinutes: number
    usedMinutes: number
    balanceMinutes: number
  }>
  total: {
    availableMinutes: number
    usedMinutes: number
    balanceMinutes: number
    amountDue: number
  }
}

export function InvoiceDocument({
  invoice,
  categoryGroups,
  lineItems,
  project,
  client,
  brand,
  retainerUsage,
  org,
  readOnly,
}: {
  invoice: Doc<"invoices">
  categoryGroups: CategoryGroup[]
  lineItems: Doc<"invoiceLineItems">[]
  project: { name: string; billingType: BillingType; fixedPrice?: number } | null
  client: { name: string; billingName?: string; billingEmail?: string; billingStreet?: string; billingStreet2?: string; billingCity?: string; billingZip?: string; billingCountry?: string; taxId?: string } | null
  brand: { brandName?: string; brandAddress?: string; brandTaxId?: string; brandEmail?: string; brandPhone?: string } | null
  retainerUsage: RetainerUsageDocData | null
  org: { paymentInstructions: string | undefined; invoiceMessageTemplate: string | undefined }
  readOnly: boolean
}) {
  const updateInvoice = useMutation(api.invoices.updateInvoice)

  async function handleDateChange(field: "issueDate" | "dueDate", date: Date | undefined) {
    const dateStr = formatDateToYMDOrUndefined(date)
    if (!dateStr && field === "issueDate") return
    const value = dateStr ?? (field === "dueDate" ? null : undefined)
    void updateInvoice({ id: invoice._id, [field]: value }).catch((err) =>
      toastError(err, `Failed to update ${field === "issueDate" ? "issue date" : "due date"}`)
    )
  }

  const billingType = project?.billingType ?? "t_and_m"
  const showAmounts = billingType === "t_and_m"
  const hasBillingSummary = billingType === "fixed" || billingType === "retainer"
  const invoiceNumber = formatInvoiceIdentifier(invoice.prefix, invoice.number)
  const billingTypeLabel = getDocumentBillingType({
    billingType,
    retainerRolloverEnabled: invoice.retainerRolloverEnabled,
    retainerCycleLength: invoice.retainerCycleLength,
  })

  // Single source of truth for line item bucketing. Children render whatever
  // they receive; no double-filtering anywhere downstream
  // (decision 2026-05-03 Q7).
  //
  // For Fixed/Retainer: time rows go to Work Breakdown, fixed/overage/manual
  // rows go to the Billing Summary card. Manual rows belong to Billing because
  // they're typically discounts or one-off charges that should sit next to the
  // total.
  // For T&M: everything stays in Work Breakdown (manual rows render as
  // "Additional items" inside the breakdown), no Billing Summary.
  const { workBreakdownGroups, manualWorkItems, billingItems } = useMemo(() => {
    if (!hasBillingSummary) {
      const manualOnlyGroups = categoryGroups
        .map((group) => ({
          ...group,
          lineItems: group.lineItems.filter((li) => li.lineType !== "manual"),
        }))
        .filter((group) => group.lineItems.length > 0)
        .map((group) => ({
          ...group,
          subtotalHours:
            Math.round(group.lineItems.reduce((s, li) => s + li.quantity, 0) * 100) / 100,
        }))
      const manualItems = categoryGroups.flatMap((g) =>
        g.lineItems.filter((li) => li.lineType === "manual"),
      )
      return {
        workBreakdownGroups: manualOnlyGroups,
        manualWorkItems: manualItems,
        billingItems: [] as Doc<"invoiceLineItems">[],
      }
    }

    // Fixed / retainer — strip everything that belongs in Billing Summary
    // before passing to the work breakdown.
    const timeGroups = categoryGroups
      .map((group) => {
        const timeItems = group.lineItems.filter((li) => li.lineType === "time")
        return {
          ...group,
          lineItems: timeItems,
          subtotalHours:
            Math.round(timeItems.reduce((s, li) => s + li.quantity, 0) * 100) / 100,
        }
      })
      .filter((group) => group.lineItems.length > 0)
    const billing = lineItems.filter(
      (li) => li.lineType === "fixed" || li.lineType === "overage" || li.lineType === "manual",
    )
    return {
      workBreakdownGroups: timeGroups,
      manualWorkItems: [] as Doc<"invoiceLineItems">[],
      billingItems: billing,
    }
  }, [categoryGroups, lineItems, hasBillingSummary])

  const usageLabels = retainerUsage
    ? getRetainerUsageLabels({
        kind: retainerUsage.kind,
        closed: retainerUsage.closed,
        monthlyIncludedMinutes: retainerUsage.monthlyIncludedMinutes,
      })
    : null

  return (
    <div className="flex flex-col gap-8 rounded-lg border bg-card p-6 md:p-8">
      {readOnly && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-amber-200/70 border-l-4 border-l-amber-500 bg-amber-50/60 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:border-l-amber-500 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <LockIcon className="size-4 shrink-0" />
          <span>
            This invoice is locked.{" "}
            <span className="text-amber-800/80 dark:text-amber-300/80">
              Use <span className="font-medium">Revert to draft</span> in the
              sidebar to make changes.
            </span>
          </span>
        </div>
      )}

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

      <DocumentParties brand={brand} client={client} />

      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Invoice</p>
            <p className="mt-1 text-sm font-medium">{invoiceNumber}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Billing Type</p>
            <p className="mt-1 text-sm">{billingTypeLabel}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Issue Date</p>
            {readOnly ? (
              <p className="mt-1 text-sm">{formatInvoiceDate(invoice.issueDate)}</p>
            ) : (
              <div className="mt-1">
                <DatePicker
                  value={parseYMDToLocalDate(invoice.issueDate)}
                  onChange={(d) => handleDateChange("issueDate", d)}
                  className="h-8 w-36 text-sm"
                />
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Due Date</p>
            {readOnly ? (
              <p className="mt-1 text-sm">{invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}</p>
            ) : (
              <div className="mt-1">
                <DatePicker
                  value={parseYMDToLocalDate(invoice.dueDate)}
                  onChange={(d) => handleDateChange("dueDate", d)}
                  className="h-8 w-36 text-sm"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <hr className="border-border" />

      {billingType === "retainer" && retainerUsage && usageLabels && (
        <RetainerUsageTable
          rows={retainerUsage.rows}
          total={retainerUsage.total}
          totalLabel={usageLabels.totalLabel}
          balanceLabel={usageLabels.balanceLabel}
          subtitle={usageLabels.subtitle}
          currency={invoice.currency}
          showPayment={false}
        />
      )}

      <InvoiceWorkBreakdown
        invoiceId={invoice._id}
        timeCategoryGroups={workBreakdownGroups}
        manualItems={manualWorkItems}
        showAmounts={showAmounts}
        readOnly={readOnly}
        currency={invoice.currency}
        subtotal={invoice.subtotal}
        total={invoice.total}
      />

      {hasBillingSummary && billingItems.length > 0 && (
        <InvoiceBillingSummary
          invoiceId={invoice._id}
          billingItems={billingItems}
          readOnly={readOnly}
          currency={invoice.currency}
        />
      )}

      {billingType === "retainer" && (invoice.retainerMonthlyFee ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Monthly retainer fee — {formatCurrency(invoice.retainerMonthlyFee ?? 0, invoice.currency)}/mo —
          billed separately via Stripe.
        </p>
      )}

      <PaymentInstructionsBlock paymentInstructions={org.paymentInstructions} />

      <InvoiceMessageBlock
        invoice={invoice}
        template={org.invoiceMessageTemplate}
      />
    </div>
  )
}

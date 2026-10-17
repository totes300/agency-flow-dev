"use client"

import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"

/**
 * The only edits a draft invoice allows (docs/prd-billing-refactor.md D6):
 * rename any line, and add / edit / remove manual lines. Time and overage
 * amounts come from the close and are never edited on the document — the fix
 * for wrong hours is the ledger, in Billing → Close.
 */
export function useInvoiceLineActions(invoiceId: Id<"invoices">) {
  const setDescription = useMutation(api.billingInvoices.setLineDescription)
  const addManualLine = useMutation(api.billingInvoices.addManualLine)
  const updateManualLine = useMutation(api.billingInvoices.updateManualLine)
  const removeManualLine = useMutation(api.billingInvoices.removeManualLine)

  return {
    rename(lineId: Id<"invoiceLineItems">, description: string) {
      void setDescription({ lineId, description }).catch((err) =>
        toastError(err, "Failed to update line item"),
      )
    },
    updateManual(lineId: Id<"invoiceLineItems">, field: "quantity" | "unitPrice", value: number) {
      void updateManualLine({ lineId, [field]: value }).catch((err) =>
        toastError(err, "Failed to update line item"),
      )
    },
    addManual() {
      void addManualLine({ invoiceId }).catch((err) => toastError(err, "Failed to add line item"))
    },
    removeManual(lineId: Id<"invoiceLineItems">) {
      void removeManualLine({ lineId }).catch((err) => toastError(err, "Failed to remove line item"))
    },
  }
}

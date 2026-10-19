"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"

/**
 * The two ways a project page starts billing (docs/prd-billing-refactor.md D5, D8):
 *
 *   - `reviewClose` — retainer and T&M periods are never invoiced from a
 *     project page. This opens the Close workspace for the period (any month
 *     of a cycle snaps to the cycle) where the owner reviews and commits; with
 *     no period it opens the Billing → Close queue.
 *   - `billFixedFee` — creates a fixed-fee draft for everything left of the
 *     fee and opens it; the draft's sidebar sets the installment amount.
 */
export function useBillingActions() {
  const router = useRouter()
  const createFixedInvoice = useMutation(api.billingInvoices.createFixedInvoice)
  const [pending, setPending] = useState(false)

  function reviewClose(projectId: Id<"projects">, period?: { year: number; month: number }) {
    router.push(
      period
        ? `/billing/close/${projectId}/${period.year}-${String(period.month).padStart(2, "0")}`
        : "/billing",
    )
  }

  async function billFixedFee(projectId: Id<"projects">) {
    if (pending) return
    setPending(true)
    try {
      const { invoiceId } = await createFixedInvoice({ projectId })
      router.push(`/invoices/${invoiceId}`)
    } catch (err) {
      toastError(err, "Couldn't create the invoice")
      setPending(false)
    }
  }

  return { reviewClose, billFixedFee, pending }
}

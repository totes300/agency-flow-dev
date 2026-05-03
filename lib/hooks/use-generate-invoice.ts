"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "convex/react"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { extractErrorMessage } from "@/lib/toast-helpers"
import { formatInvoiceNumber } from "@/lib/format"

type GenerateArgs = {
  projectId: Id<"projects">
  /**
   * Retainer-only month selector. For rollover-OFF retainers this is the
   * billing month; for rollover-ON it's the cycle's **closing** month
   * (`createInvoice` rejects mid-cycle calls).
   */
  retainerYear?: number
  retainerMonth?: number
  /** Optional date range (T&M / Fixed). Server resolves period from entries when omitted. */
  startDate?: string
  endDate?: string
  /** T&M selection mode — explicit time-entry ids. */
  timeEntryIds?: Id<"timeEntries">[]
  /** Server-side rounding bucket. Defaults to 0; the draft page is the edit surface. */
  roundingMinutes?: number
  /**
   * Optional override for the post-create navigation target. Receives the
   * friendly invoice identifier (e.g. "INV-035") so callers can compose
   * any URL shape they want.
   */
  navigateTo?: (identifier: string) => string
}

/**
 * Single-shot "Generate invoice" wiring. Replaces the deleted
 * `CreateInvoiceModal` (D10 in `docs/invoicing-refactor.md`): clicking
 * "Generate invoice" anywhere in the app calls `createInvoice` directly and
 * routes to the draft, which is the edit surface from now on.
 *
 * - Surfaces server errors via toast (e.g. "This period has no overage…").
 * - Toasts a one-line "Resuming draft" hint on resume.
 * - Returns `pending` so callers can disable their button while in flight.
 */
export function useGenerateInvoice(): {
  generate: (args: GenerateArgs) => Promise<void>
  pending: boolean
} {
  const createInvoice = useMutation(api.invoices.createInvoice)
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function generate(args: GenerateArgs): Promise<void> {
    if (pending) return
    setPending(true)
    try {
      const { resumed, prefix, number } = await createInvoice({
        projectId: args.projectId,
        retainerYear: args.retainerYear,
        retainerMonth: args.retainerMonth,
        startDate: args.startDate,
        endDate: args.endDate,
        timeEntryIds: args.timeEntryIds,
        roundingMinutes: args.roundingMinutes ?? 0,
      })
      const identifier = formatInvoiceNumber(prefix, number)
      const target = args.navigateTo
        ? args.navigateTo(identifier)
        : `/invoices/${identifier}?from=project&projectId=${args.projectId}&tab=invoices`
      router.push(target)
      if (resumed) {
        toast.info(`Resuming draft ${formatInvoiceNumber(prefix, number)}`)
      } else {
        toast.success("Invoice created")
      }
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to create invoice"))
    } finally {
      setPending(false)
    }
  }

  return { generate, pending }
}

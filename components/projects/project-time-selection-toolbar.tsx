"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency, formatMinutes } from "@/lib/format"
import { BanIcon, DollarSignIcon, LoaderIcon, ReceiptIcon, XIcon } from "lucide-react"
import type { TimeEntryRow } from "@/components/projects/project-time-table"

/**
 * Renders when one or more time entries are selected. Operates on the full
 * selection — visible rows merged with filter-hidden rows stashed in the
 * parent — so bulk actions honor the user's original intent even across
 * filter changes. Filter-hidden state is surfaced separately by
 * `<ProjectTimeHiddenSelectionBanner>`; this bar just shows totals + actions.
 */
export function ProjectTimeSelectionToolbar({
  selectedEntries,
  currency,
  onDeselectAll,
  onCreateInvoice,
}: {
  selectedEntries: TimeEntryRow[]
  currency: string
  onDeselectAll: () => void
  /**
   * Routes the admin to the Billing → Close queue to review the period before
   * invoicing (PRD slice 08 — no one-click draft from an arbitrary selection;
   * scope rule I2 governs which entries bill). Receives the billable-open ids
   * and how many selected rows were skipped, kept for the parent's discretion.
   */
  onCreateInvoice: (ids: Id<"timeEntries">[], skipped: number) => void
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const [bulkInFlight, setBulkInFlight] = useState<"billable" | "non_billable" | null>(
    null,
  )

  const count = selectedEntries.length
  const totalMinutes = selectedEntries.reduce((sum, e) => sum + e.durationMinutes, 0)
  const totalAmount = selectedEntries.reduce((sum, e) => sum + e.amount, 0)

  // Bulk button visibility: only show when there's something to flip, and
  // skip close-locked rows (the backend rejects them). UI filters for
  // consistency so the count badge never promises a rejected action.
  const flippableToBillable = selectedEntries.filter(
    (e) => !e.isBillable && e.closeStatus === undefined,
  )
  const flippableToNonBillable = selectedEntries.filter(
    (e) => e.isBillable && e.closeStatus === undefined,
  )

  async function runBulk(
    target: boolean,
    which: "billable" | "non_billable",
    rows: TimeEntryRow[],
  ) {
    if (rows.length === 0 || bulkInFlight) return
    setBulkInFlight(which)
    const results = await Promise.allSettled(
      rows.map((e) => updateEntry({ id: e._id, isBillable: target })),
    )
    setBulkInFlight(null)
    const succeeded = results.filter((r) => r.status === "fulfilled").length
    const failed = results.length - succeeded
    if (failed === 0) {
      toast.success(
        `Marked ${succeeded} ${succeeded === 1 ? "entry" : "entries"} ${
          target ? "billable" : "non-billable"
        }`,
      )
    } else {
      const firstFailure = results.find((r) => r.status === "rejected") as
        | PromiseRejectedResult
        | undefined
      toastError(
        firstFailure?.reason,
        `${succeeded} of ${results.length} entries updated`,
      )
    }
  }

  function handleCreate() {
    if (count === 0) return
    const billableOpen = selectedEntries
      .filter((e) => e.isBillable && e.closeStatus === undefined)
      .map((e) => e._id as Id<"timeEntries">)
    if (billableOpen.length === 0) {
      toast.error("Selection has no open billable entries.")
      return
    }
    onCreateInvoice(billableOpen, count - billableOpen.length)
  }

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 20, opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
        >
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 shadow-lg">
            <div className="flex items-center gap-2 pr-2">
              <span className="text-sm font-medium tabular-nums">
                {count} {count === 1 ? "entry" : "entries"} · {formatMinutes(totalMinutes)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear selection"
                onClick={onDeselectAll}
                className="size-6 text-muted-foreground"
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <span className="px-1 text-sm tabular-nums text-muted-foreground">
              {formatCurrency(totalAmount, currency)}
            </span>

            {flippableToBillable.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => runBulk(true, "billable", flippableToBillable)}
                disabled={bulkInFlight !== null}
              >
                {bulkInFlight === "billable" ? (
                  <LoaderIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <DollarSignIcon data-icon="inline-start" className="size-3.5" />
                )}
                Mark Billable
              </Button>
            )}
            {flippableToNonBillable.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  runBulk(false, "non_billable", flippableToNonBillable)
                }
                disabled={bulkInFlight !== null}
              >
                {bulkInFlight === "non_billable" ? (
                  <LoaderIcon data-icon="inline-start" className="animate-spin" />
                ) : (
                  <BanIcon data-icon="inline-start" className="size-3.5" />
                )}
                Mark Non-Billable
              </Button>
            )}

            <Button size="sm" onClick={handleCreate} className="ml-1">
              <ReceiptIcon data-icon="inline-start" className="size-3.5" />
              Review to invoice
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

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
import { BanIcon, DollarSignIcon, LoaderIcon, PlusIcon, XIcon } from "lucide-react"
import type { TimeEntryRow } from "@/components/projects/project-time-table"

export function ProjectTimeSelectionToolbar({
  selectedIds,
  entries,
  currency,
  onDeselectAll,
  onCreateInvoice,
}: {
  selectedIds: Set<string>
  entries: TimeEntryRow[]
  currency: string
  onDeselectAll: () => void
  /**
   * Opens `CreateInvoiceModal` in selection mode. Parent owns the modal and
   * receives both the ids to invoice and how many of the selected rows were
   * skipped (non-billable / already invoiced) so it can show "N of M".
   */
  onCreateInvoice: (ids: Id<"timeEntries">[], skipped: number) => void
}) {
  const updateEntry = useMutation(api.timeEntries.update)
  const [bulkInFlight, setBulkInFlight] = useState<"billable" | "non_billable" | null>(
    null,
  )

  const selected = entries.filter((e) => selectedIds.has(e._id))
  const count = selected.length
  const totalMinutes = selected.reduce((sum, e) => sum + e.durationMinutes, 0)
  const totalAmount = selected.reduce(
    (sum, e) => sum + (e.durationMinutes / 60) * e.billableRate,
    0,
  )

  // Bulk button visibility: only show when there's something to flip, and
  // skip already-invoiced rows (backend blocks; UI filters for consistency).
  const flippableToBillable = selected.filter(
    (e) => !e.isBillable && !e.invoiceId,
  )
  const flippableToNonBillable = selected.filter(
    (e) => e.isBillable && !e.invoiceId,
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
    const billableUninvoiced = selected
      .filter((e) => e.isBillable && !e.invoiceId)
      .map((e) => e._id as Id<"timeEntries">)
    if (billableUninvoiced.length === 0) {
      toast.error("Selection has no billable, uninvoiced entries.")
      return
    }
    onCreateInvoice(billableUninvoiced, count - billableUninvoiced.length)
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
              <PlusIcon data-icon="inline-start" className="size-3.5" />
              Create Invoice
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

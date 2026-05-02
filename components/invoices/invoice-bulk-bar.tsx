"use client"

import { useMemo, useState } from "react"
import { useMutation } from "convex/react"
import { AnimatePresence, motion } from "motion/react"
import {
  CheckCircle2,
  Ban,
  Loader2,
  XIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { formatCurrency, pluralize } from "@/lib/format"
import type { InvoiceRow } from "@/components/invoices/invoice-list"
import type { InvoiceStatus } from "@/components/invoices/invoice-status-badge"
import type { ReadyRow } from "@/lib/invoices/list-rows"

type Pending = "paid" | "void" | null

/**
 * Sticky bulk bar across the unified invoice table. Selection can mix
 * lifecycle stages (ready + draft + invoiced + …) — each action button
 * acts on its own slice and labels its own count, so the user never has to
 * untangle which action covers which row.
 *
 * Visibility rules:
 *
 *   Mark paid  — every selected *invoice* row is status "invoiced".
 *                Ready rows in the selection are ignored.
 *   Void       — every selected *invoice* row is status "draft" or "invoiced".
 *                Ready rows in the selection are ignored.
 *
 * Ready rows have no batch action — every Ready row carries config (rounding,
 * date range, milestone) that requires CreateInvoiceModal. Selection of Ready
 * rows still contributes to the multi-currency total preview.
 *
 * Multi-currency totals never sum across currencies — accounting hazard.
 */
export function InvoiceBulkBar({
  selectedReady,
  selectedInvoices,
  onClear,
}: {
  selectedReady: ReadyRow[]
  selectedInvoices: InvoiceRow[]
  onClear: () => void
}) {
  const bulkChange = useMutation(api.invoices.bulkChangeInvoiceStatus)
  const [pending, setPending] = useState<Pending>(null)

  const count = selectedReady.length + selectedInvoices.length

  const allInvoiceStatuses = useMemo(
    () => new Set<InvoiceStatus>(selectedInvoices.map((i) => i.status)),
    [selectedInvoices],
  )
  const canMarkPaid =
    selectedInvoices.length > 0 &&
    allInvoiceStatuses.size === 1 &&
    allInvoiceStatuses.has("invoiced")
  const canVoid =
    selectedInvoices.length > 0 &&
    [...allInvoiceStatuses].every((s) => s === "draft" || s === "invoiced")

  // Group totals by currency across ALL selected rows (ready amount + invoice
  // total). Never sum across currencies.
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of selectedReady) {
      map.set(r.currency, (map.get(r.currency) ?? 0) + r.amount)
    }
    for (const i of selectedInvoices) {
      map.set(i.currency, (map.get(i.currency) ?? 0) + i.total)
    }
    return map
  }, [selectedReady, selectedInvoices])
  const currencies = [...totalsByCurrency.keys()]

  async function runMark(newStatus: "paid" | "void") {
    if (selectedInvoices.length === 0 || pending) return
    setPending(newStatus)
    try {
      const res = await bulkChange({
        ids: selectedInvoices.map((i) => i._id as Id<"invoices">),
        newStatus,
      })
      const succeeded = res.succeeded.length
      const failed = res.failed.length
      const label = newStatus === "paid" ? "marked paid" : "voided"
      if (failed === 0) {
        toast.success(
          `${succeeded} ${pluralize(succeeded, "invoice", "invoices")} ${label}`,
        )
      } else {
        toast.warning(`${succeeded} ${label}, ${failed} failed`, {
          description: res.failed[0]?.reason,
        })
      }
      onClear()
    } catch (err) {
      toastError(err, "Failed to update invoices")
    } finally {
      setPending(null)
    }
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
                {count} {pluralize(count, "row", "rows")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear selection"
                onClick={onClear}
                className="size-6 text-muted-foreground"
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>

            <Separator orientation="vertical" className="mx-1 h-5" />

            <SelectionTotal
              currencies={currencies}
              totalsByCurrency={totalsByCurrency}
            />

            {canMarkPaid && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runMark("paid")}
                disabled={pending !== null}
              >
                {pending === "paid" ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 data-icon="inline-start" className="size-3.5" />
                )}
                Mark {selectedInvoices.length} paid
              </Button>
            )}
            {canVoid && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runMark("void")}
                disabled={pending !== null}
              >
                {pending === "void" ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <Ban data-icon="inline-start" className="size-3.5" />
                )}
                Void {selectedInvoices.length}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ─── Subcomponent: selection total with multi-currency tooltip ──────────────

function SelectionTotal({
  currencies,
  totalsByCurrency,
}: {
  currencies: string[]
  totalsByCurrency: Map<string, number>
}) {
  if (currencies.length === 0) return null

  if (currencies.length === 1) {
    const [cur] = currencies
    return (
      <span className="px-1 text-sm tabular-nums text-muted-foreground">
        {formatCurrency(totalsByCurrency.get(cur) ?? 0, cur)}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help px-1 text-sm text-muted-foreground underline decoration-dotted decoration-muted-foreground/50 underline-offset-4">
          Mixed currencies
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 tabular-nums">
          {currencies.map((cur) => (
            <div key={cur}>{formatCurrency(totalsByCurrency.get(cur) ?? 0, cur)}</div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

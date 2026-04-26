"use client"

import { useMemo, useState } from "react"
import { useMutation } from "convex/react"
import { AnimatePresence, motion } from "motion/react"
import { CheckCircle2, Ban, Loader2, XIcon } from "lucide-react"
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

type Pending = "paid" | "void" | null

/**
 * Sticky bulk-action bar visually mirroring
 * `project-time-selection-toolbar` so the two selection patterns read as
 * siblings. Action visibility rules:
 *
 *   Mark paid — all selected rows are status "invoiced" (the only legal path).
 *   Void     — all selected rows are status "draft" OR "invoiced".
 *   Mixed    — neither shown; Clear always shown.
 *
 * Totals show a single primary-currency formatted amount when the selection
 * is single-currency, and a "mixed currencies" pill with a tooltip breakdown
 * otherwise. Never sum across currencies.
 */
export function InvoiceBulkBar({
  selectedIds,
  selectedInvoices,
  onClear,
}: {
  selectedIds: ReadonlySet<Id<"invoices">>
  selectedInvoices: InvoiceRow[]
  onClear: () => void
}) {
  const bulkChange = useMutation(api.invoices.bulkChangeInvoiceStatus)
  const [pending, setPending] = useState<Pending>(null)

  const count = selectedIds.size

  const allStatuses = useMemo(
    () => new Set<InvoiceStatus>(selectedInvoices.map((i) => i.status)),
    [selectedInvoices],
  )
  const canMarkPaid =
    count > 0 && allStatuses.size === 1 && allStatuses.has("invoiced")
  const canVoid =
    count > 0 &&
    [...allStatuses].every((s) => s === "draft" || s === "invoiced")

  // Group totals by currency. Never sum across currencies — accounting hazard.
  const totalsByCurrency = useMemo(() => {
    const map = new Map<string, number>()
    for (const inv of selectedInvoices) {
      map.set(inv.currency, (map.get(inv.currency) ?? 0) + inv.total)
    }
    return map
  }, [selectedInvoices])
  const currencies = [...totalsByCurrency.keys()]

  async function runBulk(newStatus: "paid" | "void") {
    if (count === 0 || pending) return
    setPending(newStatus)
    try {
      const res = await bulkChange({
        ids: [...selectedIds] as Id<"invoices">[],
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
        toast.warning(
          `${succeeded} ${label}, ${failed} failed`,
          { description: res.failed[0]?.reason },
        )
      }
      onClear()
    } catch (err) {
      toastError(err, `Failed to update invoices`)
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
                {count} {pluralize(count, "invoice", "invoices")}
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
                onClick={() => runBulk("paid")}
                disabled={pending !== null}
              >
                {pending === "paid" ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 data-icon="inline-start" className="size-3.5" />
                )}
                Mark paid
              </Button>
            )}
            {canVoid && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => runBulk("void")}
                disabled={pending !== null}
              >
                {pending === "void" ? (
                  <Loader2 data-icon="inline-start" className="size-3.5 animate-spin" />
                ) : (
                  <Ban data-icon="inline-start" className="size-3.5" />
                )}
                Void
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

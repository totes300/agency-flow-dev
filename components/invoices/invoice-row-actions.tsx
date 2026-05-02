"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { MoreHorizontal, Undo2, Ban } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { InvoiceStatus } from "@/components/invoices/invoice-status-badge"

type SecondaryAction = {
  label: string
  icon: React.ReactNode
  target: InvoiceStatus
  destructive?: boolean
}

/**
 * The forward-progression action exposed *inline* per status. This is the
 * "most likely next thing the agency owner clicks" — Ready→Generate's
 * sibling for issued invoices. Always visible on hover so users don't dig
 * through a `…` menu for the dominant action.
 *
 *   draft     → Mark as invoiced
 *   invoiced  → Mark as paid
 *   paid      → none (terminal-ish)
 *   void      → none
 */
const PRIMARY_ACTION: Record<
  InvoiceStatus,
  { label: string; target: InvoiceStatus } | null
> = {
  draft: { label: "Mark as invoiced", target: "invoiced" },
  invoiced: { label: "Mark as paid", target: "paid" },
  paid: null,
  void: null,
}

/**
 * Reversal + destructive transitions — these go in the overflow menu,
 * since they're rare and reverting an invoice's lifecycle is a
 * deliberate, second-thought action.
 */
const SECONDARY_ACTIONS: Record<InvoiceStatus, SecondaryAction[]> = {
  draft: [
    { label: "Void", icon: <Ban className="size-3.5" />, target: "void", destructive: true },
  ],
  invoiced: [
    {
      label: "Revert to draft",
      icon: <Undo2 className="size-3.5" />,
      target: "draft",
    },
    { label: "Void", icon: <Ban className="size-3.5" />, target: "void", destructive: true },
  ],
  paid: [
    {
      label: "Revert to invoiced",
      icon: <Undo2 className="size-3.5" />,
      target: "invoiced",
    },
  ],
  void: [],
}

const PAST_TENSE: Record<InvoiceStatus, string> = {
  draft: "reverted to draft",
  invoiced: "marked as invoiced",
  paid: "marked as paid",
  void: "voided",
}

export function InvoiceRowActions({
  invoiceId,
  status,
}: {
  invoiceId: Id<"invoices">
  status: InvoiceStatus
}) {
  const changeStatus = useMutation(api.invoices.changeInvoiceStatus)
  const [open, setOpen] = useState(false)

  const primary = PRIMARY_ACTION[status]
  const secondary = SECONDARY_ACTIONS[status]

  if (!primary && secondary.length === 0) return null

  async function run(target: InvoiceStatus) {
    try {
      await changeStatus({ id: invoiceId, newStatus: target })
      toast.success(`Invoice ${PAST_TENSE[target]}`)
    } catch (err) {
      toastError(err, `Failed to update invoice`)
    }
  }

  // Void is always the last, destructive entry. The earlier definition keeps
  // forward + reversal first so the menu reads top-to-bottom in lifecycle
  // order, with the destructive option visually separated below.
  const reversal = secondary.filter((a) => a.target !== "void")
  const voidAction = secondary.find((a) => a.target === "void") ?? null

  return (
    <div
      className="flex items-center justify-end gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {primary && (
        <Button size="sm" onClick={() => run(primary.target)}>
          {primary.label}
        </Button>
      )}

      {secondary.length > 0 && (
        // Overflow trigger fades on hover — the primary button carries the
        // dominant affordance, so the dots can stay quiet at rest.
        <div className="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected=true]:opacity-100">
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More invoice actions"
                className="size-7 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              {reversal.map((t) => (
                <DropdownMenuItem key={t.target} onSelect={() => run(t.target)}>
                  {t.icon}
                  {t.label}
                </DropdownMenuItem>
              ))}
              {voidAction && reversal.length > 0 && <DropdownMenuSeparator />}
              {voidAction && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => run("void")}
                >
                  {voidAction.icon}
                  {voidAction.label}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}

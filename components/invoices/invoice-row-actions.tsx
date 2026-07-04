"use client"

import { useState } from "react"
import { useAction, useMutation } from "convex/react"
import {
  Ban,
  DownloadIcon,
  FileSpreadsheetIcon,
  MoreHorizontal,
  Trash2,
  Undo2,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WorksheetMenuItem } from "@/components/worksheet/worksheet-menu-item"
import type { InvoiceStatus } from "@/components/invoices/invoice-status-badge"

type StatusAction = {
  kind: "status"
  label: string
  icon: React.ReactNode
  target: InvoiceStatus
  destructive?: boolean
}

type DownloadAction = {
  kind: "download"
  label: string
  icon: React.ReactNode
  destructive?: false
}

type DeleteAction = {
  kind: "delete"
  label: string
  icon: React.ReactNode
  destructive: true
}

type SecondaryAction = StatusAction | DownloadAction | DeleteAction

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
  // Drafts are unnumbered and unissued — the discard path is Delete, which
  // frees the period without burning a sequence number.
  draft: [
    {
      kind: "delete",
      label: "Delete",
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
    },
  ],
  invoiced: [
    {
      kind: "status",
      label: "Revert to draft",
      icon: <Undo2 className="size-3.5" />,
      target: "draft",
    },
    {
      kind: "status",
      label: "Void",
      icon: <Ban className="size-3.5" />,
      target: "void",
      destructive: true,
    },
  ],
  // Paid invoices are immutable records: no revert-to-draft, no delete
  // (lifecycle-tightening, 2026-07-04). "Mark as unpaid" undoes a
  // mis-click; everything further flows through invoiced → void → re-bill.
  paid: [
    {
      kind: "download",
      label: "Download PDF",
      icon: <DownloadIcon className="size-3.5" />,
    },
    {
      kind: "status",
      label: "Mark as unpaid",
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
  identifier,
  status,
}: {
  invoiceId: Id<"invoices">
  /** Friendly URL identifier (e.g. "INV-035") for navigation. */
  identifier: string
  status: InvoiceStatus
}) {
  const changeStatus = useMutation(api.invoices.changeInvoiceStatus)
  const deleteInvoice = useMutation(api.invoices.deleteInvoice)
  // Phase 9 Slice 4 — worksheet companion. Available for draft / invoiced /
  // paid (every status with line items); skipped for `void` because the
  // component short-circuits to null below before the menu renders.
  const exportInvoice = useAction(api.worksheets.exportInvoice)
  const [open, setOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<"delete" | null>(null)

  const primary = PRIMARY_ACTION[status]
  const secondary = SECONDARY_ACTIONS[status]

  if (!primary && secondary.length === 0) return null
  const showWorksheet = status !== "void"

  async function run(target: InvoiceStatus) {
    try {
      await changeStatus({ id: invoiceId, newStatus: target })
      toast.success(`Invoice ${PAST_TENSE[target]}`)
    } catch (err) {
      toastError(err, `Failed to update invoice`)
    } finally {
      setConfirmAction(null)
      setOpen(false)
    }
  }

  async function runDelete() {
    try {
      await deleteInvoice({ id: invoiceId })
      toast.success("Invoice deleted")
    } catch (err) {
      toastError(err, "Failed to delete invoice")
    } finally {
      setConfirmAction(null)
      setOpen(false)
    }
  }

  function downloadPdf() {
    window.open(`/invoices/${identifier}?print=1`, "_blank", "noopener,noreferrer")
    setOpen(false)
  }

  function handleAction(action: SecondaryAction) {
    if (action.kind === "download") {
      downloadPdf()
      return
    }
    if (action.kind === "delete") {
      setConfirmAction("delete")
      return
    }
    void run(action.target)
  }

  const regularActions = secondary.filter((a) => !a.destructive)
  const destructiveActions = secondary.filter((a) => a.destructive)

  return (
    <>
      <div
        className="flex items-center justify-end gap-1"
      >
        {primary && (
          <Button size="sm" onClick={() => run(primary.target)}>
            {primary.label}
          </Button>
        )}

        {(secondary.length > 0 || showWorksheet) && (
          <div
            className={
              status === "paid"
                ? ""
                : "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 group-data-[selected=true]:opacity-100"
            }
          >
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
                {showWorksheet && (
                  <WorksheetMenuItem
                    label="Download worksheet"
                    icon={
                      <FileSpreadsheetIcon className="size-3.5" aria-hidden />
                    }
                    run={() => exportInvoice({ invoiceId })}
                  />
                )}
                {showWorksheet && regularActions.length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {regularActions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    onSelect={() => handleAction(action)}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                ))}
                {destructiveActions.length > 0 && regularActions.length > 0 && (
                  <DropdownMenuSeparator />
                )}
                {destructiveActions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    variant="destructive"
                    onSelect={() => handleAction(action)}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(next) => setConfirmAction(next ? "delete" : null)}
        title="Delete draft?"
        description="This removes the draft and releases its linked time entries so the period can be billed again. No invoice number is affected — drafts are unnumbered."
        confirmLabel="Delete draft"
        variant="destructive"
        onConfirm={() => void runDelete()}
      />
    </>
  )
}

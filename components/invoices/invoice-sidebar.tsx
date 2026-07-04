"use client"

import { useState, useRef } from "react"
import Link from "next/link"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { getDocumentBillingType } from "@/lib/documentBillingType"
import { formatCurrency, formatInvoiceDate } from "@/lib/format"
import { ChevronDownIcon, PrinterIcon } from "lucide-react"

export function InvoiceSidebar({
  invoice,
  project,
  timezone,
  readOnly,
  backHref,
  fixedBilled,
  onPrint,
  brandMissing = false,
}: {
  invoice: Doc<"invoices">
  project: { name: string; billingType: string; fixedPrice?: number } | null
  timezone: string
  readOnly: boolean
  backHref: string
  fixedBilled?: number
  onPrint?: () => void
  /**
   * Seller identity (company name) not set yet — mirrors the server-side
   * finalize gate so the button explains itself instead of failing.
   */
  brandMissing?: boolean
}) {
  const router = useRouter()
  const updateInvoice = useMutation(api.invoices.updateInvoice)
  const changeStatus = useMutation(api.invoices.changeInvoiceStatus)
  const deleteInvoiceMutation = useMutation(api.invoices.deleteInvoice)

  // Note editing — always-visible textarea with autosave on blur.
  //
  // State model:
  //   `note` = in-flight draft
  //   `lastSyncedNote` = the server value we last reconciled against
  //
  // Compare-in-render (React 19 idiom) picks up concurrent server updates
  // without a useEffect, and guards against overwriting unsaved typing while
  // a save is in flight. On save failure the draft is preserved so the user
  // never silently loses their input.
  const [note, setNote] = useState(invoice.note ?? "")
  const [lastSyncedNote, setLastSyncedNote] = useState(invoice.note ?? "")
  const savingNoteRef = useRef(false)
  if (!savingNoteRef.current && (invoice.note ?? "") !== lastSyncedNote) {
    setLastSyncedNote(invoice.note ?? "")
    setNote(invoice.note ?? "")
  }

  // Note is collapsed by default unless it already has content — surfacing
  // existing notes is higher-value than hiding them behind a click.
  const [noteOpen, setNoteOpen] = useState(Boolean(invoice.note))

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = useState<
    | null
    | "markInvoiced"
    | "revertToDraft"
    | "delete"
  >(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function handleNoteSave() {
    if (savingNoteRef.current) return
    const trimmed = note.trim()
    if (trimmed === (invoice.note ?? "")) return
    savingNoteRef.current = true
    try {
      await updateInvoice({ id: invoice._id, note: trimmed })
      setLastSyncedNote(trimmed)
    } catch (err) {
      toastError(err, "Failed to update note")
      // Keep `note` as-is so the user's typing survives the failure.
    } finally {
      savingNoteRef.current = false
    }
  }

  async function handleStatusChange(
    newStatus: "draft" | "invoiced" | "paid",
    successMessage: string,
  ) {
    setActionLoading(true)
    try {
      await changeStatus({ id: invoice._id, newStatus })
      toast.success(successMessage)
    } catch (err) {
      toastError(err, "Failed to change status")
    }
    setActionLoading(false)
    setConfirmAction(null)
  }

  function handleDelete() {
    // Optimistic navigation pattern (Linear / Notion / Stripe).
    //
    // Navigate away FIRST, fire-and-forget the mutation second. This unmounts
    // the page before Convex's reactive subscription sees the deletion and
    // flips `getInvoice` to `null` — which would otherwise race with the
    // page render and trigger `notFound()` mid-navigation.
    //
    // If the server rejects the delete, the toast tells the user on the
    // destination page; we don't try to navigate back because that's worse
    // UX than leaving them on a clean list view.
    setConfirmAction(null)
    router.replace(backHref)
    void deleteInvoiceMutation({ id: invoice._id })
      .then(() => toast.success("Invoice deleted"))
      .catch((err) => toastError(err, "Failed to delete invoice"))
  }

  const showFixedProgress =
    project?.billingType === "fixed" &&
    project.fixedPrice != null &&
    project.fixedPrice > 0 &&
    fixedBilled != null
  const billingTypeLabel = getDocumentBillingType({
    billingType: project?.billingType,
    retainerRolloverEnabled: invoice.retainerRolloverEnabled,
    retainerCycleLength: invoice.retainerCycleLength,
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Total — hero. The number IS the headline; we drop the "Amount" label
          because it's self-evident at this size. SR users get the label via
          the aria annotation on the <p>. */}
      <div>
        <p
          aria-label={`Invoice total ${formatCurrency(invoice.total, invoice.currency)}`}
          className="text-4xl font-semibold tabular-nums tracking-tight md:text-5xl"
        >
          {formatCurrency(invoice.total, invoice.currency)}
        </p>
        <div className="mt-3">
          <InvoiceStatusBadge
            status={invoice.status}
            dueDate={invoice.dueDate}
            timezone={timezone}
          />
        </div>
      </div>

      {/* Fixed Fee progress — thin bar + compact legend */}
      {showFixedProgress && (
        <FixedFeeProgress
          billed={fixedBilled!}
          total={project!.fixedPrice!}
          currency={invoice.currency}
        />
      )}

      {/* Issue / Due dates — side by side, compact */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Issue date</p>
          <p className="text-sm tabular-nums">{formatInvoiceDate(invoice.issueDate)}</p>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Due date</p>
          <p className="text-sm tabular-nums">
            {invoice.dueDate ? formatInvoiceDate(invoice.dueDate) : "—"}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted-foreground">Billing type</p>
        <p className="text-sm">{billingTypeLabel}</p>
      </div>

      {/* Note — collapsed by default when empty; always visible summary keeps
          existing notes discoverable without demanding attention. */}
      <div>
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          aria-expanded={noteOpen}
          aria-controls="invoice-note-editor"
          className="group flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <span>
            Note
            {!noteOpen && invoice.note && (
              <span className="ml-2 font-normal text-muted-foreground/80">
                · {truncate(invoice.note, 32)}
              </span>
            )}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              noteOpen && "rotate-180",
            )}
          />
        </button>

        {noteOpen && (
          <div id="invoice-note-editor" className="mt-2">
            {readOnly ? (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {invoice.note || "No note"}
              </p>
            ) : (
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={handleNoteSave}
                placeholder="Add a note…"
                rows={3}
                className="min-h-20 resize-none"
              />
            )}
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        {invoice.status === "draft" && (
          <>
            <Button
              onClick={() => setConfirmAction("markInvoiced")}
              disabled={actionLoading || brandMissing}
            >
              Mark as Invoiced
            </Button>
            {brandMissing && (
              <p className="text-xs text-muted-foreground">
                Invoices need a seller name.{" "}
                <Link href="/settings" className="font-medium text-foreground hover:underline">
                  Add your company details
                </Link>{" "}
                to issue this invoice.
              </p>
            )}
          </>
        )}

        {onPrint && (
          <Button variant="outline" onClick={onPrint}>
            <PrinterIcon data-icon="inline-start" className="size-3.5" />
            Save as PDF
          </Button>
        )}

        {invoice.status === "invoiced" && (
          <>
            <Button
              onClick={() => {
                void handleStatusChange("paid", "Invoice marked as paid")
              }}
              disabled={actionLoading}
            >
              Mark as Paid
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setConfirmAction("revertToDraft")}
              disabled={actionLoading}
            >
              Revert to Draft
            </Button>
          </>
        )}

        {/* Paid is immutable (lifecycle-tightening 2026-07-04): the only
            reverse edge is undoing the payment mark. No revert-to-draft,
            no delete — corrections flow through invoiced → void. */}
        {invoice.status === "paid" && (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              void handleStatusChange("invoiced", "Invoice marked as unpaid")
            }}
            disabled={actionLoading}
          >
            Mark as Unpaid
          </Button>
        )}

        {/* Drafts are unnumbered and unissued — deleting one never burns a
            sequence number. Finalized invoices can only be voided. */}
        {invoice.status === "draft" && (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmAction("delete")}
            disabled={actionLoading}
          >
            Delete Draft
          </Button>
        )}
      </div>

      {/* Confirm: Mark as Invoiced */}
      <ConfirmDialog
        open={confirmAction === "markInvoiced"}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title="Mark as Invoiced"
        description="This will lock the invoice for editing. You can revert to draft later if corrections are needed."
        confirmLabel="Mark as Invoiced"
        onConfirm={() => {
          void handleStatusChange("invoiced", "Invoice marked as invoiced")
        }}
      />

      {/* Confirm: Revert to Draft */}
      <ConfirmDialog
        open={confirmAction === "revertToDraft"}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title="Revert to Draft"
        description="This will unlock the invoice for editing."
        confirmLabel="Revert to Draft"
        onConfirm={() => {
          void handleStatusChange("draft", "Invoice reverted to draft")
        }}
      />

      {/* Confirm: Delete (drafts only) */}
      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(open) => { if (!open) setConfirmAction(null) }}
        title="Delete draft?"
        description="This removes the draft and releases its linked time entries so the period can be billed again. No invoice number is affected — drafts are unnumbered."
        confirmLabel="Delete draft"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}

// ─── Local primitives ────────────────────────────────────────────────────────

function FixedFeeProgress({
  billed,
  total,
  currency,
}: {
  billed: number
  total: number
  currency: string
}) {
  const ratio = total > 0 ? billed / total : 0
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Project billed</span>
        <span className="tabular-nums">
          {formatCurrency(billed, currency)}{" "}
          <span className="text-muted-foreground">
            / {formatCurrency(total, currency)}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fixed fee progress"
        className="h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

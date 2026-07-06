"use client"

import { useState, useRef } from "react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { api } from "@/convex/_generated/api"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { CompanyDetailsDialog } from "@/components/invoices/company-details-dialog"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { InlineEditableNumber } from "@/components/inline-editable"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import { getDocumentBillingType } from "@/lib/documentBillingType"
import { formatCurrency, formatInvoiceDate, getCurrencySymbol } from "@/lib/format"
import { formatDuration } from "@/lib/duration"
import { ChevronDownIcon, PrinterIcon, RefreshCwIcon } from "lucide-react"

export function InvoiceSidebar({
  invoice,
  project,
  timezone,
  readOnly,
  backHref,
  fixedBilled,
  fixedLine,
  hasTimeLines = false,
  staleEntries,
  onPrint,
  brandMissing = false,
}: {
  invoice: Doc<"invoices">
  project: { name: string; billingType: string; fixedPrice?: number } | null
  timezone: string
  readOnly: boolean
  backHref: string
  fixedBilled?: number
  /**
   * The draft's `lineType:"fixed"` row — enables the partial-billing control
   * (amount + presets) in the sidebar. The document canvas stays chrome-free;
   * this is the single edit surface for the fixed amount.
   */
  fixedLine?: { id: Id<"invoiceLineItems">; amount: number } | null
  /** Draft has time lines → show the time-rounding picker. */
  hasTimeLines?: boolean
  /**
   * Entries eligible for this draft but not on it (logged since creation).
   * Drives the amber "Refresh draft" callout + the finalize warning.
   */
  staleEntries?: { count: number; totalMinutes: number } | null
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
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false)

  // Stale-draft refresh — pulls entries logged since the draft was created.
  const refreshDraft = useMutation(api.invoices.refreshInvoiceDraft)
  const [refreshing, setRefreshing] = useState(false)
  const isStaleDraft =
    invoice.status === "draft" && !readOnly && (staleEntries?.count ?? 0) > 0

  async function handleRefreshDraft() {
    setRefreshing(true)
    try {
      const res = await refreshDraft({ invoiceId: invoice._id })
      toast.success(
        res.added > 0
          ? `Added ${res.added} ${res.added === 1 ? "entry" : "entries"} (${formatDuration(res.addedMinutes)}) to the draft`
          : "Draft is already up to date",
      )
    } catch (err) {
      toastError(err, "Failed to refresh draft")
    } finally {
      setRefreshing(false)
    }
  }

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

      {/* Stale-draft callout — entries logged since this draft was created.
          One-click fix in place; retainer finalize is also server-gated. */}
      {isStaleDraft && staleEntries && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs leading-relaxed">
            <span className="font-medium tabular-nums">
              {staleEntries.count} {staleEntries.count === 1 ? "entry" : "entries"} (
              {formatDuration(staleEntries.totalMinutes)})
            </span>{" "}
            logged since this draft was created.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            disabled={refreshing}
            onClick={() => { void handleRefreshDraft() }}
          >
            <RefreshCwIcon
              data-icon="inline-start"
              className={cn("size-3.5", refreshing && "animate-spin")}
            />
            Refresh draft
          </Button>
        </div>
      )}

      {/* Fixed Fee — on drafts this is THE edit surface for partial billing
          (segmented bar + amount + presets); finalized/readOnly invoices get
          the compact progress bar. The document canvas stays chrome-free. */}
      {showFixedProgress &&
        (invoice.status === "draft" && !readOnly && fixedLine ? (
          <FixedFeeBillingControl
            billedFinalized={fixedBilled!}
            fee={project!.fixedPrice!}
            lineId={fixedLine.id}
            amount={fixedLine.amount}
            currency={invoice.currency}
          />
        ) : (
          <FixedFeeProgress
            billed={fixedBilled!}
            total={project!.fixedPrice!}
            currency={invoice.currency}
          />
        ))}

      {/* Time rounding — drafts with time lines. The ledger stays exact;
          this rounds each line UP to the increment on this document only. */}
      {invoice.status === "draft" && !readOnly && hasTimeLines && (
        <TimeRoundingPicker
          invoiceId={invoice._id}
          value={invoice.roundingMinutes ?? 1}
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
        {invoice.status === "draft" &&
          (brandMissing ? (
            // Never a dead disabled button: the blocker's resolution IS the
            // primary action. Saving flips this back to Mark as Invoiced
            // reactively (brandMissing comes from a live query).
            <>
              <Button onClick={() => setCompanyDialogOpen(true)}>
                Add company details to issue
              </Button>
              <p className="text-xs text-muted-foreground">
                Issued invoices must name the seller — takes a few seconds,
                saved once for the whole workspace.
              </p>
              <CompanyDetailsDialog
                open={companyDialogOpen}
                onOpenChange={setCompanyDialogOpen}
              />
            </>
          ) : (
            <Button
              onClick={() => setConfirmAction("markInvoiced")}
              disabled={actionLoading}
            >
              Mark as Invoiced
            </Button>
          ))}

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
        description={
          isStaleDraft && staleEntries
            ? `${staleEntries.count} ${staleEntries.count === 1 ? "entry" : "entries"} (${formatDuration(staleEntries.totalMinutes)}) logged since this draft was created ${staleEntries.count === 1 ? "is" : "are"} NOT on it. Refresh the draft to include them, or finalize without them.`
            : "This will lock the invoice for editing. You can revert to draft later if corrections are needed."
        }
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

function roundCents(n: number): number {
  return Math.round(n * 100) / 100
}

const ROUNDING_CHOICES = [
  { label: "Exact", value: 1 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
] as const

/**
 * Per-draft time-rounding control. Re-derives the time lines from their raw
 * minutes server-side — switching back and forth is lossless because the
 * ledger is never rounded. Defaults from the workspace "Invoice rounding"
 * setting at draft creation.
 */
function TimeRoundingPicker({
  invoiceId,
  value,
}: {
  invoiceId: Id<"invoices">
  value: number
}) {
  const updateRounding = useMutation(api.invoices.updateInvoiceRounding)
  const active = value <= 1 ? 1 : value

  function pick(next: number) {
    if (next === active) return
    void updateRounding({ invoiceId, roundingMinutes: next }).catch((err) =>
      toastError(err, "Failed to change rounding"),
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">Time rounding</p>
      <div className="flex flex-wrap items-center gap-1">
        {ROUNDING_CHOICES.map(({ label, value: v }) => (
          <button
            key={v}
            type="button"
            onClick={() => pick(v)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
              v === active
                ? "border-foreground/20 bg-muted text-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Rounds each line&apos;s time up on this invoice. Timesheets keep exact time.
      </p>
    </div>
  )
}

/**
 * Draft-only partial-billing control for the fixed fee. Owns the amount of
 * the invoice's `fixed` line: segmented bar (billed so far / this draft /
 * remaining), editable amount, percentage presets, and the resulting
 * position ("after this" / "remains"). Presets are % of the TOTAL fee,
 * clamped to the unbilled remainder; "Remainder" bills everything left.
 */
function FixedFeeBillingControl({
  billedFinalized,
  fee,
  lineId,
  amount,
  currency,
}: {
  billedFinalized: number
  fee: number
  lineId: Id<"invoiceLineItems">
  amount: number
  currency: string
}) {
  const updateLineItem = useMutation(api.invoices.updateInvoiceLineItem)

  function saveAmount(value: number) {
    if (roundCents(value) === roundCents(amount)) return
    void updateLineItem({ id: lineId, amount: value }).catch((err) =>
      toastError(err, "Failed to update amount"),
    )
  }

  const remaining = roundCents(fee - billedFinalized)
  const afterThis = roundCents(billedFinalized + amount)
  const remainsAfter = roundCents(fee - afterThis)
  const pct = (v: number) =>
    fee > 0 ? Math.max(0, Math.min(100, (v / fee) * 100)) : 0

  const presets = [
    { label: "25%", value: Math.min(roundCents(fee * 0.25), remaining) },
    { label: "50%", value: Math.min(roundCents(fee * 0.5), remaining) },
    { label: "Remainder", value: remaining },
  ]

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">Fixed fee</span>
        <span className="tabular-nums text-muted-foreground">
          {formatCurrency(fee, currency)}
        </span>
      </div>

      {/* Segmented bar: solid = already billed, half-tone = this draft */}
      <div
        role="img"
        aria-label={`${formatCurrency(billedFinalized, currency)} billed, ${formatCurrency(amount, currency)} on this invoice, ${formatCurrency(remainsAfter, currency)} remaining`}
        className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full bg-foreground transition-[width] duration-300"
          style={{ width: `${pct(billedFinalized)}%` }}
        />
        <div
          className="h-full bg-foreground/35 transition-[width] duration-300"
          style={{ width: `${pct(amount)}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">This invoice</span>
        <InlineEditableNumber
          value={amount}
          onSave={saveAmount}
          ariaLabel="Edit billed amount"
          errorMessage="Failed to update amount"
          prefix={getCurrencySymbol(currency)}
        />
      </div>

      <div className="flex items-center gap-1">
        {presets.map(({ label, value }) => {
          const active = roundCents(value) === roundCents(amount)
          return (
            <button
              key={label}
              type="button"
              disabled={value <= 0}
              onClick={() => { if (!active) saveAmount(value) }}
              className={cn(
                "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-foreground/20 bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">After this invoice</span>
          <span className="tabular-nums">
            {formatCurrency(afterThis, currency)}{" "}
            <span className="text-muted-foreground">
              / {formatCurrency(fee, currency)}
            </span>
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">Remains</span>
          <span className="tabular-nums">{formatCurrency(remainsAfter, currency)}</span>
        </div>
      </div>
    </div>
  )
}

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

"use client"

import { useRef, useState } from "react"
import { useMutation } from "convex/react"
import { PencilIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { canEditInvoiceMessage } from "@/convex/lib/invoiceCreation"
import { toastError } from "@/lib/toast-helpers"

/**
 * Editable per-invoice message rendered on the invoice document.
 *
 *  - Draft: editable. Empty → "+ Add a message to client" affordance that
 *    opens the editor seeded with the org template.
 *  - Invoiced / Paid / Void: read-only. Renders nothing when
 *    `messageToClient` is empty (no placeholder on sent invoices).
 *
 * Gate logic is shared with the server-side `updateInvoiceMessage` mutation
 * via `canEditInvoiceMessage` — single source of truth.
 *
 * Persistence: on-blur save to `updateInvoiceMessage`. Mirrors the inline-edit
 * pattern used elsewhere in the invoice editor.
 */
export function InvoiceMessageBlock({
  invoice,
  template,
}: {
  invoice: Doc<"invoices">
  template: string | undefined
}) {
  const updateMessage = useMutation(api.invoices.updateInvoiceMessage)
  const persistedMessage = invoice.messageToClient ?? ""
  const editable = canEditInvoiceMessage(invoice)

  // Local draft only matters while focused. Computed (not synced) — when
  // not editing we render `persistedMessage` directly, so external updates
  // flow through without a sync effect.
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState("")
  // True when the editor was opened via the "+ Add" affordance and seeded
  // from the template. Lets us discard on blur if the user never edits the
  // seed — even if their typing happens to equal the template.
  const seededFromTemplateRef = useRef(false)

  if (!editable && !persistedMessage) return null

  const displayValue = isEditing ? draft : persistedMessage

  function commit(next: string) {
    const trimmed = next.trim()
    if (trimmed === persistedMessage) return
    void updateMessage({ id: invoice._id, messageToClient: trimmed }).catch((err) =>
      toastError(err, "Failed to update message"),
    )
  }

  function handleFocus() {
    if (!isEditing) {
      setDraft(persistedMessage)
      setIsEditing(true)
    }
  }

  function handleAddClick() {
    setDraft(template ?? "")
    seededFromTemplateRef.current = true
    setIsEditing(true)
    // Textarea below is rendered with autoFocus when this branch enters.
  }

  function handleBlur() {
    setIsEditing(false)
    // Affordance opened, never edited → discard the template seed.
    if (seededFromTemplateRef.current) {
      seededFromTemplateRef.current = false
      return
    }
    commit(draft)
  }

  // Read-only view (Invoiced / Paid money-due / Void with message).
  if (!editable) {
    return (
      <section aria-label="Message to client" className="border-t border-border pt-4">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          Message to client
        </h3>
        <p className="whitespace-pre-wrap rounded-md border border-emerald-200/40 bg-emerald-50/50 p-3 text-sm italic leading-relaxed text-foreground dark:border-emerald-900/40 dark:bg-emerald-950/30">
          {persistedMessage}
        </p>
      </section>
    )
  }

  // Empty editable state → affordance only.
  if (!isEditing && !persistedMessage) {
    return (
      <div className="border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAddClick}
          className="self-start gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <PencilIcon className="size-3.5" />
          Add a message to client
        </Button>
      </div>
    )
  }

  // Editing or non-empty editable. autoFocus only when entering edit mode from
  // the "+ Add" affordance — won't yank focus on initial render of an existing
  // message (isEditing false → component re-renders only on user interaction).
  return (
    <section aria-label="Message to client" className="border-t border-border pt-4">
      <label
        htmlFor={`invoice-message-${invoice._id}`}
        className="mb-2 block text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400"
      >
        Message to client
      </label>
      <Textarea
        autoFocus={isEditing && !persistedMessage}
        id={`invoice-message-${invoice._id}`}
        value={displayValue}
        onChange={(e) => {
          // Any edit invalidates the "untouched seed" discard path.
          seededFromTemplateRef.current = false
          setDraft(e.target.value)
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
        rows={3}
        placeholder="Write a short message to your client…"
        className="resize-none border-emerald-200/60 bg-emerald-50/30 text-sm italic leading-relaxed dark:border-emerald-900/40 dark:bg-emerald-950/20"
      />
    </section>
  )
}

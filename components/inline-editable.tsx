"use client"

import * as React from "react"
import { useInlineEdit } from "@/lib/hooks/use-inline-edit"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

// Shared surface styling: transparent underline by default, strengthens on
// hover, locks in on focus. Linear-style single underline (no border swap,
// no padding shift between view ↔ edit modes).
const surfaceBase =
  "inline-block bg-transparent text-left outline-none " +
  "border-b border-transparent transition-colors " +
  "hover:border-border/60 " +
  "focus-visible:border-foreground/70"

// ─── Text ────────────────────────────────────────────────────────────────────

export interface InlineEditableProps {
  value: string
  onSave: (next: string) => void | Promise<void>
  /** Accessible name for the trigger (required — screen readers cannot infer it from context). */
  ariaLabel: string
  /** Rendered when the value is empty. */
  placeholder?: string
  /** Prefixed to the error toast; the underlying Convex message is appended. */
  errorMessage?: string
  readOnly?: boolean
  className?: string
}

/**
 * Click-to-edit single-line text surface.
 *
 * View mode: a `button` (Tab-reachable, Enter/Space activates). On commit the
 * draft is trimmed and diffed against the current value; no-op if unchanged.
 * On save failure the error is toasted and the draft is preserved so typing
 * isn't silently lost.
 */
export function InlineEditable({
  value,
  onSave,
  ariaLabel,
  placeholder = "—",
  errorMessage,
  readOnly = false,
  className,
}: InlineEditableProps) {
  const edit = useInlineEdit<string>({
    value,
    serialize: (v) => v,
    onCommit: async (draft) => {
      const trimmed = draft.trim()
      if (trimmed === value) return
      try {
        await onSave(trimmed)
      } catch (err) {
        toastError(err, errorMessage ?? "Failed to save")
        // Re-throw so the hook keeps the edit surface open and preserves the
        // draft — user sees their typing and can retry.
        throw err
      }
    },
  })

  if (readOnly) {
    return (
      <span className={cn("inline-block", className)}>
        {value || placeholder}
      </span>
    )
  }

  if (edit.editing) {
    return (
      <input
        type="text"
        autoFocus
        aria-label={ariaLabel}
        value={edit.draft}
        onChange={(e) => edit.setDraft(e.target.value)}
        onBlur={() => void edit.commit()}
        onKeyDown={edit.handleKeyDown}
        className={cn(surfaceBase, className)}
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={edit.beginEdit}
      className={cn(surfaceBase, "cursor-text", className)}
    >
      {value || <span className="text-muted-foreground">{placeholder}</span>}
    </button>
  )
}

// ─── Number ──────────────────────────────────────────────────────────────────

export interface InlineEditableNumberProps {
  value: number
  onSave: (next: number) => void | Promise<void>
  ariaLabel: string
  /** Suffix appended in view mode (e.g. "h" for hours). Not editable. */
  suffix?: string
  errorMessage?: string
  readOnly?: boolean
  className?: string
  /** Overrides the default `w-20` input width. Useful for rate vs hours cells. */
  inputClassName?: string
}

/**
 * Click-to-edit numeric surface with non-negative clamping. Same UX as
 * {@link InlineEditable} but with a right-aligned `tabular-nums` display and
 * a fixed-width input in edit mode.
 */
export function InlineEditableNumber({
  value,
  onSave,
  ariaLabel,
  suffix,
  errorMessage,
  readOnly = false,
  className,
  inputClassName,
}: InlineEditableNumberProps) {
  const edit = useInlineEdit<number>({
    value,
    serialize: (v) => String(v),
    onCommit: async (draft) => {
      const parsed = parseFloat(draft)
      if (Number.isNaN(parsed)) return
      // Clamp to non-negative: mirrors the server guard in
      // convex/invoices.ts:updateInvoiceLineItem.
      const clamped = Math.max(0, parsed)
      if (clamped === value) return
      try {
        await onSave(clamped)
      } catch (err) {
        toastError(err, errorMessage ?? "Failed to save")
        throw err
      }
    },
  })

  const display = suffix ? `${value}${suffix}` : String(value)

  if (readOnly) {
    return (
      <span className={cn("tabular-nums", className)}>{display}</span>
    )
  }

  if (edit.editing) {
    return (
      <input
        type="number"
        step="any"
        min={0}
        autoFocus
        aria-label={ariaLabel}
        value={edit.draft}
        onChange={(e) => edit.setDraft(e.target.value)}
        onBlur={() => void edit.commit()}
        onKeyDown={edit.handleKeyDown}
        className={cn(
          surfaceBase,
          "w-20 text-right tabular-nums",
          inputClassName,
          className,
        )}
      />
    )
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={edit.beginEdit}
      className={cn(surfaceBase, "cursor-text tabular-nums", className)}
    >
      {display}
    </button>
  )
}

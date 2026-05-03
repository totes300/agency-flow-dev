"use client"

import * as React from "react"
import { useInlineEdit } from "@/lib/hooks/use-inline-edit"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"

// ─── Chip surface (Notion / Stripe pattern) ─────────────────────────────────
//
// The chip is a single visual unit holding `prefix? + input + suffix?`. It's
// the ONE element responsible for visible chrome — the input itself is naked
// (no border, no padding, transparent). Visual state is driven entirely by
// `:hover` and `:focus-within` on the chip; there is no DOM swap between view
// and edit modes.
//
// Focus ring uses `box-shadow: inset` instead of `border` so the 1px outline
// adds zero layout footprint (a transparent → visible border swap would
// produce a 1px nudge on every focus).
const chipSurface =
  "inline-flex items-center cursor-text rounded-md " +
  "px-1.5 py-0.5 transition-[background-color,box-shadow] " +
  "bg-transparent hover:bg-accent/60 " +
  "focus-within:bg-background focus-within:hover:bg-background " +
  "focus-within:shadow-[inset_0_0_0_1px_var(--color-border)]"

// Strips every default browser style — the chip alone owns the visual chrome.
const nakedInput =
  "min-w-0 border-0 bg-transparent p-0 outline-none " +
  "focus:outline-none focus:ring-0"

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select()
}

/**
 * Blur the input after Enter / Escape so the next focus re-runs select-all
 * cleanly. Without this, `useInlineEdit.cancel()` flips `editing` off but
 * leaves the input focused, and subsequent keystrokes desync the controlled
 * `value` from the rendered field.
 */
function blurOnSubmitOrCancel(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter" || e.key === "Escape") {
    e.currentTarget.blur()
  }
}

// Allow only digits and a single decimal point. Anything else (letters,
// extra dots, signs) is silently dropped before it reaches the draft.
function sanitizeNumericInput(raw: string): string {
  const stripped = raw.replace(/[^0-9.]/g, "")
  const firstDot = stripped.indexOf(".")
  if (firstDot === -1) return stripped
  return (
    stripped.slice(0, firstDot + 1) +
    stripped.slice(firstDot + 1).replace(/\./g, "")
  )
}

// ─── Text ────────────────────────────────────────────────────────────────────

export interface InlineEditableProps {
  value: string
  onSave: (next: string) => void | Promise<void>
  /** Accessible name for the input (required — screen readers cannot infer it from context). */
  ariaLabel: string
  /** Rendered when the value is empty. */
  placeholder?: string
  /** Prefixed to the error toast; the underlying Convex message is appended. */
  errorMessage?: string
  readOnly?: boolean
  /** Applied to the chip wrapper. Use this for typography/width overrides. */
  className?: string
}

/**
 * Click-to-edit single-line text. The input is always mounted; the chip's
 * hover and focus-within states give the visual affordance. On commit the
 * draft is trimmed and diffed against the current value (no-op if unchanged).
 * Save failure preserves the draft and re-focuses so typing isn't lost.
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
      if (trimmed === value) return false
      try {
        await onSave(trimmed)
        return true
      } catch (err) {
        toastError(err, errorMessage ?? "Failed to save")
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

  // `edit.draft` is the single source of truth — it tracks user typing while
  // editing, and the hook auto-syncs it with `value` when the prop changes
  // externally. Avoids the value-flash window during commit.
  const display = edit.draft

  return (
    <label className={cn(chipSurface, "w-full", className)}>
      <input
        type="text"
        aria-label={ariaLabel}
        value={display}
        placeholder={placeholder}
        onFocus={(e) => {
          edit.beginEdit()
          selectAllOnFocus(e)
        }}
        onChange={(e) => {
          if (!edit.editing) edit.beginEdit()
          edit.setDraft(e.target.value)
        }}
        onBlur={() => void edit.commit()}
        onKeyDown={(e) => {
          edit.handleKeyDown(e)
          blurOnSubmitOrCancel(e)
        }}
        className={cn(
          nakedInput,
          "w-full text-left placeholder:text-muted-foreground",
        )}
      />
    </label>
  )
}

// ─── Number ──────────────────────────────────────────────────────────────────

export interface InlineEditableNumberProps {
  value: number
  onSave: (next: number) => void | Promise<void>
  ariaLabel: string
  /** Static, non-editable text shown inside the chip on the left
   * (typically a currency symbol). Sits flush against the input so `$5`
   * reads as one tight unit. */
  prefix?: string
  /** Static, non-editable text shown inside the chip on the right
   * (e.g. "h" for hours). */
  suffix?: string
  errorMessage?: string
  readOnly?: boolean
  /** Applied to the chip wrapper. */
  className?: string
}

/**
 * Click-to-edit numeric value with non-negative clamping.
 *
 * The input width is **content-fit** via the HTML `size` attribute (which is
 * why we use `type="text" + inputMode="decimal"` rather than `type="number"`,
 * which ignores `size`). As a result the chip wraps tightly around whatever
 * the user has typed: the prefix `$` sits one space away from the value
 * regardless of length, instead of floating at the far left of a fixed-width
 * input.
 *
 * `-mr-1.5` on the chip absorbs its own right padding, putting the value's
 * right edge flush with the cell's right edge so editable rows align with
 * non-editable rows like `$720` above them.
 */
export function InlineEditableNumber({
  value,
  onSave,
  ariaLabel,
  prefix,
  suffix,
  errorMessage,
  readOnly = false,
  className,
}: InlineEditableNumberProps) {
  const edit = useInlineEdit<number>({
    value,
    serialize: (v) => String(v),
    onCommit: async (draft) => {
      const parsed = parseFloat(draft)
      if (Number.isNaN(parsed)) return false
      // Clamp to non-negative — mirrors the server guard in
      // convex/invoices.ts:updateInvoiceLineItem.
      const clamped = Math.max(0, parsed)
      if (clamped === value) return false
      try {
        await onSave(clamped)
        return true
      } catch (err) {
        toastError(err, errorMessage ?? "Failed to save")
        throw err
      }
    },
  })

  // `edit.draft` is the single source of truth — see InlineEditable above
  // for why we don't fall back to `String(value)` when `editing` is false.
  const display = edit.draft
  // `size` is the input's character width. Bumping by 1 leaves room for
  // the cursor at the end of the value during editing.
  const inputSize = Math.max(2, display.length + 1)

  if (readOnly) {
    return (
      <span className={cn("inline-flex items-center tabular-nums", className)}>
        {prefix && (
          <span className="select-none pr-0.5 text-muted-foreground">
            {prefix}
          </span>
        )}
        <span>{value}</span>
        {suffix && (
          <span className="select-none pl-0.5 text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
    )
  }

  return (
    <label className={cn(chipSurface, "-mr-1.5 tabular-nums", className)}>
      {prefix && (
        <span className="select-none pr-0.5 text-muted-foreground">
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        size={inputSize}
        aria-label={ariaLabel}
        value={display}
        onFocus={(e) => {
          edit.beginEdit()
          selectAllOnFocus(e)
        }}
        onChange={(e) => {
          if (!edit.editing) edit.beginEdit()
          edit.setDraft(sanitizeNumericInput(e.target.value))
        }}
        onBlur={() => void edit.commit()}
        onKeyDown={(e) => {
          edit.handleKeyDown(e)
          blurOnSubmitOrCancel(e)
        }}
        className={cn(nakedInput, "text-right tabular-nums")}
      />
      {suffix && (
        <span className="select-none pl-0.5 text-muted-foreground">
          {suffix}
        </span>
      )}
    </label>
  )
}

"use client"

import { useRef, useState } from "react"

/**
 * Click-to-edit state machine: `view` ↔ `edit`.
 *
 * The caller owns save semantics (sync vs async, parsing, error handling).
 * This hook only manages:
 *   - whether we're editing
 *   - the in-flight draft string
 *   - Enter / Escape keyboard shortcuts
 *   - a guard ref so blur+Enter don't both fire a save
 */
export function useInlineEdit<T>({
  value,
  serialize,
  onCommit,
}: {
  value: T
  /** Convert the domain value to the string shown in the input. */
  serialize: (v: T) => string
  /** Called once per save. Receives the current draft string; caller parses + validates. */
  onCommit: (draft: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => serialize(value))
  const savingRef = useRef(false)

  function beginEdit() {
    setDraft(serialize(value))
    setEditing(true)
  }

  async function commit() {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await onCommit(draft)
      // Success: exit edit mode and keep the latest draft. The next `beginEdit`
      // will resync from the now-updated `value`.
      setEditing(false)
    } catch {
      // Save failed: stay in edit mode so the user sees their draft and can
      // retry. The caller's `onCommit` is expected to have already surfaced
      // the error (toast, form error, etc.). We swallow the re-throw here.
    } finally {
      savingRef.current = false
    }
  }

  function cancel() {
    setDraft(serialize(value))
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      void commit()
    } else if (e.key === "Escape") {
      cancel()
    }
  }

  return {
    editing,
    draft,
    setDraft,
    beginEdit,
    commit,
    cancel,
    handleKeyDown,
  }
}

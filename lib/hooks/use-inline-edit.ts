"use client"

import { useRef, useState } from "react"

/**
 * Click-to-edit state machine for inline-editable surfaces.
 *
 * The caller owns save semantics (parsing, validation, the actual mutation).
 * This hook manages:
 *   - the in-flight draft string (single source of truth for what the input
 *     displays — there is no `editing ? draft : value` ternary anywhere)
 *   - syncing that draft with the upstream `value` when it changes
 *     externally (e.g. another collaborator's edit) without clobbering an
 *     in-progress edit
 *   - Enter / Escape keyboard shortcuts
 *   - a guard ref so blur+Enter don't both fire a save
 *
 * Why draft-as-truth instead of `editing ? draft : value`: when `onCommit`
 * resolves the mutation Promise, React re-renders before the Convex
 * subscription delivers the new `value`. With the ternary, that one render
 * window paints the OLD `value` — the user sees their just-typed number
 * flash back to the previous one and then forward again. Holding the draft
 * across the commit boundary closes that window.
 */
export function useInlineEdit<T>({
  value,
  serialize,
  onCommit,
}: {
  value: T
  /** Convert the domain value to the string shown in the input. */
  serialize: (v: T) => string
  /**
   * Called once per save attempt. Receives the current draft; the caller
   * parses, validates, and (if appropriate) calls the mutation.
   *
   * Return value:
   *   - `true`  → a save actually happened. The draft is left as-is so the
   *               user's typed text stays on screen until `value` catches
   *               up (no value-flash on commit).
   *   - `false` → no save (invalid input, no diff, etc). The draft is
   *               reset to `serialize(value)` so the field doesn't strand
   *               unsaved garbage like "abc".
   *   - thrown  → save failed. The draft is preserved and the field stays
   *               in edit mode so the user can fix and retry.
   */
  onCommit: (draft: string) => Promise<boolean> | boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => serialize(value))
  const [prevValue, setPrevValue] = useState(value)
  const savingRef = useRef(false)

  // Adjust draft when `value` changes externally (React docs: "Adjusting
  // some state when a prop changes" — done in render, not useEffect, so the
  // sync converges in a single commit). Skipped while the user is editing
  // or a save is in flight, so we never clobber in-progress typing.
  if (value !== prevValue) {
    setPrevValue(value)
    if (!editing && !savingRef.current) {
      setDraft(serialize(value))
    }
  }

  function beginEdit() {
    setDraft(serialize(value))
    setEditing(true)
  }

  async function commit() {
    if (savingRef.current) return
    savingRef.current = true
    let saved = false
    let failed = false
    try {
      saved = await onCommit(draft)
    } catch {
      failed = true
    } finally {
      savingRef.current = false
    }
    if (failed) {
      // Save attempted but errored — keep draft and stay in edit mode so the
      // user sees their input and can retry. The caller's onCommit is
      // expected to have already surfaced the error (toast, etc).
      return
    }
    if (!saved) {
      // No save attempted (invalid input or no-op). Reset draft so the
      // field doesn't strand stale text.
      setDraft(serialize(value))
    }
    setEditing(false)
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

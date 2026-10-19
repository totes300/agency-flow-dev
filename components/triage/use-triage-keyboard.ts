"use client"

import { useEffect, useRef } from "react"

/**
 * Triage keys (docs/prd-email-triage.md §7.7, implementation plan F10; B8b):
 *
 *   J / K   move the selection (only while the list is on screen)
 *   ⌘↵      the item's primary action (Create, Send, Apply, Mark done, Retry …)
 *   M       Merge into…     D  Decline     H  Snooze     ?  the shortcuts
 *
 * Letters for Merge / Decline (not the PRD's 2 / 3) so the digits mean one
 * thing only: 1–4 belong to a focused question block (it handles them
 * itself). No key fires while focus is in an editable field (the composer,
 * the email component, the drawer's fields), from inside the drawer (it owns
 * its keys), with another modifier held, or while a menu or a dialog other
 * than the docked drawer is open.
 */

export type TriageKeyAction = "next" | "prev" | "primary" | "merge" | "decline" | "snooze" | "shortcuts"

export const TRIAGE_SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["J", "K"], label: "Next / previous email" },
  { keys: ["⌘", "↵"], label: "Primary action (Create, Send …)" },
  { keys: ["M"], label: "Merge into a task" },
  { keys: ["D"], label: "Decline" },
  { keys: ["H"], label: "Snooze" },
  { keys: ["1–4"], label: "Answer the focused question" },
  { keys: ["Esc"], label: "Close the panel (from inside it)" },
  { keys: ["?"], label: "Keyboard shortcuts" },
]

export type TriageKeyEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  /** Focus is in an input, textarea, select or contenteditable. */
  targetEditable: boolean
  /** The key came from inside the (docked) drawer — the drawer owns it. */
  targetInDrawer: boolean
  /** A menu, popover or dialog (other than the docked drawer) owns the keyboard. */
  overlayOpen: boolean
  /** The list column is on screen (hidden while the drawer is open). */
  listVisible: boolean
}

/** The action for a key press, or null (pure — unit-tested). */
export function triageKeyAction(e: TriageKeyEvent): TriageKeyAction | null {
  if (e.overlayOpen || e.targetEditable || e.targetInDrawer) return null
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === "Enter") return "primary"
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  switch (e.key) {
    case "j":
    case "J":
      return e.listVisible ? "next" : null
    case "k":
    case "K":
      return e.listVisible ? "prev" : null
    case "m":
    case "M":
      return "merge"
    case "d":
    case "D":
      return "decline"
    case "h":
    case "H":
      return "snooze"
    case "?":
      return "shortcuts"
    default:
      // Digits are never Triage's: a focused question block owns 1–4 (F10).
      return null
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null
}

/** A Radix menu / popover / dialog is open — the docked drawer does not count. */
export function overlayIsOpen(): boolean {
  return (
    document.querySelector(
      "[role='dialog'][data-state='open']:not([data-drawer-mode='docked']), [role='alertdialog'][data-state='open'], [role='menu'][data-state='open']",
    ) !== null
  )
}

/** The next selection for J/K: the first row when none, clamped at the ends. */
export function stepSelection(ids: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (ids.length === 0) return null
  const at = current ? ids.indexOf(current) : -1
  if (at === -1) return ids[0]
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))]
}

export function useTriageKeyboard({
  enabled,
  listVisible,
  onAction,
}: {
  enabled: boolean
  listVisible: boolean
  onAction: (action: TriageKeyAction) => void
}) {
  const handlerRef = useRef(onAction)
  useEffect(() => {
    handlerRef.current = onAction
  })
  useEffect(() => {
    if (!enabled) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      const action = triageKeyAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetEditable: isEditableTarget(event.target),
        targetInDrawer: event.target instanceof Element && event.target.closest("[data-drawer-shell]") !== null,
        overlayOpen: overlayIsOpen(),
        listVisible,
      })
      if (!action) return
      event.preventDefault()
      handlerRef.current(action)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [enabled, listVisible])
}

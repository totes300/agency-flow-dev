"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * The original email's fold (docs/prd-email-triage.md D14, §7.2; B8b):
 *
 *   - before a plan exists the whole email shows;
 *   - once the agent has a plan it folds to one line — but NEVER while the
 *     reader is in it (pointer over it, focus inside, or a text selection in
 *     it): the fold waits until they leave;
 *   - the owner's own choice ("Show the original email" / "Hide email") wins
 *     and is remembered per item for the session (switching items and back
 *     keeps it).
 */

const remembered = new Map<string, boolean>()

/** Test hook: forget every remembered choice. */
export function resetEmailFoldMemory() {
  remembered.clear()
}

export function useEmailFold(itemId: string, hasPlan: boolean) {
  // true = the owner expanded it, false = they folded it, undefined = automatic.
  const [choice, setChoice] = useState<boolean | undefined>(() => remembered.get(itemId))
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const reading = hovered || focused || selecting

  const wantFolded = choice === undefined ? hasPlan : !choice
  const [folded, setFolded] = useState(wantFolded)
  // Follow the wanted state — except that an automatic fold waits for the reader.
  if (folded !== wantFolded) {
    const automaticFold = wantFolded && choice === undefined
    if (!(automaticFold && reading)) setFolded(wantFolded)
  }

  const ref = useRef<HTMLElement | null>(null)
  // A selection inside the email keeps it open (reading / copying a line).
  useEffect(() => {
    function onSelection() {
      const node = ref.current
      const selection = document.getSelection()
      const inside =
        !!node &&
        !!selection &&
        !selection.isCollapsed &&
        selection.rangeCount > 0 &&
        node.contains(selection.getRangeAt(0).commonAncestorContainer)
      setSelecting(inside)
    }
    document.addEventListener("selectionchange", onSelection)
    return () => document.removeEventListener("selectionchange", onSelection)
  }, [])

  const choose = useCallback(
    (expanded: boolean) => {
      remembered.set(itemId, expanded)
      setChoice(expanded)
    },
    [itemId],
  )

  return {
    folded,
    expand: () => choose(true),
    fold: () => choose(false),
    /** Spread on the expanded email's root element. */
    readerProps: {
      ref: (node: HTMLElement | null) => {
        ref.current = node
      },
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => setFocused(true),
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      },
    },
  }
}

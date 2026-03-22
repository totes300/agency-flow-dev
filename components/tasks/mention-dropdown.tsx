"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"

// ─── Types ──────────────────────────────────────────────────────────────────────

export type MentionSuggestion = { id: string; label: string }

export interface MentionDropdownState {
  items: MentionSuggestion[]
  command: (item: MentionSuggestion) => void
  clientRect: (() => DOMRect | null) | null | undefined
}

// ─── Component ──────────────────────────────────────────────────────────────────

const DROPDOWN_OFFSET = 4

export function MentionDropdown({
  state,
  onKeyDownRef,
}: {
  state: MentionDropdownState
  onKeyDownRef: React.MutableRefObject<((e: SuggestionKeyDownProps) => boolean) | null>
}) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const { items, command, clientRect } = state

  // Refs for stable access in the keyboard handler — avoids stale closures
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const commandRef = useRef(command)
  commandRef.current = command

  // Reset selection when items change
  useEffect(() => setSelectedIndex(0), [items])

  // Expose keyboard handler — only depends on the ref, so registered once
  useEffect(() => {
    onKeyDownRef.current = ({ event }: SuggestionKeyDownProps) => {
      const currentItems = itemsRef.current
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + currentItems.length - 1) % currentItems.length)
        return true
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % currentItems.length)
        return true
      }
      if (event.key === "Enter") {
        const item = currentItems[selectedIndexRef.current]
        if (item) commandRef.current(item)
        return true
      }
      if (event.key === "Escape") {
        return true
      }
      return false
    }
    return () => { onKeyDownRef.current = null }
  }, [onKeyDownRef])

  if (items.length === 0) return null

  const rect = clientRect?.()
  if (!rect) return null

  return (
    <div
      role="listbox"
      className="fixed z-50 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ top: rect.bottom + DROPDOWN_OFFSET, left: rect.left }}
      // Prevent any mouse events from reaching the editor and causing blur
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          tabIndex={-1}
          onClick={() => commandRef.current(item)}
          className={cn(
            "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
            index === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "text-popover-foreground hover:bg-accent/50",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

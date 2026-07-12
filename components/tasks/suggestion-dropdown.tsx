"use client"

import { useState, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import type { SuggestionKeyDownProps } from "@tiptap/suggestion"

const DROPDOWN_OFFSET = 4

export interface SuggestionDropdownProps<T> {
  items: T[]
  onSelect: (item: T) => void
  clientRect: (() => DOMRect | null) | null | undefined
  onKeyDownRef: React.MutableRefObject<((e: SuggestionKeyDownProps) => boolean) | null>
  renderItem: (item: T) => React.ReactNode
  keyExtractor: (item: T) => string
  itemClassName?: string
}

export function SuggestionDropdown<T>({
  items,
  onSelect,
  clientRect,
  onKeyDownRef,
  renderItem,
  keyExtractor,
  itemClassName,
}: SuggestionDropdownProps<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = Math.min(selectedIndex, Math.max(items.length - 1, 0))

  // Reset selection to the first item when the list changes (e.g. the user
  // types to filter). Adjust-state-during-render (React's blessed pattern for
  // deriving from a changed prop) instead of a sync effect.
  const [prevItems, setPrevItems] = useState(items)
  if (items !== prevItems) {
    setPrevItems(items)
    setSelectedIndex(0)
  }

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[activeIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  useEffect(() => {
    onKeyDownRef.current = ({ event }: SuggestionKeyDownProps) => {
      if (items.length === 0) return false
      if (event.key === "ArrowUp") {
        setSelectedIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === "ArrowDown") {
        setSelectedIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === "Enter") {
        const item = items[activeIndex]
        if (item) onSelect(item)
        return true
      }
      if (event.key === "Escape") {
        return true
      }
      return false
    }
    return () => { onKeyDownRef.current = null }
  }, [activeIndex, items, onKeyDownRef, onSelect])

  if (items.length === 0) return null

  const rect = clientRect?.()
  if (!rect) return null
  if (typeof document === "undefined") return null

  // Flip upward when the caret is close enough to the bottom edge that a
  // downward-opening menu would overflow the viewport — the composer sits at
  // the bottom of the screen, so this is the common case there.
  const maxHeight = 288 // matches max-h-72
  const spaceBelow = window.innerHeight - rect.bottom
  const openAbove = spaceBelow < maxHeight + DROPDOWN_OFFSET && rect.top > spaceBelow
  const style: React.CSSProperties = openAbove
    ? { bottom: window.innerHeight - rect.top + DROPDOWN_OFFSET, left: rect.left }
    : { top: rect.bottom + DROPDOWN_OFFSET, left: rect.left }

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={keyExtractor(item)}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          tabIndex={-1}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center rounded-md text-left transition-colors",
            index === activeIndex
              ? "bg-accent text-accent-foreground"
              : "text-popover-foreground hover:bg-accent/50",
            itemClassName,
          )}
        >
          {renderItem(item)}
        </button>
      ))}
    </div>,
    document.body,
  )
}

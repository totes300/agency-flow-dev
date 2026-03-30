"use client"

import { useState, useEffect, useRef } from "react"
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

  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIndexRef = useRef(selectedIndex)
  selectedIndexRef.current = selectedIndex
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => setSelectedIndex(0), [items])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

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
        if (item) onSelectRef.current(item)
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
      ref={listRef}
      role="listbox"
      className="fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ top: rect.bottom + DROPDOWN_OFFSET, left: rect.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <button
          key={keyExtractor(item)}
          type="button"
          role="option"
          aria-selected={index === selectedIndex}
          tabIndex={-1}
          onClick={() => onSelectRef.current(item)}
          className={cn(
            "flex w-full items-center rounded-md text-left transition-colors",
            index === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "text-popover-foreground hover:bg-accent/50",
            itemClassName,
          )}
        >
          {renderItem(item)}
        </button>
      ))}
    </div>
  )
}

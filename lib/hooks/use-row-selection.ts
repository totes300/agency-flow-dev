"use client"

import { useCallback, useMemo, useRef, useState } from "react"

type HeaderState = "none" | "some" | "all"

export type RowSelection<Id extends string> = {
  selectedIds: ReadonlySet<Id>
  size: number
  isSelected: (id: Id) => boolean
  toggle: (id: Id, opts?: { shiftKey?: boolean }) => void
  clear: () => void
  /** Tri-state select/deselect for the header checkbox. */
  toggleAllVisible: () => void
  headerState: HeaderState
}

/**
 * Selection state for a table with ordered visible rows. Supports:
 *
 *   - single toggle
 *   - shift-range toggle (anchor = last clicked row; target = shift-clicked row)
 *   - tri-state header ("none" / "some" / "all" relative to visible rows)
 *
 * Pass the same `visibleIds` array every render (memoize on the caller side)
 * so the range expansion and header state stay stable.
 */
export function useRowSelection<Id extends string>(
  visibleIds: readonly Id[],
): RowSelection<Id> {
  const [selectedIds, setSelectedIds] = useState<Set<Id>>(() => new Set())
  const lastClickedRef = useRef<Id | null>(null)

  // Keep selection scoped to currently-visible rows: stale IDs (e.g. a row
  // filtered out after a server refresh) get pruned on the next render.
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds])

  const isSelected = useCallback(
    (id: Id) => selectedIds.has(id),
    [selectedIds],
  )

  const toggle = useCallback(
    (id: Id, opts?: { shiftKey?: boolean }) => {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        const anchor = lastClickedRef.current
        if (opts?.shiftKey && anchor && anchor !== id) {
          const fromIdx = visibleIds.indexOf(anchor)
          const toIdx = visibleIds.indexOf(id)
          if (fromIdx !== -1 && toIdx !== -1) {
            const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
            // Range behavior follows the target cell's new state — if the
            // shift-clicked row would turn on, fill the range on; otherwise off.
            const targetOn = !next.has(id)
            for (let i = lo; i <= hi; i++) {
              const rowId = visibleIds[i]
              if (targetOn) next.add(rowId)
              else next.delete(rowId)
            }
            lastClickedRef.current = id
            return next
          }
        }
        if (next.has(id)) next.delete(id)
        else next.add(id)
        lastClickedRef.current = id
        return next
      })
    },
    [visibleIds],
  )

  const clear = useCallback(() => {
    setSelectedIds(new Set())
    lastClickedRef.current = null
  }, [])

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = visibleIds.every((id) => prev.has(id))
      if (allSelected) return new Set()
      return new Set(visibleIds)
    })
  }, [visibleIds])

  const headerState: HeaderState = useMemo(() => {
    if (visibleIds.length === 0 || selectedIds.size === 0) return "none"
    const visibleSelected = visibleIds.filter((id) => selectedIds.has(id)).length
    if (visibleSelected === 0) return "none"
    if (visibleSelected === visibleIds.length) return "all"
    return "some"
  }, [visibleIds, selectedIds])

  // Prune stale selections when the visible set shrinks.
  const scopedSelected = useMemo(() => {
    if (selectedIds.size === 0) return selectedIds
    let mutated = false
    const next = new Set<Id>()
    for (const id of selectedIds) {
      if (visibleSet.has(id)) next.add(id)
      else mutated = true
    }
    return mutated ? next : selectedIds
  }, [selectedIds, visibleSet])

  return {
    selectedIds: scopedSelected,
    size: scopedSelected.size,
    isSelected,
    toggle,
    clear,
    toggleAllVisible,
    headerState,
  }
}

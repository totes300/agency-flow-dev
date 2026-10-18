"use client"

import { useEffect, useRef } from "react"
import type { Id } from "@/convex/_generated/dataModel"
import type { PropertyMenuKind } from "@/components/task-view/property-menus"

/**
 * List keyboard (U10) for the table. Covers the keys that work on the list
 * itself: C new task, J/K (and ↓/↑) move focus, Enter / Space open the
 * focused task (drawer-or-page mode is slice 6), X select, S/P/A/L property
 * menus, T today (the sun on the focused task or the selection; on My Tasks
 * Today without a focused row, the "Add tasks to today" picker), Y timer,
 * F filter, / search, Esc clear, ? shortcuts. J/K inside an open task is the
 * detail's own stepping.
 *
 * Keys are ignored while typing, with a modifier held, or while a dialog,
 * menu or the task detail is open (those own the keyboard).
 */

export type TaskKeyboardHandlers = {
  enabled: boolean
  orderedIds: readonly Id<"tasks">[]
  focusedId: Id<"tasks"> | null
  setFocusedId: (id: Id<"tasks"> | null) => void
  hasSelection: boolean
  onOpen: (id: Id<"tasks">) => void
  onToggleSelect: (id: Id<"tasks">) => void
  onClearSelection: () => void
  onOpenMenu: (kind: PropertyMenuKind, focusedId: Id<"tasks">) => void
  onToggleTimer: (id: Id<"tasks">) => void
  /** T: the focused task (null when nothing is focused). */
  onToday: (focusedId: Id<"tasks"> | null) => void
  onNewTask: () => void
  onShowShortcuts: () => void
  onFilter: () => void
  onSearch: () => void
}

export const TASK_LIST_SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["C"], label: "New task" },
  { keys: ["J", "K"], label: "Move focus down / up" },
  { keys: ["↵", "Space"], label: "Open focused task" },
  { keys: ["X"], label: "Select focused task" },
  { keys: ["S"], label: "Change status (then 1–9)" },
  { keys: ["P"], label: "Change priority (then 0–4)" },
  { keys: ["A"], label: "Assign (then 0–9)" },
  { keys: ["L"], label: "Labels (then 1–9)" },
  { keys: ["T"], label: "Add to today" },
  { keys: ["Y"], label: "Start / stop timer" },
  { keys: ["F"], label: "Filter" },
  { keys: ["/"], label: "Search" },
  { keys: ["Esc"], label: "Clear selection / focus" },
  { keys: ["?"], label: "Keyboard shortcuts" },
]

const MENU_KEYS: Record<string, PropertyMenuKind> = { s: "status", p: "priority", a: "assignee", l: "labels" }

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null
}

/**
 * A Radix dialog, popover or menu is open. (The task detail drawer is always
 * mounted with role="dialog"; the caller disables the list keys while a task
 * is open instead.)
 */
function overlayOpen(): boolean {
  return document.querySelector("[role='dialog'][data-state='open'], [role='menu'][data-state='open']") !== null
}

/** Next focus for J/K: the first row when nothing is focused, clamped at the ends. */
export function nextFocus(
  orderedIds: readonly Id<"tasks">[],
  focusedId: Id<"tasks"> | null,
  step: 1 | -1,
): Id<"tasks"> | null {
  if (orderedIds.length === 0) return null
  const index = focusedId ? orderedIds.indexOf(focusedId) : -1
  if (index === -1) return orderedIds[0]
  return orderedIds[Math.min(orderedIds.length - 1, Math.max(0, index + step))]
}

export function useTaskKeyboard(handlers: TaskKeyboardHandlers) {
  // Latest handlers without re-binding the listener on every render.
  const ref = useRef(handlers)
  useEffect(() => {
    ref.current = handlers
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const h = ref.current
      if (!h.enabled || e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target) || overlayOpen()) return

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const focused = h.focusedId

      const move = (step: 1 | -1) => {
        e.preventDefault()
        h.setFocusedId(nextFocus(h.orderedIds, focused, step))
      }

      switch (key) {
        case "j":
        case "ArrowDown":
          return move(1)
        case "k":
        case "ArrowUp":
          return move(-1)
        case "c":
          e.preventDefault()
          return h.onNewTask()
        case "?":
          e.preventDefault()
          return h.onShowShortcuts()
        case "f":
          e.preventDefault()
          return h.onFilter()
        case "/":
          e.preventDefault()
          return h.onSearch()
        case "t":
          e.preventDefault()
          return h.onToday(focused)
        case "Escape":
          if (h.hasSelection) h.onClearSelection()
          else h.setFocusedId(null)
          return
      }

      if (!focused) return
      switch (key) {
        case "Enter":
        case " ":
          e.preventDefault()
          return h.onOpen(focused)
        case "x":
          e.preventDefault()
          return h.onToggleSelect(focused)
        case "y":
          e.preventDefault()
          return h.onToggleTimer(focused)
      }
      const kind = MENU_KEYS[key]
      if (kind) {
        e.preventDefault()
        h.onOpenMenu(kind, focused)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])
}

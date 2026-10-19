"use client"

import { createContext, useContext, useEffect, useRef } from "react"
import { FocusScope } from "@radix-ui/react-focus-scope"
import { ErrorBoundary } from "@/components/error-boundary"
import { cn } from "@/lib/utils"

/**
 * The right drawer's chrome (docs/prd-tasks-refactor.md §6.2), shared by
 * every drawer source (email-triage B7): an existing task, a Draft
 * (`createTask` proposal) and a proposed change (`updateTask`). 54vw panel
 * sliding in from the right, focus trapped while open, `Esc` closes (unless
 * a menu or popover inside handled it), body scroll locked. While open it is
 * `[role=dialog][data-state=open]`, so the list's shortcuts (J/K, C, Esc …)
 * stand down; `data-drawer-shell` lets the drawer's own keys tell it apart
 * from a dialog opened on top of it.
 */
/**
 * How the drawer sits on the page. `modal` (default): focus trapped, body
 * scroll locked — the drawer owns the screen. `docked` (Triage, B8b): the
 * conversation and the drawer share the space (§7.2), so focus moves freely
 * between them and the page keeps scrolling; `Esc` and the drawer's own keys
 * act only while focus is inside the drawer.
 */
export type DrawerShellMode = "modal" | "docked"

export const DrawerShellModeContext = createContext<DrawerShellMode>("modal")

export function DrawerShell({
  isOpen,
  label,
  onClose,
  children,
}: {
  isOpen: boolean
  label: string
  onClose: () => void
  children: React.ReactNode
}) {
  const docked = useContext(DrawerShellModeContext) === "docked"
  const rootRef = useRef<HTMLDivElement>(null)
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      // Docked, the page beside it keeps its own Esc (the composer, a block):
      // only an Esc from inside the drawer closes it.
      if (docked && !(e.target instanceof Node && rootRef.current?.contains(e.target))) return
      // A menu or popover inside the drawer handled it (Radix prevents default).
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose, docked])

  // Lock body scroll when open (a modal drawer only)
  useEffect(() => {
    if (!isOpen || docked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [isOpen, docked])

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal={docked ? undefined : "true"}
      aria-label={label}
      // List shortcuts treat an open dialog as owning the keyboard (`use-task-keyboard`
      // overlayOpen); the drawer's own keys skip `data-drawer-shell`.
      data-state={isOpen ? "open" : "closed"}
      data-drawer-shell=""
      data-drawer-mode={docked ? "docked" : undefined}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40 w-[54vw] border-l border-border bg-background shadow-[-8px_0_24px_-12px_rgba(0,0,0,0.08)] flex flex-col max-md:w-full",
        "transition-transform duration-200 ease-out",
        isOpen ? "translate-x-0" : "translate-x-full pointer-events-none",
      )}
    >
      {isOpen ? (
        <FocusScope trapped={!docked} className="flex flex-1 flex-col min-h-0 overflow-hidden">
          <ErrorBoundary>{children}</ErrorBoundary>
        </FocusScope>
      ) : null}
    </div>
  )
}

"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"

type InboxSidebarContextValue = {
  /** Desktop inbox panel visibility. Mobile uses the Sheet instead. */
  inboxOpen: boolean
  /** Epoch ms of the last open — anchors the panel's week bucketing. */
  lastOpenedAt: number
  openInbox: () => void
  closeInbox: () => void
  toggleInbox: () => void
}

const InboxSidebarContext = createContext<InboxSidebarContextValue | null>(null)

export function useInboxSidebar(): InboxSidebarContextValue {
  const ctx = useContext(InboxSidebarContext)
  if (!ctx) {
    throw new Error("useInboxSidebar must be used within an InboxSidebarProvider")
  }
  return ctx
}

/**
 * Desktop inbox ⇄ navigation choreography. Owns BOTH the inbox state and
 * the (controlled) nav-sidebar state, replacing the bare SidebarProvider
 * in the dashboard layout:
 *
 * - Opening the inbox collapses the nav sidebar to its icon rail and slides
 *   the inbox panel open next to it — one continuous motion (both animate
 *   width with the sidebar's own 200ms ease-linear).
 * - Closing restores the sidebar to whatever state it had BEFORE the inbox
 *   opened (a user who prefers the icon rail keeps the icon rail).
 * - Re-expanding the sidebar by hand (trigger, rail, ⌘/Ctrl+B) while the
 *   inbox is open closes the inbox in the SAME event — controlled mode
 *   routes every sidebar toggle through handleSidebarOpenChange, so the
 *   invariant "never expanded sidebar + open inbox" needs no effect.
 * - The panel survives navigation (this provider lives in the dashboard
 *   layout): the inbox doubles as an always-on live notification monitor.
 * - Escape closes the inbox only when nothing above it claims the key:
 *   the task drawer/modal (the `detail` URL param) and any open Radix
 *   dialog/sheet/alert/popover win first.
 */
export function InboxSidebarProvider({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inboxOpen, setInboxOpen] = useState(false)
  const [lastOpenedAt, setLastOpenedAt] = useState(() => Date.now())
  const prevSidebarOpenRef = useRef(true)

  // Every manual sidebar toggle (trigger button, rail, ⌘/Ctrl+B) lands here.
  const handleSidebarOpenChange = useCallback((open: boolean) => {
    setSidebarOpen(open)
    if (open) setInboxOpen(false) // expanding nav dismisses the inbox
  }, [])

  const openInbox = useCallback(() => {
    if (isMobile || inboxOpen) return
    prevSidebarOpenRef.current = sidebarOpen
    setSidebarOpen(false)
    setLastOpenedAt(Date.now())
    setInboxOpen(true)
  }, [isMobile, inboxOpen, sidebarOpen])

  const closeInbox = useCallback(() => {
    if (!inboxOpen) return
    setInboxOpen(false)
    setSidebarOpen(prevSidebarOpenRef.current)
  }, [inboxOpen])

  const toggleInbox = useCallback(() => {
    if (inboxOpen) {
      closeInbox()
    } else {
      openInbox()
    }
  }, [inboxOpen, closeInbox, openInbox])

  // Escape: close the inbox unless a layer above it owns the key.
  useEffect(() => {
    if (!inboxOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      // Task drawer/modal open (both read the `detail` param) — its own
      // Escape handler closes it; the inbox waits for the next press.
      if (new URLSearchParams(window.location.search).has("detail")) return
      // Any open Radix overlay (dialog, alert, sheet, popover) wins too.
      if (
        document.querySelector(
          '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"], [data-slot="sheet-content"][data-state="open"], [data-slot="popover-content"][data-state="open"]'
        )
      ) {
        return
      }
      closeInbox()
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [inboxOpen, closeInbox])

  return (
    <InboxSidebarContext.Provider
      value={{ inboxOpen, lastOpenedAt, openInbox, closeInbox, toggleInbox }}
    >
      <SidebarProvider open={sidebarOpen} onOpenChange={handleSidebarOpenChange}>
        {children}
      </SidebarProvider>
    </InboxSidebarContext.Provider>
  )
}

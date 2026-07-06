"use client"

import { Suspense } from "react"
import { useSidebar } from "@/components/ui/sidebar"
import { InboxPanel } from "@/components/inbox/inbox-panel"
import { useInboxSidebar } from "@/components/inbox/inbox-sidebar-context"
import { cn } from "@/lib/utils"

export const INBOX_SIDEBAR_WIDTH = "25rem"

/**
 * Desktop inbox panel, rendered as a flex sibling between the nav sidebar
 * and the content. Width animates 0 ⇄ 25rem with the sidebar's own timing
 * (200ms ease-linear) so collapse + open read as one motion.
 *
 * The panel stays MOUNTED while closed (clipped to width 0, inert):
 * the Convex subscription stays warm — no skeleton flash on open, live
 * updates keep streaming, and scroll position survives toggling. That is
 * the point: the inbox doubles as an always-on notification monitor.
 */
export function InboxSidebar() {
  const { inboxOpen, closeInbox, lastOpenedAt } = useInboxSidebar()
  const { isMobile } = useSidebar()

  if (isMobile) return null

  return (
    <div
      id="inbox-sidebar-panel"
      inert={!inboxOpen}
      aria-hidden={!inboxOpen}
      className={cn(
        "sticky top-0 hidden h-svh shrink-0 overflow-hidden bg-background transition-[width] duration-200 ease-linear md:block",
        inboxOpen ? "w-(--inbox-sidebar-width) border-r" : "w-0"
      )}
      style={{ "--inbox-sidebar-width": INBOX_SIDEBAR_WIDTH } as React.CSSProperties}
    >
      {/* Fixed inner width: content must not reflow while the width animates */}
      <div className="flex h-full w-(--inbox-sidebar-width) flex-col">
        {/* Suspense: InboxPanel reads useSearchParams for the active-row highlight */}
        <Suspense fallback={null}>
          <InboxPanel variant="sidebar" onClose={closeInbox} now={lastOpenedAt} />
        </Suspense>
      </div>
    </div>
  )
}

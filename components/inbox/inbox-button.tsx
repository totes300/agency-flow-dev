"use client"

import { useState } from "react"
import { useQuery, useConvexAuth } from "convex/react"
import { InboxIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { SidebarCountBadge } from "@/components/sidebar-count-badge"
import { InboxPanel } from "@/components/inbox/inbox-panel"
import { useInboxSidebar } from "@/components/inbox/inbox-sidebar-context"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"
import { cn } from "@/lib/utils"

/** Right-aligned red unread badge — the shared sidebar count treatment. */
function InboxBadge() {
  const { isAuthenticated } = useConvexAuth()
  const unread = useQuery(
    api.notifications.unreadCount,
    isAuthenticated ? {} : "skip",
  )
  if (!unread || unread.count === 0) return null
  return (
    <SidebarCountBadge
      count={unread.count}
      isCapped={unread.isCapped}
      aria-label={`${unread.isCapped ? "99+" : unread.count} unread notifications`}
    />
  )
}

// Persistent subtle fill marks the Inbox as the sidebar's command center — a
// resting pill, not one more link. Applied only when the panel is closed;
// while open, the button's own active state carries the full accent fill.
const inboxRestingFill = "bg-sidebar-accent/60 hover:bg-sidebar-accent"

/**
 * Sidebar entry point. Desktop: toggles the persistent inbox panel (the nav
 * collapses to its icon rail while the panel is open). Mobile: opens the
 * inbox in a left Sheet.
 */
export function InboxButton() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const isMobile = useIsMobile()
  const { inboxOpen, toggleInbox } = useInboxSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {isMobile ? (
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <SidebarMenuButton
                tooltip="Inbox"
                className={cn("font-medium", inboxRestingFill)}
              >
                <InboxIcon />
                <span>Inbox</span>
                <InboxBadge />
              </SidebarMenuButton>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-[min(100vw-3rem,400px)] flex-col gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <SheetTitle className="sr-only">Inbox</SheetTitle>
              <InboxPanel variant="sheet" onClose={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>
        ) : (
          <SidebarMenuButton
            tooltip="Inbox"
            isActive={inboxOpen}
            aria-expanded={inboxOpen}
            aria-controls="inbox-sidebar-panel"
            onClick={toggleInbox}
            className={cn("font-medium", !inboxOpen && inboxRestingFill)}
          >
            <InboxIcon />
            <span>Inbox</span>
            <InboxBadge />
          </SidebarMenuButton>
        )}
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

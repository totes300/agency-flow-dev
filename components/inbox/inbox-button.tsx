"use client"

import { useState } from "react"
import { useQuery, useConvexAuth } from "convex/react"
import { InboxIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import {
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { InboxPanel } from "@/components/inbox/inbox-panel"
import { useIsMobile } from "@/lib/hooks/use-is-mobile"

function InboxBadge() {
  const { isAuthenticated } = useConvexAuth()
  const unread = useQuery(
    api.notifications.unreadCount,
    isAuthenticated ? {} : "skip",
  )
  if (!unread || unread.count === 0) return null
  return (
    <SidebarMenuBadge>
      {unread.isCapped ? "99+" : unread.count}
    </SidebarMenuBadge>
  )
}

export function InboxButton() {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()

  const trigger = (
    <SidebarMenuButton tooltip="Inbox">
      <InboxIcon />
      <span>Inbox</span>
    </SidebarMenuButton>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {isMobile ? (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>{trigger}</SheetTrigger>
            <SheetContent
              side="left"
              className="flex w-[min(100vw-3rem,400px)] flex-col gap-0 overflow-hidden p-0"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <SheetTitle className="sr-only">Inbox</SheetTitle>
              <InboxPanel onClose={() => setOpen(false)} />
            </SheetContent>
          </Sheet>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              sideOffset={12}
              collisionPadding={16}
              className="flex h-[min(calc(100vh-2rem),44rem)] w-[400px] flex-col overflow-hidden p-0"
              // Don't auto-focus the first header button on open — the
              // focused Tooltip would pop instantly under the header.
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <InboxPanel onClose={() => setOpen(false)} />
            </PopoverContent>
          </Popover>
        )}
        <InboxBadge />
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

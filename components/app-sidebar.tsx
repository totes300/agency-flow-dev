"use client"

import * as React from "react"
import { Suspense } from "react"
import { useOrganization } from "@clerk/nextjs"

import { InboxButton } from "@/components/inbox/inbox-button"
import { NavMain } from "@/components/nav-main"
import { NavSavedViews } from "@/components/nav-saved-views"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { SidebarTimer } from "@/components/timer/sidebar-timer"
import { navigation } from "@/lib/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher />
        <InboxButton />
        <SidebarTimer />
        <SidebarSeparator className="mt-1" />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navigation} isAdmin={isAdmin} />
        {/* useSearchParams (active view) needs a Suspense boundary. */}
        <Suspense fallback={null}>
          <NavSavedViews />
        </Suspense>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

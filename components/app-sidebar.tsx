"use client"

import * as React from "react"
import { useOrganization } from "@clerk/nextjs"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
import { navigation } from "@/lib/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar"
import { BookmarkIcon } from "lucide-react"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { membership } = useOrganization()
  const isAdmin = membership?.role === "org:admin"

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={navigation} isAdmin={isAdmin} />
        {/* Saved Views placeholder — becomes functional in Phase 5 */}
        <SidebarGroup>
          <SidebarGroupLabel>
            <BookmarkIcon className="mr-1 size-3" />
            Saved Views
          </SidebarGroupLabel>
          <SidebarMenu>
            <p className="px-3 py-1.5 text-xs text-muted-foreground">
              No saved views yet
            </p>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

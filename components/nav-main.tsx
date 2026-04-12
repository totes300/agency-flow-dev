"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { NavGroup } from "@/lib/navigation"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

function MyTasksBadge() {
  const { isAuthenticated } = useConvexAuth()
  const count = useQuery(
    api.myTasks.myTasksCount,
    isAuthenticated ? {} : "skip",
  )
  if (!count) return null
  return <SidebarMenuBadge>{count}</SidebarMenuBadge>
}

export function NavMain({
  groups,
  isAdmin,
}: {
  groups: NavGroup[]
  isAdmin: boolean
}) {
  const pathname = usePathname()

  return (
    <>
      {groups.map((group) => {
        const visibleItems = group.items.filter(
          (item) => !item.adminOnly || isAdmin
        )
        if (visibleItems.length === 0) return null

        return (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url || pathname.startsWith(item.url + "/")}
                    tooltip={item.title}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.url === "/my-tasks" && <MyTasksBadge />}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )
      })}
    </>
  )
}

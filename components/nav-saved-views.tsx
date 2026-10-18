"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useConvexAuth, useQueries, type RequestForQueries } from "convex/react"
import { useMemo } from "react"
import { api } from "@/convex/_generated/api"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { ViewsIcon } from "@/components/icons/nav-icons"

type SavedViews = (typeof api.tasks.views.list)["_returnType"]

/**
 * Sidebar "Saved views" (prototype v4 Favorites): the caller's workspace and
 * personal task views, each a link to `/tasks?view=<id>`. Renders nothing
 * until there is at least one view (or when views cannot be loaded).
 */
export function NavSavedViews() {
  const { isAuthenticated } = useConvexAuth()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queries = useMemo(
    (): RequestForQueries =>
      isAuthenticated ? { views: { query: api.tasks.views.list, args: { surface: "tasks" } } } : {},
    [isAuthenticated],
  )
  const result = useQueries(queries).views as SavedViews | Error | undefined
  if (!result || result instanceof Error || result.views.length === 0) return null

  const activeView = pathname === "/tasks" ? searchParams.get("view") : null
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Saved views</SidebarGroupLabel>
      <SidebarMenu>
        {result.views.map((view) => (
          <SidebarMenuItem key={view._id}>
            <SidebarMenuButton asChild isActive={activeView === view._id} tooltip={view.name}>
              <Link href={`/tasks?view=${view._id}`}>
                <ViewsIcon />
                <span>{view.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

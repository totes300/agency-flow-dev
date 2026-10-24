"use client"

import { useState } from "react"
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SidebarCountBadge } from "@/components/sidebar-count-badge"
import { formatDateToYMD } from "@/lib/format"
import { useOptionalQuery } from "@/lib/hooks/use-optional-query"
import { navBadge } from "@/convex/lib/billing/periodState"

/**
 * My Tasks: the caller's open tasks planned for today (§5.4 — today's
 * `planSegments` for the user, a small range), on the shared sidebar badge.
 */
function MyTasksBadge() {
  const { isAuthenticated } = useConvexAuth()
  const [today] = useState(() => formatDateToYMD(new Date()))
  // A failure (e.g. a deployment without tasks/today) hides the badge, never the sidebar.
  const { data: count } = useOptionalQuery(api.tasks.today.badgeCount, isAuthenticated ? { today } : "skip")
  if (!count) return null
  return <SidebarCountBadge count={count} aria-label={`${count} ${count === 1 ? "task" : "tasks"} planned for today`} />
}

/**
 * Billing row badge (docs/prd-project-billing-redesign.md §5.5): the shared
 * red count of periods that need action; when none do, the past-due invoice
 * count. The tooltip always names both. Clean state renders nothing.
 *
 * `pointer-events-auto` re-enables hover (the base badge is pointer-events-none)
 * so the Tooltip trigger fires.
 */
function BillingNavSignals() {
  const { isAuthenticated } = useConvexAuth()
  const signals = useQuery(
    api.billingViews.getNavSignals,
    isAuthenticated ? {} : "skip",
  )
  if (!signals) return null
  const { count, tooltip } = navBadge(signals)
  if (count === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarCountBadge
          count={count}
          aria-label={tooltip}
          className="pointer-events-auto"
        />
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  )
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
                      {item.url === "/my-tasks" && <MyTasksBadge />}
                      {item.url === "/billing" && <BillingNavSignals />}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )
      })}
    </>
  )
}

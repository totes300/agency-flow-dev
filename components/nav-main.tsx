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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SidebarCountBadge } from "@/components/sidebar-count-badge"

function MyTasksBadge() {
  const { isAuthenticated } = useConvexAuth()
  const count = useQuery(
    api.myTasks.myTasksCount,
    isAuthenticated ? {} : "skip",
  )
  if (!count) return null
  return <SidebarCountBadge count={count} aria-label={`${count} tasks assigned to you`} />
}

/**
 * Sidebar signal block on the `Invoices` row — the shared red count badge,
 * with a hover tooltip that breaks the number down (ready to bill / to close /
 * overdue). The badge itself stays visually identical to every other sidebar
 * count; the tooltip carries the detail that used to need a separate icon.
 *
 * Render rules (PRD US 1–4):
 *   - `inboxCount === 0 && overdueCount === 0` → render nothing (clean state is
 *     silent — the absence is the signal).
 *   - otherwise → red count badge; number is the billing-inbox total, falling
 *     back to the overdue count when there's nothing new to bill.
 *   - Hover (mouse or focus) → tooltip with the count breakdown.
 *
 * `pointer-events-auto` re-enables hover (the base badge is pointer-events-none)
 * so the Tooltip trigger fires.
 */
function InvoicesNavSignals() {
  const { isAuthenticated } = useConvexAuth()
  const signals = useQuery(
    api.invoices.getInvoicingNavSignals,
    isAuthenticated ? {} : "skip",
  )
  if (!signals) return null
  const { toGenerateCount, toCloseCount = 0, overdueCount } = signals
  // Billing inbox total: invoices to generate + within-budget months to
  // close & report. Both are month-end actions the admin must clear.
  const inboxCount = toGenerateCount + toCloseCount
  if (inboxCount === 0 && overdueCount === 0) return null

  const tooltipParts: string[] = []
  if (toGenerateCount > 0) tooltipParts.push(`${toGenerateCount} ready to bill`)
  if (toCloseCount > 0) tooltipParts.push(`${toCloseCount} to close & report`)
  if (overdueCount > 0) tooltipParts.push(`${overdueCount} overdue`)
  const tooltip = tooltipParts.join(" · ")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <SidebarCountBadge
          count={inboxCount > 0 ? inboxCount : overdueCount}
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
                      {item.url === "/invoices" && <InvoicesNavSignals />}
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

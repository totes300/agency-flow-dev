"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { CalendarClockIcon } from "lucide-react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

function MyTasksBadge() {
  const { isAuthenticated } = useConvexAuth()
  const count = useQuery(
    api.myTasks.myTasksCount,
    isAuthenticated ? {} : "skip",
  )
  if (!count) return null
  return <SidebarMenuBadge>{count}</SidebarMenuBadge>
}

/**
 * Sidebar signal block on the `Invoices` row — count badge + calendar-clock
 * icon for overdue, with a hover tooltip explaining both.
 *
 * Render rules (PRD US 1–4):
 *   - `toGenerateCount === 0 && overdueCount === 0` → render nothing (clean
 *     state is silent — the absence is the signal).
 *   - `toGenerateCount > 0` → numeric badge (right-aligned, primary tint).
 *   - `overdueCount > 0` → calendar-clock icon next to the badge, red tint.
 *   - Hover (mouse or focus) → tooltip with the count breakdown.
 *
 * Composition: `SidebarMenuBadge` owns position + collapsed-state hiding;
 * `pointer-events-auto` re-enables hover so the Tooltip trigger fires.
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
        <SidebarMenuBadge
          aria-label={tooltip}
          className={cn(
            "pointer-events-auto gap-1",
            overdueCount > 0 && "text-red-700 dark:text-red-300",
          )}
        >
          {overdueCount > 0 && (
            <CalendarClockIcon className="size-3.5" aria-hidden />
          )}
          {inboxCount > 0 && <span>{inboxCount}</span>}
        </SidebarMenuBadge>
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
                    </Link>
                  </SidebarMenuButton>
                  {item.url === "/my-tasks" && <MyTasksBadge />}
                  {item.url === "/invoices" && <InvoicesNavSignals />}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )
      })}
    </>
  )
}

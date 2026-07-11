"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BotIcon, PanelsTopLeftIcon } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Returning from the workspace should land where the user left the app, not
// always on /dashboard. sessionStorage (not URL/state) because the switch is
// layout chrome living in two independent shells.
const LAST_APP_PATH_KEY = "workspace-switch:last-app-path"

function Segment({
  href,
  label,
  active,
  onClick,
  children,
}: {
  href: string
  label: string
  active: boolean
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={active ? "page" : undefined}
          onClick={onClick}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded-md transition-colors",
            active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Workspace switch — compact two-icon segmented toggle between the app UI
 * and the Agents workspace. Layout chrome rendered at the top of BOTH
 * shells (app sidebar + workspace rail), never inside modals/drawers, and
 * deliberately not part of lib/navigation.ts.
 *
 * The group-data-[collapsible=icon] classes only match inside the app
 * sidebar's icon rail (stacks the segments vertically); in the workspace
 * rail no such ancestor exists, so the switch stays horizontal.
 */
export function WorkspaceSwitch() {
  const pathname = usePathname()
  const router = useRouter()
  const inAgents = pathname.startsWith("/agents")

  return (
    <div
      role="group"
      aria-label="Workspace"
      className="flex gap-0.5 rounded-lg bg-sidebar-accent/60 p-0.5 group-data-[collapsible=icon]:flex-col"
    >
      <Segment
        href="/dashboard"
        label="App"
        active={!inAgents}
        onClick={(e) => {
          if (!inAgents) return
          // Resume where the user left the app (recorded on the way out).
          e.preventDefault()
          router.push(sessionStorage.getItem(LAST_APP_PATH_KEY) ?? "/dashboard")
        }}
      >
        <PanelsTopLeftIcon className="size-4" />
      </Segment>
      <Segment
        href="/agents"
        label="Agents"
        active={inAgents}
        onClick={() => {
          if (!inAgents) sessionStorage.setItem(LAST_APP_PATH_KEY, pathname)
        }}
      >
        <BotIcon className="size-4" />
      </Segment>
    </div>
  )
}

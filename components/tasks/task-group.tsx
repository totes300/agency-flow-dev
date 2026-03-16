"use client"

import { useState, useEffect } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { getStatusColor } from "@/lib/status-colors"
import { getCategoryColor } from "@/convex/lib/constants"

const STORAGE_PREFIX = "task-group-collapse:"

function getCollapseKey(orgId: string, groupBy: string, groupKey: string): string {
  return `${STORAGE_PREFIX}${orgId}:${groupBy}:${groupKey}`
}

export function TaskGroup({
  groupKey,
  label,
  color,
  count,
  groupBy,
  orgId,
  children,
}: {
  groupKey: string
  label: string
  color?: string
  count: number
  groupBy: string
  orgId: string
  children: React.ReactNode
}) {
  const storageKey = getCollapseKey(orgId, groupBy, groupKey)

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem(storageKey) === "1"
  })

  useEffect(() => {
    if (collapsed) {
      localStorage.setItem(storageKey, "1")
    } else {
      localStorage.removeItem(storageKey)
    }
  }, [collapsed, storageKey])

  const contentId = `group-content-${groupKey}`

  return (
    <div>
      {/* Group header — Linear-style subtle divider */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls={contentId}
        className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/30"
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {color && (
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: resolveGroupColor(color) }}
          />
        )}
        <span
          className={cn("text-sm font-semibold", !color && "text-muted-foreground")}
        >
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          {count} {count === 1 ? "task" : "tasks"}
        </span>
      </button>

      {/* Group content */}
      {!collapsed && <div id={contentId}>{children}</div>}
    </div>
  )
}

/** Resolve a group color string to a CSS color value.
 *  Status groups use status color names, category groups use category color names. */
function resolveGroupColor(color: string): string {
  // Try status color first (returns dot color)
  const statusCfg = getStatusColor(color)
  if (statusCfg.dot !== "#9ca3af") return statusCfg.dot // not the default gray fallback

  // Try category color
  const catCfg = getCategoryColor(color)
  if (catCfg.text !== "#373530") return catCfg.text // not the default fallback

  return color // pass through if it's already a CSS color
}

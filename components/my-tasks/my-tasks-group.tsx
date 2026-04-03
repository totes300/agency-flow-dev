"use client"

import { useState } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { StatusIcon } from "@/components/status-icon"
import { cn } from "@/lib/utils"
import type { StatusType } from "@/convex/lib/constants"

const STATUS_TYPE_ICON: Record<string, StatusType> = {
  today: "backlog",
  backlog: "backlog",
  in_progress: "in_progress",
  blocked: "blocked",
  completed_today: "done",
  done: "done",
}

const STATUS_TYPE_COLOR: Record<string, string> = {
  today: "blue",
  backlog: "gray",
  in_progress: "amber",
  blocked: "red",
  completed_today: "green",
  done: "green",
}

export function MyTasksGroup({
  groupKey,
  label,
  count,
  children,
  defaultOpen = true,
}: {
  groupKey: string
  label: string
  count: number
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const statusType = STATUS_TYPE_ICON[groupKey] ?? "backlog"
  const color = STATUS_TYPE_COLOR[groupKey] ?? "gray"

  return (
    <div className="mt-6">
      {/* Group header with bottom border */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-sm font-medium hover:bg-muted/30"
      >
        <StatusIcon type={statusType} color={color} size={14} />
        <span>{label}</span>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        <span className="ml-auto">
          {open ? (
            <ChevronDownIcon className="size-3.5 text-muted-foreground/50" />
          ) : (
            <ChevronRightIcon className="size-3.5 text-muted-foreground/50" />
          )}
        </span>
      </button>

      {open && <div>{children}</div>}
    </div>
  )
}

export function HiddenTasksFooter({
  count,
  onShowSettings,
}: {
  count: number
  onShowSettings?: () => void
}) {
  if (count <= 0) return null

  return (
    <div className="mt-8 text-center text-xs text-muted-foreground/60">
      {count} {count === 1 ? "task" : "tasks"} hidden by settings.{" "}
      {onShowSettings && (
        <button
          type="button"
          onClick={onShowSettings}
          className={cn(
            "underline underline-offset-2 hover:text-muted-foreground",
          )}
        >
          Show settings
        </button>
      )}
    </div>
  )
}

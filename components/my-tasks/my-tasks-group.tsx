"use client"

import { useState } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { StatusIcon } from "@/components/status-icon"
import type { StatusType } from "@/convex/lib/constants"

export function MyTasksGroup({
  groupKey,
  label,
  count,
  statusType,
  statusColor,
  children,
  defaultOpen = true,
}: {
  groupKey: string
  label: string
  count: number
  statusType: StatusType
  statusColor: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mt-6">
      {/* Group header with bottom border */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-sm font-medium hover:bg-muted/30"
      >
        <StatusIcon type={statusType} color={statusColor} size={16} />
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

      {open && <ul className="list-none lg:-ml-6">{children}</ul>}
    </div>
  )
}


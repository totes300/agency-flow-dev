"use client"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { StatusIcon } from "@/components/icons/status-icon"
import {
  ArchiveNavIcon,
  CloseNavIcon,
  LabelNavIcon,
  UserNavIcon,
} from "@/components/icons/nav-icons"
import type { PropertyMenuKind } from "@/components/task-view/property-menus"

/**
 * Floating selection bar (U10), bottom centre while rows are selected:
 * count, clear (Esc), Status / Priority / Assignee / Labels menus and Archive.
 * "Add to today" joins with the sun semantics in slice 5.
 */
export function SelectionBar({
  count,
  onClear,
  onOpenMenu,
  onArchive,
}: {
  count: number
  onClear: () => void
  onOpenMenu: (kind: PropertyMenuKind, anchor: HTMLElement) => void
  onArchive: () => void
}) {
  if (count === 0) return null

  const menuButton = (kind: PropertyMenuKind, icon: React.ReactNode, label: string) => (
    <Button variant="ghost" size="sm" onClick={(e) => onOpenMenu(kind, e.currentTarget)}>
      {icon}
      {label}
    </Button>
  )

  return (
    <div
      role="toolbar"
      aria-label="Selected tasks"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-xl bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <span className="px-2 text-sm font-medium tabular-nums whitespace-nowrap">{count} selected</span>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}>
        <CloseNavIcon />
      </Button>
      <Separator orientation="vertical" className="mx-1 data-vertical:h-5 data-vertical:self-auto" />
      {menuButton("status", <StatusIcon icon={{ kind: "pie", fill: 0.5 }} color="gray" className="size-3.5" />, "Status")}
      {menuButton("priority", <PriorityIcon priority={3} label={false} />, "Priority")}
      {menuButton("assignee", <UserNavIcon data-icon="inline-start" />, "Assignee")}
      {menuButton("labels", <LabelNavIcon data-icon="inline-start" />, "Labels")}
      <Separator orientation="vertical" className="mx-1 data-vertical:h-5 data-vertical:self-auto" />
      <Button variant="ghost" size="sm" onClick={onArchive}>
        <ArchiveNavIcon data-icon="inline-start" />
        Archive
      </Button>
    </div>
  )
}

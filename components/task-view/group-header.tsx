"use client"

import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { StatusIcon } from "@/components/icons/status-icon"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { ChevronDownNavIcon, ChevronRightNavIcon, NoAssigneeNavIcon, PlusNavIcon } from "@/components/icons/nav-icons"
import { getCategoryColor } from "@/convex/lib/constants"
import { getStatusColor } from "@/lib/status-colors"
import type { GroupHeader as GroupHeaderData, TaskGroup } from "@/components/task-view/row-model"

/** The icon a group shows in its header (status, priority, avatar, colour dot). */
export function GroupIcon({ header }: { header: GroupHeaderData }) {
  switch (header.kind) {
    case "status":
      return <StatusIcon icon={header.status.icon} color={header.status.color} />
    case "priority":
      return <PriorityIcon priority={header.priority} label={false} />
    case "assignee":
      return header.member ? (
        <UserAvatar name={header.member.name} imageUrl={header.member.imageUrl} size="sm" className="size-[18px]" />
      ) : (
        <NoAssigneeNavIcon className="text-muted-foreground" />
      )
    case "workCategory":
      return header.category ? (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getCategoryColor(header.category.color).dot }} />
      ) : null
    case "label":
      return header.label ? (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(header.label.color).dot }} />
      ) : null
    default:
      return null
  }
}

/**
 * Group header row (prototype v4): collapse chevron, the group's icon and
 * name, the row count as plain muted text, and "+" to create a task in the
 * group when the group's value can be prefilled. Sticks under the column
 * header while its rows scroll.
 */
export function GroupHeader({
  group,
  collapsed,
  onToggle,
  onCreate,
}: {
  group: TaskGroup
  collapsed: boolean
  onToggle: () => void
  onCreate?: () => void
}) {
  return (
    <div
      role="row"
      className="sticky top-9 z-[2] flex h-9 items-center gap-2 border-b border-border/60 bg-muted pr-3 pl-3 text-[13px] font-medium"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand ${group.label}` : `Collapse ${group.label}`}
        onClick={onToggle}
      >
        {collapsed ? <ChevronRightNavIcon strokeWidth={1.8} /> : <ChevronDownNavIcon strokeWidth={1.8} />}
      </Button>
      <GroupIcon header={group.header} />
      <span className="min-w-0 truncate">{group.label}</span>
      <span className="font-normal text-muted-foreground tabular-nums">{group.rows.length}</span>
      <span className="flex-1" />
      {onCreate ? (
        <Button variant="ghost" size="icon-xs" aria-label={`New task in ${group.label}`} onClick={onCreate}>
          <PlusNavIcon />
        </Button>
      ) : null}
    </div>
  )
}

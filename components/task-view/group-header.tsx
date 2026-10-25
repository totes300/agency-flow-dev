"use client"

import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/user-avatar"
import { StatusIcon } from "@/components/icons/status-icon"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { ChevronDownNavIcon, ChevronRightNavIcon, NoAssigneeNavIcon, PlusNavIcon, SunNavIcon } from "@/components/icons/nav-icons"
import { getCategoryColor } from "@/convex/lib/constants"
import { getStatusColor } from "@/lib/status-colors"
import type { GroupHeader as GroupHeaderData, TaskGroup } from "@/components/task-view/row-model"

/** The icon a group shows in its header (status, priority, avatar, colour dot, the sun). */
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
    case "today":
      return <SunNavIcon size={14} strokeWidth={1.8} className="text-warning" />
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
  total,
}: {
  group: TaskGroup
  collapsed: boolean
  onToggle: () => void
  onCreate?: () => void
  /** Right-aligned group total (the project Work list's time in period). */
  total?: string
}) {
  return (
    <GroupHeaderRow
      label={group.label}
      count={group.rows.length}
      icon={<GroupIcon header={group.header} />}
      collapsed={collapsed}
      onToggle={onToggle}
    >
      {total ? <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">{total}</span> : null}
      {onCreate ? (
        <Button variant="ghost" size="icon-xs" aria-label={`New task in ${group.label}`} onClick={onCreate}>
          <PlusNavIcon />
        </Button>
      ) : null}
    </GroupHeaderRow>
  )
}

/**
 * The group header row itself: chevron (when collapsible), icon, name, the
 * count as plain muted text, an optional muted note, then right-aligned
 * actions. Shared by the grouped table and My Tasks Today's sections.
 */
export function GroupHeaderRow({
  label,
  count,
  icon,
  note,
  collapsed = false,
  onToggle,
  children,
}: {
  label: string
  count: number
  icon?: React.ReactNode
  note?: string
  collapsed?: boolean
  /** Absent = not collapsible; the icon then takes the chevron's slot so labels stay aligned. */
  onToggle?: () => void
  children?: React.ReactNode
}) {
  return (
    <div
      role="row"
      className="sticky top-9 z-[2] flex h-9 items-center gap-2 border-b border-border/60 bg-muted pr-3 pl-3 text-[13px] font-medium"
    >
      {onToggle ? (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRightNavIcon strokeWidth={1.8} /> : <ChevronDownNavIcon strokeWidth={1.8} />}
        </Button>
      ) : null}
      {onToggle ? icon : <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>}
      <span className="min-w-0 truncate">{label}</span>
      <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
      {note ? <span className="hidden truncate font-normal text-muted-foreground sm:inline">· {note}</span> : null}
      <span className="flex-1" />
      {children}
    </div>
  )
}

"use client"

import { useMemo, useState, type ReactNode } from "react"
import { CheckIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import { PRIORITY_LABELS, type TaskPriority } from "@/convex/tasks/model"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { UserAvatar } from "@/components/user-avatar"
import { StatusIcon } from "@/components/icons/status-icon"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { NoAssigneeNavIcon } from "@/components/icons/nav-icons"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import type { RefIndex, TaskRowDTO } from "@/components/task-view/row-model"
import type { TaskActions } from "@/components/task-view/use-task-actions"

/**
 * Linear-style property menus (U10): one popover, anchored to whatever opened
 * it (a row cell, the focused row for S/P/A/L, or a selection-bar button).
 * Search at the top with the shortcut key as a hint; every option carries a
 * number — with an empty search, pressing it picks the option. Status and
 * priority close on pick; assignees and labels are multi-value and stay open.
 */

export type PropertyMenuKind = "status" | "priority" | "assignee" | "labels"

export type PropertyMenuRequest = {
  kind: PropertyMenuKind
  taskIds: Id<"tasks">[]
  anchor: HTMLElement
}

export const PROPERTY_MENU_KEYS: Record<PropertyMenuKind, string> = {
  status: "S",
  priority: "P",
  assignee: "A",
  labels: "L",
}

const PLACEHOLDER: Record<PropertyMenuKind, string> = {
  status: "Change status…",
  priority: "Change priority…",
  assignee: "Assign to…",
  labels: "Add labels…",
}

const STAYS_OPEN: Record<PropertyMenuKind, boolean> = {
  status: false,
  priority: false,
  assignee: true,
  labels: true,
}

type MenuOption = {
  id: string
  label: string
  icon: ReactNode
  /** Digit that picks the option with an empty search (0–9), if any. */
  shortcut: string | null
  checked: boolean
  pick: () => void
}

function digit(n: number): string | null {
  return n >= 0 && n <= 9 ? String(n) : null
}

function buildOptions(
  kind: PropertyMenuKind,
  tasks: readonly TaskRowDTO[],
  index: RefIndex,
  actions: TaskActions,
): MenuOption[] {
  const all = (test: (t: TaskRowDTO) => boolean) => tasks.length > 0 && tasks.every(test)

  switch (kind) {
    case "status":
      return index.refs.statuses
        .filter((s) => !s.archived)
        .map((s, i) => ({
          id: s._id,
          label: s.name,
          icon: <StatusIcon icon={s.icon} color={s.color} />,
          shortcut: digit(i + 1),
          checked: all((t) => t.statusId === s._id),
          pick: () => void actions.setStatus(tasks, s._id),
        }))

    case "priority":
      return ([0, 1, 2, 3, 4] as TaskPriority[]).map((p) => ({
        id: String(p),
        label: PRIORITY_LABELS[p],
        icon: <PriorityIcon priority={p} label={false} />,
        shortcut: digit(p),
        checked: all((t) => t.priority === p),
        pick: () => void actions.setPriority(tasks, p),
      }))

    case "assignee": {
      const me = index.refs.me
      const members = [...index.refs.members].sort(
        (a, b) => Number(b._id === me) - Number(a._id === me) || a.name.localeCompare(b.name),
      )
      return [
        {
          id: "none",
          label: "No assignee",
          icon: <NoAssigneeNavIcon className="text-muted-foreground" />,
          shortcut: "0",
          checked: all((t) => t.assigneeIds.length === 0),
          pick: () => void actions.toggleAssignee(tasks, null),
        },
        ...members.map((m, i) => ({
          id: m._id,
          label: m._id === me ? `${m.name} (you)` : m.name,
          icon: <UserAvatar name={m.name} imageUrl={m.imageUrl} size="sm" className="size-5" />,
          shortcut: digit(i + 1),
          checked: all((t) => t.assigneeIds.includes(m._id)),
          pick: () => void actions.toggleAssignee(tasks, m._id),
        })),
      ]
    }

    case "labels":
      return index.refs.labels
        .filter((l) => !l.archived)
        .map((l, i) => ({
          id: l._id,
          label: l.name,
          icon: <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(l.color).dot }} />,
          shortcut: digit(i + 1),
          checked: all((t) => t.labelIds.includes(l._id)),
          pick: () => void actions.toggleLabel(tasks, l._id),
        }))
  }
}

export function PropertyMenu({
  request,
  tasks,
  index,
  actions,
  onClose,
}: {
  request: PropertyMenuRequest | null
  /** The rows `request.taskIds` points at (current values drive the checkmarks). */
  tasks: readonly TaskRowDTO[]
  index: RefIndex
  actions: TaskActions
  onClose: () => void
}) {
  // A virtual anchor follows the opener; if a pick re-renders it away (the row
  // moves to another group), the menu stays where it opened instead of jumping.
  const virtualAnchor = useMemo(() => {
    const anchor = request?.anchor
    const opened = anchor?.getBoundingClientRect() ?? new DOMRect()
    return {
      current: {
        getBoundingClientRect: () => (anchor?.isConnected ? anchor.getBoundingClientRect() : opened),
      },
    }
  }, [request])

  return (
    <Popover open={request !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={virtualAnchor} />
      {request ? (
        <PopoverContent
          align="start"
          className="w-64 gap-0 p-0"
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // The opener toggles the menu itself.
            if (e.target instanceof Node && request.anchor.contains(e.target)) e.preventDefault()
          }}
        >
          <PropertyMenuBody
            key={`${request.kind}:${request.taskIds.join(",")}`}
            kind={request.kind}
            options={buildOptions(request.kind, tasks, index, actions)}
            onClose={onClose}
          />
        </PopoverContent>
      ) : null}
    </Popover>
  )
}

function PropertyMenuBody({
  kind,
  options,
  onClose,
}: {
  kind: PropertyMenuKind
  options: MenuOption[]
  onClose: () => void
}) {
  const [search, setSearch] = useState("")

  function choose(option: MenuOption) {
    option.pick()
    if (!STAYS_OPEN[kind]) onClose()
  }

  return (
    <Command>
      <div className="flex items-center gap-1 pr-2">
        <div className="min-w-0 flex-1">
          <CommandInput
            placeholder={PLACEHOLDER[kind]}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (search !== "" || !/^[0-9]$/.test(e.key)) return
              const option = options.find((o) => o.shortcut === e.key)
              if (!option) return
              e.preventDefault()
              choose(option)
            }}
          />
        </div>
        <Kbd className="mt-1">{PROPERTY_MENU_KEYS[kind]}</Kbd>
      </div>
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.id}
              value={`${option.label} ${option.id}`}
              keywords={[option.label]}
              onSelect={() => choose(option)}
            >
              {option.icon}
              <span className="min-w-0 truncate">{option.label}</span>
              <CommandShortcut className="flex items-center gap-2 tracking-normal tabular-nums">
                <CheckIcon className={cn(!option.checked && "invisible")} />
                {option.shortcut ? <span className="w-2 text-right">{option.shortcut}</span> : null}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

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
import { DueDatePanel } from "@/components/tasks/inline-due-date-cell"
import { getCategoryColor } from "@/convex/lib/constants"
import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"
import type { RefIndex, TaskRowDTO } from "@/components/task-view/row-model"
import type { TaskActions } from "@/components/task-view/use-task-actions"

/**
 * Linear-style property menus (U10): one popover, anchored to whatever opened
 * it (a row cell, the focused row for S/P/A/L, or a selection-bar button).
 * Search at the top with the shortcut key as a hint; every option carries a
 * number — with an empty search, pressing it picks the option. Status,
 * priority, work category and project close on pick; assignees and labels are
 * multi-value and stay open. The due date opens the existing date panel
 * (presets + calendar) in the same popover. Category, project and due date
 * have no list shortcut (U10); they open from their row cells (slice 4b).
 */

export type PropertyMenuKind = "status" | "priority" | "assignee" | "labels" | "category" | "project" | "due"

export type PropertyMenuRequest = {
  kind: PropertyMenuKind
  taskIds: Id<"tasks">[]
  anchor: HTMLElement
}

export const PROPERTY_MENU_KEYS: Partial<Record<PropertyMenuKind, string>> = {
  status: "S",
  priority: "P",
  assignee: "A",
  labels: "L",
}

type OptionMenuKind = Exclude<PropertyMenuKind, "due">

const PLACEHOLDER: Record<OptionMenuKind, string> = {
  status: "Change status…",
  priority: "Change priority…",
  assignee: "Assign to…",
  labels: "Add labels…",
  category: "Change category…",
  project: "Move to project…",
}

const STAYS_OPEN: Record<OptionMenuKind, boolean> = {
  status: false,
  priority: false,
  assignee: true,
  labels: true,
  category: false,
  project: false,
}

type MenuOption = {
  id: string
  label: string
  icon: ReactNode
  /** Digit that picks the option with an empty search (0–9), if any. */
  shortcut: string | null
  checked: boolean
  pick: () => void
  /** Group heading (projects are listed under their client). */
  group?: string
}

function digit(n: number): string | null {
  return n >= 0 && n <= 9 ? String(n) : null
}

function buildOptions(
  kind: OptionMenuKind,
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

    case "category":
      return [
        {
          id: "none",
          label: "No category",
          icon: <span className="size-2 shrink-0 rounded-full border border-muted-foreground/50" />,
          shortcut: "0",
          checked: all((t) => !t.workCategoryId),
          pick: () => void actions.setWorkCategory(tasks, null),
        },
        ...index.refs.workCategories
          .filter((c) => !c.archived)
          .map((c, i) => ({
            id: c._id,
            label: c.name,
            icon: <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getCategoryColor(c.color).dot }} />,
            shortcut: digit(i + 1),
            checked: all((t) => t.workCategoryId === c._id),
            pick: () => void actions.setWorkCategory(tasks, c._id),
          })),
      ]

    case "project": {
      const clientName = (clientId: Id<"clients">) => index.clientById.get(clientId)?.name ?? ""
      const projects = index.refs.projects
        .filter((p) => !p.archived)
        .sort((a, b) => clientName(a.clientId).localeCompare(clientName(b.clientId)) || a.name.localeCompare(b.name))
      return [
        {
          id: "none",
          label: "No project",
          icon: null,
          shortcut: "0",
          checked: all((t) => !t.projectId),
          pick: () => void actions.setProject(tasks, null),
        },
        ...projects.map((p, i) => ({
          id: p._id,
          label: p.name,
          icon: null,
          shortcut: digit(i + 1),
          checked: all((t) => t.projectId === p._id),
          pick: () => void actions.setProject(tasks, p._id),
          group: clientName(p.clientId) || "No client",
        })),
      ]
    }
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
          align={request.kind === "due" ? "end" : "start"}
          className={cn("gap-0 p-0", request.kind === "due" ? "w-[380px]" : "w-64")}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // The opener toggles the menu itself.
            if (e.target instanceof Node && request.anchor.contains(e.target)) e.preventDefault()
          }}
        >
          {request.kind === "due" ? (
            <DueDatePanel
              dueDate={tasks.length > 0 && tasks.every((t) => t.dueDate === tasks[0].dueDate) ? tasks[0].dueDate : null}
              onSelect={(date) => {
                void actions.setDueDate(tasks, date)
                onClose()
              }}
            />
          ) : (
            <PropertyMenuBody
              key={`${request.kind}:${request.taskIds.join(",")}`}
              kind={request.kind}
              options={buildOptions(request.kind, tasks, index, actions)}
              onClose={onClose}
            />
          )}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}

/** Consecutive options with the same `group` share one heading (ungrouped first). */
function groupOptions(options: readonly MenuOption[]): { heading?: string; options: MenuOption[] }[] {
  const groups: { heading?: string; options: MenuOption[] }[] = []
  for (const option of options) {
    const last = groups.at(-1)
    if (last && last.heading === option.group) last.options.push(option)
    else groups.push({ heading: option.group, options: [option] })
  }
  return groups
}

function PropertyMenuBody({
  kind,
  options,
  onClose,
}: {
  kind: OptionMenuKind
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
        {PROPERTY_MENU_KEYS[kind] ? <Kbd className="mt-1">{PROPERTY_MENU_KEYS[kind]}</Kbd> : null}
      </div>
      <CommandList>
        <CommandEmpty>No matches</CommandEmpty>
        {groupOptions(options).map((group) => (
          <CommandGroup key={group.heading ?? ""} heading={group.heading}>
            {group.options.map((option) => (
              <CommandItem
                key={option.id}
                value={`${option.label} ${option.id}`}
                keywords={[option.label, ...(option.group ? [option.group] : [])]}
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
        ))}
      </CommandList>
    </Command>
  )
}

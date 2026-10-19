"use client"

import { useState } from "react"
import type { StatusIcon as StatusIconShape } from "@/convex/tasks/model"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "@/components/ui/command"
import { StatusIcon } from "@/components/icons/status-icon"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { firstName, getClientDisplayName } from "@/lib/format"
import {
  FolderIcon,
  ChevronDownIcon,
  UserIcon,
  TagIcon,
  CheckIcon,
  CalendarIcon,
} from "lucide-react"
import { format } from "date-fns"
import { Calendar } from "@/components/ui/calendar"
import type { Id } from "@/convex/_generated/dataModel"

/**
 * The task-draft property pickers — the app's ONE visual language for
 * editing a not-yet-created task (property pills opening Command popovers).
 * Extracted from `task-form-modal.tsx` when the agent proposal cards became
 * the second surface with the same interaction (repo rule: same interaction
 * = shared component, immediately). Every consumer passes its own option
 * lists; there is no data dependency here.
 */

/** "Client · Project" trigger label, honoring the client's prefix setting. */
export function projectPickerLabel(project: {
  name: string
  clientName?: string
  clientPrefix?: string
  clientUsePrefix?: boolean
}): string {
  if (!project.clientName) return project.name
  const client = getClientDisplayName({
    name: project.clientName,
    prefix: project.clientPrefix,
    usePrefix: project.clientUsePrefix,
  })
  return `${client} · ${project.name}`
}

export function ProjectPicker({
  projects,
  value,
  onChange,
  selectedLabel,
}: {
  projects: Array<{ _id: Id<"projects">; name: string; clientName: string }>
  value: Id<"projects"> | undefined
  onChange: (id: Id<"projects"> | undefined) => void
  selectedLabel?: string
}) {
  const [open, setOpen] = useState(false)

  // Group by client
  const grouped = new Map<string, typeof projects>()
  for (const p of projects) {
    if (!grouped.has(p.clientName)) grouped.set(p.clientName, [])
    grouped.get(p.clientName)!.push(p)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/30">
          <FolderIcon className="size-3 text-muted-foreground" />
          {selectedLabel ?? "Select project..."}
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search project..." />
          <CommandList>
            <CommandEmpty>No projects.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange(undefined); setOpen(false) }}>
                <span className="text-muted-foreground">None</span>
              </CommandItem>
            </CommandGroup>
            {[...grouped.entries()].map(([client, clientProjects]) => (
              <CommandGroup key={client} heading={client}>
                {clientProjects.map((p) => (
                  <CommandItem key={p._id} onSelect={() => { onChange(p._id); setOpen(false) }}>
                    {p.name}
                    {value === p._id && <CheckIcon className="ml-auto size-3.5" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

type StatusOption = { _id: Id<"statuses">; name: string; color: string; icon: StatusIconShape }

/** Status pill: the status icon (category + position, §4.1) and name. */
export function StatusPicker({
  statuses,
  value,
  onChange,
  selected,
  placeholder,
}: {
  statuses: StatusOption[]
  value: Id<"statuses"> | undefined
  onChange: (id: Id<"statuses">) => void
  selected: StatusOption | undefined
  /** Shown muted while nothing is picked: the status the server will use. */
  placeholder?: StatusOption
}) {
  const [open, setOpen] = useState(false)
  const shown = selected ?? placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/30">
          {shown ? (
            <>
              <StatusIcon icon={shown.icon} color={shown.color} size={12} />
              <span className={selected ? "text-foreground" : "text-muted-foreground"}>{shown.name}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Status</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Change status..." />
          <CommandList>
            <CommandEmpty>No statuses.</CommandEmpty>
            <CommandGroup>
              {statuses.map((s) => (
                <CommandItem key={s._id} value={s.name} onSelect={() => { onChange(s._id); setOpen(false) }} className="px-2 py-1.5">
                  <StatusIcon icon={s.icon} color={s.color} size={14} />
                  <span className="truncate text-xs">{s.name}</span>
                  {value === s._id && <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function AssigneePicker({
  members,
  value,
  onChange,
  selected,
}: {
  members: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
  value: Id<"users">[]
  onChange: (ids: Id<"users">[]) => void
  selected: Array<{ _id: Id<"users">; name: string; imageUrl?: string }>
}) {
  const [open, setOpen] = useState(false)
  const valueSet = new Set(value.map(String))

  function toggle(id: Id<"users">) {
    if (valueSet.has(id.toString())) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30">
          {selected.length > 0 ? (
            <>
              <UserAvatar name={selected[0].name} imageUrl={selected[0].imageUrl} className="size-4 text-[7px]" />
              <span className="font-medium text-foreground">
                {firstName(selected[0].name)}
                {selected.length > 1 && ` +${selected.length - 1}`}
              </span>
            </>
          ) : (
            <>
              <UserIcon className="size-3" />
              Assignee
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandEmpty>No members.</CommandEmpty>
            <CommandGroup>
              {members.map((m) => (
                <CommandItem key={m._id} onSelect={() => toggle(m._id)}>
                  <UserAvatar name={m.name} imageUrl={m.imageUrl} className="size-5 text-[8px]" />
                  <span className="truncate">{m.name}</span>
                  {valueSet.has(m._id.toString()) && <CheckIcon className="ml-auto size-3.5" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Due-date pill in the same property-pill language (the boxed
 * `ui/date-picker` is for forms; this is the task-draft variant).
 * Clicking the selected day again clears it.
 */
export function DueDatePicker({
  value,
  onChange,
}: {
  value: Date | undefined
  onChange: (date: Date | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30">
          <CalendarIcon className="size-3" />
          {value ? (
            <span className="font-medium text-foreground">
              {format(value, "MMM d")}
            </span>
          ) : (
            "Due date"
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onChange(date)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export function CategoryPicker({
  categories,
  value,
  onChange,
  selected,
}: {
  categories: Array<{ _id: Id<"workCategories">; name: string; color: string }>
  value: Id<"workCategories"> | undefined
  onChange: (id: Id<"workCategories"> | undefined) => void
  selected: { name: string; color: string } | undefined
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/30">
          {selected ? (
            <CategoryBadge name={selected.name} color={selected.color} className="text-[11px]" />
          ) : (
            <>
              <TagIcon className="size-3" />
              Category
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem onSelect={() => { onChange(undefined); setOpen(false) }} className="px-2 py-1.5">
                <span className="text-muted-foreground text-xs">None</span>
              </CommandItem>
              {categories.map((c) => (
                  <CommandItem key={c._id} onSelect={() => { onChange(c._id); setOpen(false) }} className="px-2 py-1.5">
                    <CategoryBadge name={c.name} color={c.color} />
                    {value === c._id && <CheckIcon className="ml-auto size-3.5 text-muted-foreground" />}
                  </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

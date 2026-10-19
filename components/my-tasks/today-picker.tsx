"use client"

import { useEffect, useMemo, useState } from "react"
import { useConvexAuth, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { StatusIcon } from "@/components/icons/status-icon"
import { formatDue } from "@/components/task-view/columns"
import type { RefIndex, TaskRowDTO } from "@/components/task-view/row-model"
import { cn } from "@/lib/utils"
import { plannedOnLabel, pickerGroups } from "@/components/my-tasks/today-model"

const SEARCH_DEBOUNCE_MS = 200
const PICKER_LIMIT = 50

/**
 * "Add tasks to today" (U8, prototype v4): search your tasks, pick several,
 * add them to your own day. Without a search it lists your open assigned
 * tasks (`pickerCandidates`), Suggested first — due soon, started, or carried
 * over — then everything else. With a search it searches titles and keeps
 * the tasks assigned to you. Rows click or Enter to select.
 */
export function TodayPicker({
  open,
  onOpenChange,
  today,
  me,
  index,
  todayIds,
  carried,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  today: string
  me: Id<"users"> | null
  index: RefIndex
  todayIds: ReadonlySet<Id<"tasks">>
  carried: ReadonlyMap<Id<"tasks">, string>
  onAdd: (taskIds: Id<"tasks">[]) => void
}) {
  const { isAuthenticated } = useConvexAuth()
  const [input, setInput] = useState("")
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<ReadonlySet<Id<"tasks">>>(() => new Set())

  useEffect(() => {
    const id = setTimeout(() => setSearch(input.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [input])

  const candidates = useQuery(
    api.tasks.queries.pickerCandidates,
    isAuthenticated && open
      ? { search: search || undefined, excludeIds: [...todayIds], limit: PICKER_LIMIT }
      : "skip",
  )
  const groups = useMemo(() => {
    // A title search covers what the caller can read; keep their own tasks.
    const mine = (candidates ?? []).filter((t) => !search || (me !== null && t.assigneeIds.includes(me)))
    return pickerGroups(mine, { today, todayIds, carriedIds: new Set(carried.keys()) })
  }, [candidates, carried, me, search, today, todayIds])

  const close = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setInput("")
      setSearch("")
      setSelected(new Set())
    }
  }
  const toggle = (id: Id<"tasks">) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const renderRow = (task: TaskRowDTO) => {
    const status = index.statusById.get(task.statusId)
    const project = task.projectId ? index.projectById.get(task.projectId) : undefined
    const clientId = task.clientId ?? project?.clientId
    const client = clientId ? index.clientById.get(clientId) : undefined
    const plannedOn = carried.get(task._id)
    const checked = selected.has(task._id)
    const overdue = !!task.dueDate && task.dueDate < today
    return (
      <CommandItem key={task._id} value={task._id} onSelect={() => toggle(task._id)} className="gap-2.5 py-2">
        <Checkbox checked={checked} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
        <PriorityIcon priority={task.priority} label={false} />
        {status ? <StatusIcon icon={status.icon} color={status.color} className="size-3.5" /> : null}
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        {plannedOn ? (
          <span className="shrink-0 text-xs text-muted-foreground">Planned {plannedOnLabel(plannedOn, today)}</span>
        ) : null}
        {client ? <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{client.name}</span> : null}
        <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
          {task.dueDate ? formatDue(task.dueDate, today) : "—"}
        </span>
      </CommandItem>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={close}
      title="Add tasks to today"
      description="Search your tasks and pick the ones you plan to work on today."
      className="sm:max-w-2xl"
    >
      <Command shouldFilter={false} loop>
        <CommandInput value={input} onValueChange={setInput} placeholder="Search your tasks to plan for today…" />
        <CommandList className="max-h-[52vh]">
          {candidates === undefined ? null : <CommandEmpty>No tasks to plan.</CommandEmpty>}
          {groups.suggested.length > 0 ? (
            <CommandGroup heading="Suggested · due soon, started or carried over">{groups.suggested.map(renderRow)}</CommandGroup>
          ) : null}
          {groups.rest.length > 0 ? (
            <CommandGroup heading={search ? "Other matches assigned to you" : "Everything else assigned to you"}>
              {groups.rest.map(renderRow)}
            </CommandGroup>
          ) : null}
        </CommandList>
        <div className="flex items-center gap-2 border-t px-3 py-2.5">
          <span className="text-[13px] text-muted-foreground tabular-nums">
            {selected.size > 0 ? `${selected.size} selected` : "Click rows to select"}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => {
              onAdd([...selected])
              close(false)
            }}
          >
            Add to today
          </Button>
        </div>
      </Command>
    </CommandDialog>
  )
}

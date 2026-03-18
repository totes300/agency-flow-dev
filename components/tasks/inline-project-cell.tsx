"use client"

import { useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
  CommandEmpty,
} from "@/components/ui/command"
import { LockIcon, FolderIcon } from "lucide-react"
import { toast } from "sonner"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineProjectCell({
  taskId,
  project,
  client,
  hasTimeEntries,
  onSelect: onSelectProp,
}: {
  taskId?: Id<"tasks">
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null
  client: Pick<Doc<"clients">, "_id" | "name"> | null
  hasTimeEntries?: boolean
  onSelect?: (projectId: Id<"projects"> | null, project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null, client: Pick<Doc<"clients">, "_id" | "name"> | null) => void
}) {
  const [open, setOpen] = useState(false)
  const projects = useQuery(api.projects.list, {})
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(projectId: Id<"projects"> | null) {
    setOpen(false)
    if (onSelectProp) {
      if (!projectId) { onSelectProp(null, null, null); return }
      const p = projects?.find((pr) => pr._id === projectId)
      onSelectProp(
        projectId,
        p ? { _id: p._id, name: p.name, code: p.code } : null,
        p ? { _id: p.clientId as Id<"clients">, name: p.clientName ?? "Unknown" } : null,
      )
      return
    }
    if (!taskId) return
    try {
      await updateTask({ id: taskId, projectId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  // Group projects by client name (Toggl-style)
  const groupedProjects = (() => {
    if (!projects) return new Map<string, typeof projects>()
    const groups = new Map<string, typeof projects>()
    for (const p of projects) {
      const clientName = p.clientName ?? "Unknown"
      if (!groups.has(clientName)) groups.set(clientName, [])
      groups.get(clientName)!.push(p)
    }
    return groups
  })()

  const locked = hasTimeEntries === true

  return (
    <Popover open={locked ? false : open} onOpenChange={locked ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex w-full items-center gap-1 rounded-sm py-0.5 text-left transition-colors ${project ? "hover:bg-muted/50" : ""}`}
          onClick={(e) => e.stopPropagation()}
          title={locked ? "Has time entries — project cannot be changed" : undefined}
        >
          {project ? (
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium">{client?.name}</span>
                {locked && <LockIcon className="size-3 shrink-0 text-muted-foreground" />}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">{project.name}</div>
            </div>
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground/20 transition-colors group-hover/row:text-muted-foreground/50">
              <FolderIcon className="size-3.5" />
              <span className="text-xs">Project</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search project..." />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => handleSelect(null)}>
                <span className="text-muted-foreground">None</span>
              </CommandItem>
            </CommandGroup>
            {[...groupedProjects.entries()].map(([clientName, clientProjects]) => (
              <CommandGroup key={clientName} heading={clientName}>
                {clientProjects?.map((p) => (
                  <CommandItem key={p._id} onSelect={() => handleSelect(p._id)}>
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{p.code}</span>
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

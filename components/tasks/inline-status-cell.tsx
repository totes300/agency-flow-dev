"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command"
import { StatusBadge } from "@/components/status-badge"
import { LoaderIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { getStatusColor } from "@/lib/status-colors"
import { toast } from "sonner"
import type { Doc, Id } from "@/convex/_generated/dataModel"

const STATUS_TYPE_GROUPS = [
  { type: "backlog", label: "Backlog" },
  { type: "in_progress", label: "In Progress" },
  { type: "review", label: "Review" },
  { type: "blocked", label: "Blocked" },
  { type: "done", label: "Done" },
] as const

export function InlineStatusCell({
  taskId,
  status,
  isAdmin,
  onSelect: onSelectProp,
}: {
  taskId?: Id<"tasks">
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type"> | null
  isAdmin: boolean
  onSelect?: (statusId: Id<"statuses">, status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type">) => void
}) {
  const [open, setOpen] = useState(false)
  const { statuses } = useTaskReferenceData()
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(statusId: Id<"statuses">) {
    setOpen(false)
    if (onSelectProp) {
      const s = statuses?.find((st) => st._id === statusId)
      if (s) onSelectProp(statusId, { _id: s._id, name: s.name, color: s.color, type: s.type })
      return
    }
    if (!taskId) return
    try {
      await updateTask({ id: taskId, statusId })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center py-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {status ? (
            <StatusBadge name={status.name} color={status.color} />
          ) : (
            <span className="flex items-center gap-1.5 text-muted-foreground/20 transition-colors group-hover/row:text-muted-foreground/50">
              <LoaderIcon className="size-3.5" />
              <span className="text-xs">Status</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search status..." />
          <CommandList>
            {STATUS_TYPE_GROUPS.map(({ type, label }) => {
              const group = statuses?.filter((s) => s.type === type)
              if (!group || group.length === 0) return null
              return (
                <CommandGroup key={type} heading={label}>
                  {group.map((s) => {
                    const disabled = !isAdmin && s.type === "done"
                    const cfg = getStatusColor(s.color)
                    return (
                      <CommandItem
                        key={s._id}
                        onSelect={() => !disabled && handleSelect(s._id)}
                        disabled={disabled}
                        className={cn(disabled && "opacity-50")}
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: cfg.dot }}
                        />
                        <span className="truncate">{s.name}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

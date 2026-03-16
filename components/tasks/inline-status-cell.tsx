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
} from "@/components/ui/command"
import { StatusBadge } from "@/components/status-badge"
import { cn } from "@/lib/utils"
import { getStatusColor } from "@/lib/status-colors"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineStatusCell({
  taskId,
  status,
  isAdmin,
}: {
  taskId: Id<"tasks">
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type"> | null
  isAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const statuses = useQuery(api.statuses.list, {})
  const updateTask = useMutation(api.tasks.update)

  async function handleSelect(statusId: Id<"statuses">) {
    setOpen(false)
    try {
      await updateTask({ id: taskId, statusId })
    } catch {
      // Convex real-time subscription will revert on failure
    }
  }

  if (!status) return <div className="truncate text-xs text-muted-foreground">—</div>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center rounded-sm py-0.5 transition-colors hover:bg-muted/50"
          onClick={(e) => e.stopPropagation()}
        >
          <StatusBadge name={status.name} color={status.color} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search status..." />
          <CommandList>
            <CommandGroup>
              {statuses?.map((s) => {
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

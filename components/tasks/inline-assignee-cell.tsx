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
  CommandEmpty,
} from "@/components/ui/command"
import { UserAvatar } from "@/components/user-avatar"
import { AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { CheckIcon, UserIcon } from "lucide-react"
import { firstName } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineAssigneeCell({
  taskId,
  assignees,
  onToggle: onToggleProp,
  emptyLabel,
}: {
  taskId?: Id<"tasks">
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
  onToggle?: (userId: Id<"users">, member: Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">) => void
  emptyLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const updateTask = useMutation(api.tasks.update)

  const { orgMembers } = useTaskReferenceData()

  const assigneeIdSet = new Set(assignees.map((a) => a._id.toString()))

  async function handleToggle(userId: Id<"users">) {
    if (onToggleProp) {
      const member = orgMembers?.find((m) => m._id === userId)
      if (member) onToggleProp(userId, { _id: member._id, name: member.name, email: member.email, imageUrl: member.imageUrl })
      return
    }
    if (!taskId) return
    const currentIds = assignees.map((a) => a._id)
    const newIds = assigneeIdSet.has(userId.toString())
      ? currentIds.filter((id) => id !== userId)
      : [...currentIds, userId]
    try {
      await updateTask({ id: taskId, assigneeIds: newIds })
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-center rounded-sm py-0.5 transition-colors",
            assignees.length > 0 && "hover:bg-accent",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {assignees.length === 0 ? (
            <span className="flex items-center gap-1.5 rounded-md border border-dashed border-border/55 bg-muted/[0.12] px-2 py-1 text-muted-foreground/60 transition-colors group-hover/row:border-border/80 group-hover/row:bg-muted/[0.22] group-hover/row:text-muted-foreground">
              <UserIcon className="size-4 shrink-0" strokeWidth={1.75} />
              {emptyLabel && <span className="text-[13px]">{emptyLabel}</span>}
            </span>
          ) : assignees.length === 1 ? (
            <span className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="relative z-0 transition-transform duration-200 ease-out hover:z-10 hover:-translate-y-0.5">
                    <UserAvatar name={assignees[0].name} imageUrl={assignees[0].imageUrl} size="sm" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">{assignees[0].name}</TooltipContent>
              </Tooltip>
              <span className="truncate text-[13px] text-muted-foreground">{firstName(assignees[0].name)}</span>
            </span>
          ) : (
            <AvatarGroup className="[&_[data-slot=avatar]]:relative [&_[data-slot=avatar]]:z-0 [&_[data-slot=avatar]]:transition-transform [&_[data-slot=avatar]]:duration-200 [&_[data-slot=avatar]]:ease-out [&_[data-slot=avatar]:hover]:z-10 [&_[data-slot=avatar]:hover]:-translate-y-0.5">
              {assignees.slice(0, 3).map((a) => (
                <Tooltip key={a._id}>
                  <TooltipTrigger asChild>
                    <span>
                      <UserAvatar name={a.name} imageUrl={a.imageUrl} size="sm" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">{a.name}</TooltipContent>
                </Tooltip>
              ))}
              {assignees.length > 3 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <AvatarGroupCount>
                      <span className="text-xs">+{assignees.length - 3}</span>
                    </AvatarGroupCount>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {assignees.slice(3).map((a) => firstName(a.name)).join(", ")}
                  </TooltipContent>
                </Tooltip>
              )}
            </AvatarGroup>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search people..." />
          <CommandList>
            <CommandEmpty>No members found.</CommandEmpty>
            <CommandGroup>
              {orgMembers?.map((member) => {
                const selected = assigneeIdSet.has(member._id.toString())
                return (
                  <CommandItem
                    key={member._id}
                    onSelect={() => handleToggle(member._id)}
                  >
                    <span className="flex items-center gap-2">
                      <UserAvatar name={member.name} imageUrl={member.imageUrl} size="sm" />
                      <span className="truncate">{member.name}</span>
                    </span>
                    {selected && <CheckIcon className="ml-auto size-3.5" />}
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

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
import { UserAvatar } from "@/components/user-avatar"
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar"
import { CheckIcon, UserIcon } from "lucide-react"
import { firstName } from "@/lib/format"
import { toast } from "sonner"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineAssigneeCell({
  taskId,
  assignees,
  onToggle: onToggleProp,
}: {
  taskId?: Id<"tasks">
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
  onToggle?: (userId: Id<"users">, member: Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">) => void
}) {
  const [open, setOpen] = useState(false)
  const updateTask = useMutation(api.tasks.update)

  const orgMembers = useQuery(api.orgMembers.listOrgMembers)

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
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`flex w-full items-center rounded-sm py-0.5 transition-colors ${assignees.length > 0 ? "hover:bg-muted/50" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {assignees.length === 0 ? (
            <span className="flex items-center gap-1.5 text-muted-foreground/20 transition-colors group-hover/row:text-muted-foreground/50">
              <UserIcon className="size-3.5" />
              <span className="text-xs">Assign</span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              {assignees.length === 1 ? (
                <>
                  <UserAvatar name={assignees[0].name} imageUrl={assignees[0].imageUrl} className="size-5 text-[8px]" />
                  <span className="truncate text-[11px] text-muted-foreground">{firstName(assignees[0].name)}</span>
                </>
              ) : assignees.length === 2 ? (
                <>
                  <AvatarGroup>
                    <UserAvatar name={assignees[0].name} imageUrl={assignees[0].imageUrl} className="size-5 text-[8px]" />
                    <UserAvatar name={assignees[1].name} imageUrl={assignees[1].imageUrl} className="size-5 text-[8px]" />
                  </AvatarGroup>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {firstName(assignees[0].name)}, {firstName(assignees[1].name)}
                  </span>
                </>
              ) : (
                <>
                  <AvatarGroup>
                    <UserAvatar name={assignees[0].name} imageUrl={assignees[0].imageUrl} className="size-5 text-[8px]" />
                    <AvatarGroupCount>
                      <Avatar className="size-5">
                        <AvatarFallback className="text-[8px]">+{assignees.length - 1}</AvatarFallback>
                      </Avatar>
                    </AvatarGroupCount>
                  </AvatarGroup>
                </>
              )}
            </span>
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


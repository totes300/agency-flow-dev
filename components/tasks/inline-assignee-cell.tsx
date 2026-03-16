"use client"

import { useState, useMemo } from "react"
import { useMutation, useQuery } from "convex/react"
import { useOrganization } from "@clerk/nextjs"
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
import { CheckIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function InlineAssigneeCell({
  taskId,
  assignees,
}: {
  taskId: Id<"tasks">
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
}) {
  const [open, setOpen] = useState(false)
  const updateTask = useMutation(api.tasks.update)

  // Get org members from Clerk, resolve to Convex users
  const { memberships } = useOrganization({ memberships: true })
  const externalIds = useMemo(
    () => memberships?.data
      ?.map((m) => m.publicUserData?.userId)
      .filter((id): id is string => !!id) ?? [],
    [memberships?.data]
  )
  const orgUsers = useQuery(
    api.users.listByExternalIds,
    externalIds.length > 0 ? { externalIds } : "skip"
  )

  const assigneeIdSet = new Set(assignees.map((a) => a._id.toString()))

  async function handleToggle(userId: Id<"users">) {
    const currentIds = assignees.map((a) => a._id)
    const newIds = assigneeIdSet.has(userId.toString())
      ? currentIds.filter((id) => id !== userId)
      : [...currentIds, userId]
    try {
      await updateTask({ id: taskId, assigneeIds: newIds })
    } catch {
      // Convex subscription reverts on failure
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex w-full items-center rounded-sm py-0.5 transition-colors hover:bg-muted/50"
          onClick={(e) => e.stopPropagation()}
        >
          {assignees.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : assignees.length === 1 ? (
            <UserAvatar
              name={assignees[0].name}
              imageUrl={assignees[0].imageUrl}
              size="sm"
            />
          ) : (
            <AvatarGroup>
              {assignees.slice(0, 2).map((a) => (
                <UserAvatar
                  key={a._id}
                  name={a.name}
                  imageUrl={a.imageUrl}
                  size="sm"
                />
              ))}
              {assignees.length > 2 && (
                <AvatarGroupCount>
                  <Avatar size="sm">
                    <AvatarFallback>+{assignees.length - 2}</AvatarFallback>
                  </Avatar>
                </AvatarGroupCount>
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
              {orgUsers?.filter(Boolean).map((user) => {
                if (!user) return null
                const selected = assigneeIdSet.has(user._id.toString())
                return (
                  <CommandItem
                    key={user._id}
                    onSelect={() => handleToggle(user._id)}
                  >
                    <span className="flex items-center gap-2">
                      <UserAvatar name={user.name} imageUrl={user.imageUrl} size="sm" />
                      <span className="truncate">{user.name}</span>
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

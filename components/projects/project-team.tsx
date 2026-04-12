"use client"

import { useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { RowActionMenu } from "@/components/row-action-menu"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { PlusIcon, Trash2Icon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { extractErrorMessage } from "@/lib/toast-helpers"
import type { DefaultAssignee } from "@/lib/hooks/use-default-assignees"

type ProjectTeamProps = {
  projectId: Id<"projects">
  teamMembers: Id<"users">[] | undefined
  defaultAssignees: DefaultAssignee[] | undefined
  isAdmin: boolean
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export function ProjectTeam({ projectId, teamMembers = [], defaultAssignees = [], isAdmin }: ProjectTeamProps) {
  const orgMembers = useQuery(api.orgMembers.listOrgMembers, {})
  const updateProject = useMutation(api.projects.update)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const teamMemberSet = new Set(teamMembers.map((id) => id.toString()))

  const resolvedMembers = orgMembers
    ?.filter((m) => teamMemberSet.has(m._id.toString()))
    ?? []

  const availableMembers = orgMembers
    ?.filter((m) => !teamMemberSet.has(m._id.toString()))
    ?? []

  async function handleAddMember(userId: Id<"users">) {
    setSaving(true)
    try {
      await updateProject({
        id: projectId,
        teamMembers: [...teamMembers, userId],
      })
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to add team member"))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveMember(userId: Id<"users">) {
    setSaving(true)
    try {
      await updateProject({
        id: projectId,
        teamMembers: teamMembers.filter((id) => id !== userId),
        // Also remove from defaultAssignees to prevent drift
        defaultAssignees: defaultAssignees.filter((da) => da.userId !== userId),
      })
    } catch (err) {
      toast.error(extractErrorMessage(err, "Failed to remove team member"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Project Team</CardTitle>
            <CardDescription>
              Manage who works on this project.
            </CardDescription>
          </div>
          {isAdmin && (
            <Popover open={addOpen} onOpenChange={setAddOpen}>
              <PopoverTrigger asChild>
                <Button size="sm" disabled={saving}>
                  <PlusIcon data-icon="inline-start" />
                  Add Member
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-0" align="end">
                <Command>
                  <CommandInput placeholder="Search members..." />
                  <CommandList>
                    <CommandEmpty>No available members.</CommandEmpty>
                    <CommandGroup>
                      {availableMembers.map((member) => (
                        <CommandItem
                          key={member._id}
                          value={member.name}
                          onSelect={() => {
                            void handleAddMember(member._id)
                            setAddOpen(false)
                          }}
                        >
                          <Avatar className="mr-2 size-6">
                            <AvatarImage src={member.imageUrl} />
                            <AvatarFallback className="text-[10px]">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="truncate">{member.name}</span>
                          {member.email && (
                            <span className="ml-auto truncate text-xs text-muted-foreground">
                              {member.email}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {resolvedMembers.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
            <UsersIcon className="size-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No team members</p>
            <p className="text-xs text-muted-foreground">
              Add members to this project to manage assignments and time tracking.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Header row */}
            <div className="grid min-w-[500px] grid-cols-[1fr_100px_1fr_40px] items-center border-b px-1 pb-2 text-xs font-medium text-muted-foreground">
              <span>Member</span>
              <span>Role</span>
              <span>Email</span>
              <span />
            </div>
            {/* Member rows */}
            {resolvedMembers.map((member) => (
              <div
                key={member._id}
                className="grid min-w-[500px] grid-cols-[1fr_100px_1fr_40px] items-center border-b px-1 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-7">
                    <AvatarImage src={member.imageUrl} />
                    <AvatarFallback className="text-[10px]">
                      {getInitials(member.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{member.name}</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {member.role === "admin" ? "Admin" : "Member"}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {member.email ?? "—"}
                </span>
                {isAdmin ? (
                  <RowActionMenu>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      disabled={saving}
                      onClick={() => void handleRemoveMember(member._id)}
                    >
                      <Trash2Icon className="size-4" />
                      Remove
                    </DropdownMenuItem>
                  </RowActionMenu>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

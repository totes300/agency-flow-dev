"use client"

import { useState } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandInput,
  CommandList,
  CommandItem,
  CommandGroup,
} from "@/components/ui/command"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { getStatusColor } from "@/lib/status-colors"
import { getCategoryColor } from "@/convex/lib/constants"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import {
  LoaderIcon,
  UserPlusIcon,
  UserMinusIcon,
  TagIcon,
  ArchiveIcon,
  XIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

export function BulkToolbar({
  selectedIds,
  onDeselectAll,
  isAdmin,
}: {
  selectedIds: Set<string>
  onDeselectAll: () => void
  isAdmin: boolean
}) {
  const count = selectedIds.size
  if (count === 0) return null

  const taskIds = [...selectedIds] as Id<"tasks">[]

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-background px-3 py-2 shadow-lg">
        {/* Count + deselect */}
        <div className="flex items-center gap-2 pr-2">
          <span className="text-sm font-medium">{count} selected</span>
          <button
            type="button"
            aria-label="Clear selection"
            onClick={onDeselectAll}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Status */}
        <StatusAction taskIds={taskIds} isAdmin={isAdmin} />

        {/* Add assignee */}
        <AssigneeAction taskIds={taskIds} type="add" />

        {/* Remove assignee */}
        <AssigneeAction taskIds={taskIds} type="remove" />

        {/* Category */}
        <CategoryAction taskIds={taskIds} />

        <Separator orientation="vertical" className="mx-1 h-5" />

        {/* Archive */}
        <ArchiveAction taskIds={taskIds} onDeselectAll={onDeselectAll} />
      </div>
    </div>
  )
}

// Uses shadcn Separator — imported at top of file

// ─── Actions ────────────────────────────────────────────────────────────────

function StatusAction({ taskIds, isAdmin }: { taskIds: Id<"tasks">[]; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const { statuses } = useTaskReferenceData()
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleSelect(statusId: Id<"statuses">) {
    setOpen(false)
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "status", statusId },
      })
      toast.success(`${result.updated} tasks updated`)
      if (result.skipped.length > 0) {
        toast.info(`${result.skipped.length} tasks skipped`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
          <LoaderIcon className="size-3.5" />
          Status
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="center">
        <Command>
          <CommandList>
            <CommandGroup>
              {statuses?.map((s) => {
                const disabled = !isAdmin && s.type === "done"
                const cfg = getStatusColor(s.color)
                return (
                  <CommandItem
                    key={s._id}
                    disabled={disabled}
                    onSelect={() => !disabled && handleSelect(s._id)}
                    className={disabled ? "opacity-50" : ""}
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: cfg.dot }} />
                    {s.name}
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

function AssigneeAction({ taskIds, type }: { taskIds: Id<"tasks">[]; type: "add" | "remove" }) {
  const [open, setOpen] = useState(false)
  const { orgMembers } = useTaskReferenceData()
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleSelect(userId: Id<"users">) {
    setOpen(false)
    try {
      const result = await bulkUpdate({
        taskIds,
        action: type === "add"
          ? { type: "addAssignee", userId }
          : { type: "removeAssignee", userId },
      })
      toast.success(`${result.updated} tasks updated`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
          {type === "add" ? <UserPlusIcon className="size-3.5" /> : <UserMinusIcon className="size-3.5" />}
          {type === "add" ? "Add" : "Remove"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="center">
        <Command>
          <CommandInput placeholder="Search..." />
          <CommandList>
            <CommandGroup>
              {orgMembers?.map((m) => (
                <CommandItem key={m._id} onSelect={() => handleSelect(m._id)}>
                  <UserAvatar name={m.name} imageUrl={m.imageUrl} className="size-5 text-[8px]" />
                  {m.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function CategoryAction({ taskIds }: { taskIds: Id<"tasks">[] }) {
  const [open, setOpen] = useState(false)
  const { categories } = useTaskReferenceData()
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleSelect(workCategoryId: Id<"workCategories">) {
    setOpen(false)
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "category", workCategoryId },
      })
      toast.success(`${result.updated} tasks updated`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
          <TagIcon className="size-3.5" />
          Category
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-0" align="center">
        <Command>
          <CommandList>
            <CommandGroup>
              {categories?.map((c) => {
                const colors = getCategoryColor(c.color)
                return (
                  <CommandItem key={c._id} onSelect={() => handleSelect(c._id)}>
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colors.bg, border: `1px solid ${colors.text}30` }} />
                    {c.name}
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

function ArchiveAction({ taskIds, onDeselectAll }: { taskIds: Id<"tasks">[]; onDeselectAll: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleArchive() {
    setConfirmOpen(false)
    const count = taskIds.length
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "archive" },
      })
      onDeselectAll()
      toast.success(`${result.updated} tasks archived`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive")
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
      >
        <ArchiveIcon className="size-3.5" />
        Archive
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {taskIds.length} tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              These tasks and their subtasks will be archived. You can restore them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

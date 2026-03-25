"use client"

import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
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
import { ConfirmDialog } from "@/components/confirm-dialog"
import { StatusBadge } from "@/components/status-badge"
import { CategoryBadge } from "@/components/category-badge"
import { UserAvatar } from "@/components/user-avatar"
import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import {
  CircleDashedIcon,
  UserPlusIcon,
  UserMinusIcon,
  TagIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"
import type { TaskTab } from "@/lib/hooks/use-task-filters"

export function BulkToolbar({
  selectedIds,
  onDeselectAll,
  isAdmin,
  activeTab,
}: {
  selectedIds: Set<string>
  onDeselectAll: () => void
  isAdmin: boolean
  activeTab: TaskTab
}) {
  const count = selectedIds.size
  const taskIds = [...selectedIds] as Id<"tasks">[]
  const isArchived = activeTab === "archived"

  return (
    <AnimatePresence>
    {count > 0 && (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2"
    >
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

        {isArchived ? (
          <>
            {/* Archived tab: Restore + Delete */}
            <RestoreAction taskIds={taskIds} onDeselectAll={onDeselectAll} />
            {isAdmin && (
              <DeleteAction taskIds={taskIds} onDeselectAll={onDeselectAll} />
            )}
          </>
        ) : (
          <>
            {/* Normal tabs: Status, Assignee, Category, Archive, Delete */}
            <StatusAction taskIds={taskIds} isAdmin={isAdmin} />
            <AssigneeAction taskIds={taskIds} type="add" />
            <AssigneeAction taskIds={taskIds} type="remove" />
            <CategoryAction taskIds={taskIds} />

            <Separator orientation="vertical" className="mx-1 h-5" />

            <ArchiveAction taskIds={taskIds} onDeselectAll={onDeselectAll} />
            {isAdmin && (
              <DeleteAction taskIds={taskIds} onDeselectAll={onDeselectAll} />
            )}
          </>
        )}
      </div>
    </motion.div>
    )}
    </AnimatePresence>
  )
}

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
      toastError(err, "Failed to update")
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
          <CircleDashedIcon className="size-3.5" />
          Status
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-60 p-0" align="center">
        <Command>
          <CommandList>
            <CommandGroup>
              {statuses?.map((s) => {
                const disabled = !isAdmin && s.type === "done"
                return (
                  <CommandItem
                    key={s._id}
                    disabled={disabled}
                    onSelect={() => !disabled && handleSelect(s._id)}
                    className={cn("px-2 py-1.5", disabled && "opacity-50")}
                  >
                    <StatusBadge name={s.name} color={s.color} type={s.type} />
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
      toastError(err, "Failed to update")
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
      <PopoverContent className="w-60 p-0" align="center">
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
      toastError(err, "Failed to update")
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
      <PopoverContent className="w-60 p-0" align="center">
        <Command>
          <CommandList>
            <CommandGroup>
              {categories?.map((c) => (
                  <CommandItem key={c._id} onSelect={() => handleSelect(c._id)} className="px-2 py-1.5">
                    <CategoryBadge name={c.name} color={c.color} />
                  </CommandItem>
              ))}
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
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "archive" },
      })
      onDeselectAll()
      toast.success(`${result.updated} tasks archived`)
    } catch (err) {
      toastError(err, "Failed to archive")
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setConfirmOpen(true)}
      >
        <ArchiveIcon className="size-3.5" />
        Archive
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Archive ${taskIds.length} tasks?`}
        description="These tasks and their subtasks will be archived. You can restore them later."
        confirmLabel="Archive"
        onConfirm={handleArchive}
      />
    </>
  )
}

function DeleteAction({ taskIds, onDeselectAll }: { taskIds: Id<"tasks">[]; onDeselectAll: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleDelete() {
    setConfirmOpen(false)
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "delete" },
      })
      onDeselectAll()
      toast.success(`${result.updated} tasks deleted`)
      if (result.skipped.length > 0) {
        toast.info(`${result.skipped.length} tasks skipped`)
      }
    } catch (err) {
      toastError(err, "Failed to delete")
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
        <Trash2Icon className="size-3.5" />
        Delete
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Permanently delete ${taskIds.length} tasks?`}
        description="This will permanently delete these tasks including all subtasks, time entries, comments, and attachments. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
}

function RestoreAction({ taskIds, onDeselectAll }: { taskIds: Id<"tasks">[]; onDeselectAll: () => void }) {
  const bulkUpdate = useMutation(api.tasks.bulkUpdate)

  async function handleRestore() {
    try {
      const result = await bulkUpdate({
        taskIds,
        action: { type: "restore" },
      })
      onDeselectAll()
      toast.success(`${result.updated} tasks restored`)
    } catch (err) {
      toastError(err, "Failed to restore")
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-xs"
      onClick={handleRestore}
    >
      <ArchiveRestoreIcon className="size-3.5" />
      Restore
    </Button>
  )
}

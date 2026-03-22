"use client"

import { useState, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { Button } from "@/components/ui/button"
import { PlusIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-helpers"
import type { Doc, Id } from "@/convex/_generated/dataModel"

export function SubtaskInlineCreate({
  parentTaskId,
  parentProjectId,
  parentBillable,
  parentCategoryId,
  parentAssigneeIds,
}: {
  parentTaskId: Id<"tasks">
  parentProjectId?: Id<"projects">
  parentBillable: boolean
  parentCategoryId?: Id<"workCategories">
  parentAssigneeIds: Id<"users">[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [statusId, setStatusId] = useState<Id<"statuses"> | undefined>()
  const [categoryId, setCategoryId] = useState<Id<"workCategories"> | undefined>(parentCategoryId)
  const [assigneeIds, setAssigneeIds] = useState<Id<"users">[]>([...parentAssigneeIds])
  const inputRef = useRef<HTMLInputElement>(null)

  const createSubtask = useMutation(api.tasks.createSubtask)
  const { statuses, categories, orgMembers } = useTaskReferenceData()

  // Resolved values for display
  const selectedStatus = statuses?.find((s) => s._id === statusId) ?? null
  const selectedCategory = categoryId ? categories?.find((c) => c._id === categoryId) ?? null : null
  const selectedAssignees = orgMembers?.filter((m) => assigneeIds.includes(m._id)) ?? []

  function handleOpen() {
    setIsOpen(true)
    setCategoryId(parentCategoryId)
    setAssigneeIds([...parentAssigneeIds])
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleCancel() {
    setIsOpen(false)
    setTitle("")
    setStatusId(undefined)
    setCategoryId(parentCategoryId)
    setAssigneeIds([...parentAssigneeIds])
  }

  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed) return

    try {
      await createSubtask({
        parentTaskId,
        title: trimmed,
        statusId,
        workCategoryId: categoryId,
        assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
      })
      setTitle("")
      setStatusId(undefined)
      // Keep category and assignee for batch creation
      toast.success("Subtask created")
      inputRef.current?.focus()
    } catch (err) {
      toastError(err, "Failed to create subtask")
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === "Escape") {
      handleCancel()
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 py-1.5 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <PlusIcon className="size-3.5" />
        Add subtask
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
      {/* Status quick-assign */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <InlineStatusCell
          status={selectedStatus}
          isAdmin={true}
          onSelect={(id, status) => setStatusId(id)}
        />
      </div>

      {/* Title input */}
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Subtask title..."
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />

      {/* Category quick-assign */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <InlineCategoryCell
          category={selectedCategory ? { _id: selectedCategory._id, name: selectedCategory.name, color: selectedCategory.color } : null}
          onSelect={(id) => setCategoryId(id ?? undefined)}
        />
      </div>

      {/* Assignee quick-assign */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <InlineAssigneeCell
          assignees={selectedAssignees.map((m) => ({ _id: m._id, name: m.name, email: m.email, imageUrl: m.imageUrl }))}
          onToggle={(userId) => {
            setAssigneeIds((prev) =>
              prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
            )
          }}
        />
      </div>

      {/* Actions */}
      <Button size="xs" onClick={handleSave} disabled={!title.trim()}>
        Save
      </Button>
      <Button size="icon-xs" variant="ghost" onClick={handleCancel}>
        <XIcon className="size-3.5" />
      </Button>
    </div>
  )
}

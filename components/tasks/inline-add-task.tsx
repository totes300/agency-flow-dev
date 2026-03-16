"use client"

import { useState, useRef, useCallback } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import type { Id } from "@/convex/_generated/dataModel"
import type { GroupByOption } from "@/lib/hooks/use-task-filters"

export function InlineAddTask({
  groupBy,
  groupKey,
}: {
  groupBy: GroupByOption
  groupKey: string
}) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useMutation(api.tasks.create)

  const activate = useCallback(() => {
    setActive(true)
  }, [])

  async function handleSubmit() {
    const trimmed = title.trim()
    if (!trimmed || isSubmitting) return
    setIsSubmitting(true)

    // Build args with group-inherited defaults
    const args: {
      title: string
      projectId?: Id<"projects">
      workCategoryId?: Id<"workCategories">
      statusId?: Id<"statuses">
      assigneeIds?: Id<"users">[]
    } = { title: trimmed }

    if (groupBy && groupKey && !groupKey.startsWith("__")) {
      switch (groupBy) {
        case "project":
          args.projectId = groupKey as Id<"projects">
          break
        case "category":
          args.workCategoryId = groupKey as Id<"workCategories">
          break
        case "status":
          args.statusId = groupKey as Id<"statuses">
          break
        case "assignee":
          args.assigneeIds = [groupKey as Id<"users">]
          break
      }
    }

    try {
      await createTask(args)
      setTitle("") // Clear for rapid entry — input stays open
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create task")
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      setTitle("")
      setActive(false)
    }
  }

  if (!active) {
    return (
      <button
        onClick={activate}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground/60 transition-colors hover:bg-muted/30 hover:text-muted-foreground"
      >
        <PlusIcon className="size-3.5" />
        Add task...
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5">
      <PlusIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!title.trim()) setActive(false)
        }}
        placeholder="Task name..."
        aria-label="New task title"
        disabled={isSubmitting}
        className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  )
}

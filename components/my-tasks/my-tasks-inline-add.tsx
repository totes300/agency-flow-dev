"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { PlusIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

export function MyTasksInlineAdd({
  statusId,
  currentUserId,
}: {
  statusId?: Id<"statuses">
  currentUserId: Id<"users">
}) {
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useMutation(api.tasks.create)

  // Auto-focus when activated
  useEffect(() => {
    if (active) inputRef.current?.focus()
  }, [active])

  async function handleSubmit() {
    const trimmed = title.trim()
    if (!trimmed) return

    setTitle("")

    try {
      await createTask({
        title: trimmed,
        statusId,
        assigneeIds: [currentUserId],
        billable: true,
      })
    } catch (err) {
      toastError(err, "Failed to create task")
    }

    // Keep focused for rapid-fire
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      void handleSubmit()
    } else if (e.key === "Escape") {
      setTitle("")
      setActive(false)
    }
  }

  if (!active) {
    return (
      <button
        type="button"
        onClick={() => setActive(true)}
        className="flex w-full items-center gap-1.5 border-b border-border/40 px-3 py-2 text-xs text-muted-foreground/40 transition-colors hover:bg-muted/30 hover:text-muted-foreground/60"
      >
        <PlusIcon className="size-3" />
        Add task...
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
      <PlusIcon className="size-3 shrink-0 text-muted-foreground/40" />
      <input
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!title.trim()) setActive(false)
        }}
        placeholder="Task name..."
        aria-label="New task title"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  )
}

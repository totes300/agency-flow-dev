"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "convex/react"
import { ArrowUpIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PlusNavIcon } from "@/components/icons/nav-icons"

/**
 * My Tasks quick add on phones (§11.11, the old My Tasks FAB): a round "+"
 * at the bottom right opens a one-line title field; Enter creates the task
 * assigned to the caller, Escape closes. `onCreated` lets the Today tab plan
 * the new task for the caller's day. Hidden from `md` up, where C and the
 * toolbar's compose button do the same.
 */
export function MobileFab({
  me,
  onCreated,
}: {
  me: Id<"users"> | null
  onCreated?: (taskId: Id<"tasks">) => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useMutation(api.tasks.create)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function close() {
    setTitle("")
    setOpen(false)
  }

  async function submit() {
    const trimmed = title.trim()
    if (!trimmed || !me) return
    close()
    try {
      const taskId = await createTask({ title: trimmed, assigneeIds: [me] })
      onCreated?.(taskId)
    } catch (err) {
      toastError(err, "Failed to create task")
    }
  }

  if (open) {
    return (
      <form
        className="fixed right-4 bottom-6 left-4 z-40 flex gap-2 md:hidden"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close()
          }}
          onBlur={() => {
            if (!title.trim()) close()
          }}
          placeholder="Task name…"
          aria-label="New task title"
          className="h-12 flex-1 rounded-full bg-background px-4 shadow-lg"
        />
        <Button type="submit" size="icon" className="size-12 rounded-full shadow-lg" disabled={!title.trim()} aria-label="Create task">
          <ArrowUpIcon />
        </Button>
      </form>
    )
  }

  return (
    <Button
      size="icon"
      className="fixed right-6 bottom-6 z-40 size-12 rounded-full shadow-lg md:hidden"
      aria-label="New task"
      disabled={!me}
      onClick={() => setOpen(true)}
    >
      <PlusNavIcon size={20} />
    </Button>
  )
}

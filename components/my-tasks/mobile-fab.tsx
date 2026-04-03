"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { PlusIcon, SendIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

export function MobileFab({
  todayStatusId,
  currentUserId,
}: {
  todayStatusId?: Id<"statuses">
  currentUserId: Id<"users">
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useMutation(api.tasks.create)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function handleSubmit() {
    const trimmed = title.trim()
    if (!trimmed) return

    setTitle("")
    setOpen(false)

    try {
      await createTask({
        title: trimmed,
        statusId: todayStatusId,
        assigneeIds: [currentUserId],
        billable: true,
      })
    } catch (err) {
      toastError(err, "Failed to create task")
    }
  }

  if (open) {
    return (
      <div className="fixed bottom-6 left-4 right-4 z-40 flex gap-2 md:hidden">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit()
            if (e.key === "Escape") { setTitle(""); setOpen(false) }
          }}
          placeholder="Task name..."
          className="flex-1 rounded-full border bg-background px-4 py-3 text-sm shadow-lg outline-none focus:ring-2 focus:ring-primary"
        />
        <Button
          onClick={() => void handleSubmit()}
          disabled={!title.trim()}
          className="size-12 rounded-full shadow-lg"
          size="icon"
        >
          <SendIcon className="size-5" />
        </Button>
      </div>
    )
  }

  return (
    <Button
      onClick={() => setOpen(true)}
      className="fixed bottom-6 right-6 z-40 size-12 rounded-full shadow-lg md:hidden"
      size="icon"
    >
      <PlusIcon className="size-5" />
    </Button>
  )
}

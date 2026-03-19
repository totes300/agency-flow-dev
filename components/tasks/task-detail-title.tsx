"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailTitle({
  taskId,
  title,
}: {
  taskId: Id<"tasks">
  title: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const updateTask = useMutation(api.tasks.update)

  // Sync with prop when not editing
  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed || trimmed === title) {
      setValue(title)
      setEditing(false)
      return
    }
    try {
      await updateTask({ id: taskId, title: trimmed })
    } catch {
      setValue(title)
    }
    setEditing(false)
  }

  return (
    <div className="shrink-0 px-7 pt-6 pb-2">
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave()
            if (e.key === "Escape") { setValue(title); setEditing(false) }
          }}
          className="w-full text-[22px] font-semibold tracking-tight text-foreground outline-none"
          autoFocus
        />
      ) : (
        <h1
          onClick={() => {
            setEditing(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          className="cursor-text text-[22px] font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>
      )}
    </div>
  )
}

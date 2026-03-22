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
  const savingRef = useRef(false)
  const updateTask = useMutation(api.tasks.update)

  // Sync with prop when not editing
  useEffect(() => {
    if (!editing) setValue(title)
  }, [title, editing])

  async function handleSave() {
    if (savingRef.current) return
    const trimmed = value.trim()
    if (!trimmed || trimmed === title) {
      setValue(title)
      setEditing(false)
      return
    }
    savingRef.current = true
    try {
      await updateTask({ id: taskId, title: trimmed })
    } catch {
      setValue(title)
    }
    savingRef.current = false
    setEditing(false)
  }

  return (
    <div className="shrink-0 px-7 pt-6 pb-2">
      {editing ? (
        <input
          ref={inputRef}
          aria-label="Task title"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave()
            if (e.key === "Escape") { setValue(title); setEditing(false) }
          }}
          className="w-full text-[22px] font-semibold tracking-tight text-foreground outline-none"
          autoFocus
        />
      ) : (
        <h1
          tabIndex={0}
          role="button"
          onClick={() => {
            setEditing(true)
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              setEditing(true)
              setTimeout(() => inputRef.current?.focus(), 0)
            }
          }}
          className="-mx-2 cursor-text rounded-md px-2 text-[22px] font-semibold tracking-tight text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </h1>
      )}
    </div>
  )
}

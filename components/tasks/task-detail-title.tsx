"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailTitle({
  taskId,
  title,
  projectCode,
}: {
  taskId: Id<"tasks">
  title: string
  projectCode?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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
    <div className="shrink-0 pb-2">
      {projectCode && (
        <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground/60">{projectCode}</span>
      )}
      {editing ? (
        <textarea
          ref={inputRef}
          aria-label="Task title"
          value={value}
          rows={1}
          onChange={(e) => {
            setValue(e.target.value)
            // Auto-resize
            e.target.style.height = "auto"
            e.target.style.height = e.target.scrollHeight + "px"
          }}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSave() }
            if (e.key === "Escape") { setValue(title); setEditing(false) }
          }}
          className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md px-2 text-3xl font-semibold leading-[1.2] tracking-tight text-foreground outline-none"
          autoFocus
          onFocus={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px" }}
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
          className="-mx-2 cursor-text rounded-md px-2 text-3xl font-semibold leading-[1.2] tracking-tight text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </h1>
      )}
    </div>
  )
}

"use client"

import { useState, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"

/**
 * The drawer's title editor: an `h1` that turns into an auto-growing
 * textarea; Enter or blur saves, Esc reverts. Saves the task by default; a
 * proposal source (the Draft / proposed-change drawer, email-triage B7)
 * passes `onSave` instead, and `readOnly` for a viewer who may not edit.
 */
type TaskDetailTitleProps = {
  title: string
  projectCode?: string
  readOnly?: boolean
} & (
  | { /** Saves the task (`tasks.update`). */ taskId: Id<"tasks">; onSave?: never }
  | { /** Replaces the task save (e.g. persist into a proposal draft). */ onSave: (title: string) => void | Promise<void>; taskId?: never }
)

export function TaskDetailTitle(props: TaskDetailTitleProps) {
  const { title, projectCode, readOnly = false } = props
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const savingRef = useRef(false)
  const updateTask = useMutation(api.tasks.update)

  // The editor starts from the current title (the prop may have changed while not editing).
  function startEditing() {
    setValue(title)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

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
      if (props.onSave) await props.onSave(trimmed)
      else await updateTask({ id: props.taskId, title: trimmed })
    } catch (err) {
      toastError(err, "Failed to update title")
      setValue(title)
    }
    savingRef.current = false
    setEditing(false)
  }

  return (
    <div className="shrink-0 pb-2">
      {projectCode ? (
        <span className="mb-1.5 block text-[13px] font-medium text-muted-foreground/60">{projectCode}</span>
      ) : null}
      {readOnly ? (
        <h1 className="-mx-2 rounded-md px-2 text-3xl font-bold leading-[1.2] tracking-tight text-foreground">{title}</h1>
      ) : editing ? (
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
          className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-md px-2 text-3xl font-bold leading-[1.2] tracking-tight text-foreground outline-none"
          autoFocus
          onFocus={(e) => { e.target.style.height = "auto"; e.target.style.height = e.target.scrollHeight + "px" }}
        />
      ) : (
        <h1
          tabIndex={0}
          role="button"
          onClick={startEditing}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              startEditing()
            }
          }}
          className="-mx-2 cursor-text rounded-md px-2 text-3xl font-bold leading-[1.2] tracking-tight text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
        >
          {title}
        </h1>
      )}
    </div>
  )
}

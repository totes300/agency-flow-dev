"use client"

import { useState, useRef } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { toastError } from "@/lib/toast-helpers"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailCommentInput({ taskId }: { taskId: Id<"tasks"> }) {
  const [value, setValue] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const createComment = useMutation(api.comments.create)

  async function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return

    setIsSubmitting(true)
    try {
      // Store as simple Tiptap JSON with a paragraph
      const content = {
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: trimmed }],
        }],
      }
      await createComment({ taskId, content })
      setValue("")
      inputRef.current?.focus()
    } catch (err) {
      toastError(err, "Failed to post comment")
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border/40 p-3">
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Write a comment..."
        rows={2}
        className="resize-none rounded-lg border border-border/40 bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/40 focus:border-ring focus:ring-1 focus:ring-ring/30"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/40">
          {typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘" : "Ctrl"}+Enter
        </span>
        <Button
          size="xs"
          onClick={handleSubmit}
          disabled={!value.trim() || isSubmitting}
        >
          Comment
        </Button>
      </div>
    </div>
  )
}

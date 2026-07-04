"use client"

import { useCallback, useRef, useEffect, useMemo } from "react"
import { useMutation } from "convex/react"
import dynamic from "next/dynamic"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const TiptapEditor = dynamic(
  () => import("@/components/tasks/tiptap-editor").then((mod) => ({ default: mod.TiptapEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="py-3">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-5 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    ),
  },
)

type TaskOverviewData = {
  _id: Id<"tasks">
  description?: unknown
  assigneeIds?: Id<"users">[]
}

export function TaskDetailOverview({
  task,
}: {
  task: TaskOverviewData
}) {
  const updateDescription = useMutation(api.tasks.updateDescription)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskIdRef = useRef(task._id)

  const pendingSaveRef = useRef<(() => void) | null>(null)

  // Keep taskId ref in sync — prevents stale closure in debounce
  useEffect(() => {
    taskIdRef.current = task._id
  }, [task._id])

  // Flush pending autosave when task changes (J/K nav) or component unmounts
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        pendingSaveRef.current?.()
      }
    }
  }, [task._id])

  // Auto-save description with 1s debounce — uses ref for taskId to prevent stale closure
  const handleDescriptionUpdate = useCallback(
    (content: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const doSave = () => {
        pendingSaveRef.current = null
        void updateDescription({
          id: taskIdRef.current,
          description: JSON.stringify(content),
        }).catch(() => {
          // Silently fail — user will see stale content on next load
        })
      }
      pendingSaveRef.current = doSave
      debounceRef.current = setTimeout(doSave, 1000)
    },
    [updateDescription],
  )

  // Parse description — could be JSON string or object
  const descriptionContent = useMemo(() => {
    if (!task.description) return undefined
    if (typeof task.description === "string") {
      try {
        return JSON.parse(task.description)
      } catch {
        return undefined
      }
    }
    return task.description
  }, [task.description])

  return (
    <section>
      <TiptapEditor
        content={descriptionContent}
        onUpdate={handleDescriptionUpdate}
        variant="document"
        taskAssigneeIds={task.assigneeIds}
        taskId={task._id}
      />
    </section>
  )
}

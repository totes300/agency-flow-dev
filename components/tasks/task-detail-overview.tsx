"use client"

import { useCallback, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import dynamic from "next/dynamic"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

const SubtaskList = dynamic(
  () => import("@/components/tasks/subtask-list").then((m) => ({ default: m.SubtaskList })),
  { ssr: false, loading: () => null },
)

const TiptapEditor = dynamic(
  () => import("@/components/tasks/tiptap-editor").then((mod) => ({ default: mod.TiptapEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-border/40 p-4">
        <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-5 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    ),
  },
)

type TaskOverviewData = {
  _id: Id<"tasks">
  description?: unknown
  projectId?: Id<"projects">
  billable: boolean
  workCategoryId?: Id<"workCategories">
  assigneeIds: Id<"users">[]
}

export function TaskDetailOverview({
  task,
  isAdmin,
  onOpenDetail,
}: {
  task: TaskOverviewData
  isAdmin: boolean
  onOpenDetail: (taskId: string) => void
}) {
  const updateTask = useMutation(api.tasks.update)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskIdRef = useRef(task._id)

  const pendingSaveRef = useRef<(() => void) | null>(null)

  // Keep taskId ref in sync — prevents stale closure in debounce
  useEffect(() => {
    taskIdRef.current = task._id
  }, [task._id])

  // Flush pending autosave then clear debounce when task changes (J/K nav)
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        pendingSaveRef.current?.()
      }
    }
  }, [task._id])

  // Cleanup on unmount — flush any pending save
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        pendingSaveRef.current?.()
      }
    }
  }, [])

  // Auto-save description with 1s debounce — uses ref for taskId to prevent stale closure
  const handleDescriptionUpdate = useCallback(
    (content: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const doSave = () => {
        pendingSaveRef.current = null
        void updateTask({
          id: taskIdRef.current,
          description: JSON.stringify(content),
        }).catch(() => {
          // Silently fail — user will see stale content on next load
        })
      }
      pendingSaveRef.current = doSave
      debounceRef.current = setTimeout(doSave, 1000)
    },
    [updateTask],
  )

  // Parse description — could be JSON string or object
  const descriptionContent = (() => {
    if (!task.description) return undefined
    if (typeof task.description === "string") {
      try {
        return JSON.parse(task.description)
      } catch {
        return undefined
      }
    }
    return task.description
  })()

  return (
    <div className="flex flex-col gap-6">
      {/* Description (Tiptap editor) */}
      <TiptapEditor
        content={descriptionContent}
        onUpdate={handleDescriptionUpdate}
      />

      {/* Subtasks */}
      <SubtaskList
        parentTaskId={task._id}
        parentProjectId={task.projectId}
        parentBillable={task.billable}
        parentCategoryId={task.workCategoryId}
        parentAssigneeIds={task.assigneeIds}
        isAdmin={isAdmin}
        onOpenDetail={onOpenDetail}
      />
    </div>
  )
}

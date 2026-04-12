import { useState, useCallback, useEffect } from "react"
import type { InlineCreatedTask } from "@/components/tasks/inline-created-task-row"
import type { Id } from "@/convex/_generated/dataModel"
import { toastError } from "@/lib/toast-helpers"

type DisplayResult = {
  groups: Array<{
    key: string
    tasks: Array<{ _id: Id<"tasks"> }>
  }>
}

type CreateTaskMutation = (args: {
  title: string
  projectId?: Id<"projects">
  workCategoryId?: Id<"workCategories">
  statusId?: Id<"statuses">
  assigneeIds?: Id<"users">[]
  dueDate?: string
}) => Promise<Id<"tasks">>

export function useInlineDraftTasks(deps: {
  displayResult: DisplayResult | undefined
  filtersKey: string
  createTask: CreateTaskMutation
}) {
  const { displayResult, filtersKey, createTask } = deps

  const [inlineCreatedTasks, setInlineCreatedTasks] = useState<Record<string, InlineCreatedTask[]>>({})

  // Clear drafts when filters change
  useEffect(() => {
    setInlineCreatedTasks({})
  }, [filtersKey])

  // Remove drafts once they appear in server data
  useEffect(() => {
    if (!displayResult) return

    const visibleTaskIds = new Set(
      displayResult.groups.flatMap((group) => group.tasks.map((task) => task._id))
    )

    setInlineCreatedTasks((prev) => {
      let changed = false
      const next: Record<string, InlineCreatedTask[]> = {}

      for (const [groupKey, drafts] of Object.entries(prev)) {
        const remaining = drafts.filter((draft) => {
          const shouldKeep = !draft.serverId || !visibleTaskIds.has(draft.serverId)
          if (!shouldKeep) changed = true
          return shouldKeep
        })

        if (remaining.length > 0) {
          next[groupKey] = remaining
        } else if (drafts.length > 0) {
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [displayResult])

  const handleInlineTaskCreated = useCallback((task: InlineCreatedTask) => {
    setInlineCreatedTasks((prev) => ({
      ...prev,
      [task.groupKey]: [...(prev[task.groupKey] ?? []), task],
    }))
  }, [])

  const handleInlineTaskSettled = useCallback((
    groupKey: string,
    localId: string,
    result: { serverId?: Id<"tasks">; error?: boolean },
  ) => {
    setInlineCreatedTasks((prev) => {
      const groupTasks = prev[groupKey]
      if (!groupTasks) return prev

      const nextGroupTasks = groupTasks.map((task) => {
        if (task.localId !== localId) return task
        return {
          ...task,
          serverId: result.serverId ?? task.serverId,
          saveState: result.error ? "error" as const : "saved" as const,
        }
      })

      return {
        ...prev,
        [groupKey]: nextGroupTasks,
      }
    })
  }, [])

  const handleDismissDraft = useCallback((localId: string) => {
    setInlineCreatedTasks((prev) => {
      const next: Record<string, InlineCreatedTask[]> = {}
      let changed = false
      for (const [groupKey, drafts] of Object.entries(prev)) {
        const remaining = drafts.filter((d) => d.localId !== localId)
        if (remaining.length !== drafts.length) changed = true
        if (remaining.length > 0) next[groupKey] = remaining
      }
      return changed ? next : prev
    })
  }, [])

  const handleRetryDraft = useCallback((draft: InlineCreatedTask) => {
    const newLocalId = crypto.randomUUID()

    // Replace old draft with new saving draft
    setInlineCreatedTasks((prev) => {
      const groupDrafts = prev[draft.groupKey]
      if (!groupDrafts) return prev
      return {
        ...prev,
        [draft.groupKey]: groupDrafts.map((d) =>
          d.localId === draft.localId
            ? { ...d, localId: newLocalId, saveState: "saving" as const, serverId: undefined }
            : d,
        ),
      }
    })

    // Rebuild mutation args from draft data
    const args: {
      title: string
      projectId?: Id<"projects">
      workCategoryId?: Id<"workCategories">
      statusId?: Id<"statuses">
      assigneeIds?: Id<"users">[]
      dueDate?: string
    } = { title: draft.title }

    if (draft.status) args.statusId = draft.status._id
    if (draft.category) args.workCategoryId = draft.category._id
    if (draft.project) args.projectId = draft.project._id
    if (draft.assignees.length > 0) args.assigneeIds = draft.assignees.map((a) => a._id)
    if (draft.dueDate) args.dueDate = draft.dueDate

    void createTask(args)
      .then((taskId) => {
        handleInlineTaskSettled(draft.groupKey, newLocalId, { serverId: taskId })
      })
      .catch((err) => {
        handleInlineTaskSettled(draft.groupKey, newLocalId, { error: true })
        toastError(err, "Failed to create task")
      })
  }, [createTask, handleInlineTaskSettled])

  return {
    inlineCreatedTasks,
    handleInlineTaskCreated,
    handleInlineTaskSettled,
    handleDismissDraft,
    handleRetryDraft,
  }
}

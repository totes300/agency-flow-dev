"use client"

import { useState, useRef, useEffect } from "react"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import type { InlineCreatedTask } from "@/components/tasks/inline-created-task-row"
import { PlusIcon } from "lucide-react"
import { toastError } from "@/lib/toast-helpers"
import { TASK_GRID_COLS } from "@/components/tasks/tasks-table"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { InlineAddButton } from "@/components/inline-add-button"
import { useInlineAdd } from "@/lib/hooks/use-inline-add"
import type { Doc, Id } from "@/convex/_generated/dataModel"
import type { GroupByOption, TaskTab } from "@/lib/hooks/use-task-filters"

type StatusPick = Pick<Doc<"statuses">, "_id" | "name" | "color" | "type">
type CategoryPick = Pick<Doc<"workCategories">, "_id" | "name" | "color">
type ProjectPick = Pick<Doc<"projects">, "_id" | "name" | "code">
type ClientPick = Pick<Doc<"clients">, "_id" | "name" | "prefix" | "usePrefix">
type UserPick = Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">

export function InlineAddTask({
  groupBy,
  groupKey,
  isAdmin,
  tab,
  onCreateInlineTask,
  onInlineTaskSettled,
}: {
  groupBy: GroupByOption
  groupKey: string
  isAdmin: boolean
  tab: TaskTab
  onCreateInlineTask?: (task: InlineCreatedTask) => void
  onInlineTaskSettled?: (
    groupKey: string,
    localId: string,
    result: { serverId?: Id<"tasks">; error?: boolean },
  ) => void
}) {
  const [status, setStatus] = useState<StatusPick | null>(null)
  const [category, setCategory] = useState<CategoryPick | null>(null)
  const [project, setProject] = useState<ProjectPick | null>(null)
  const [client, setClient] = useState<ClientPick | null>(null)
  const [assignees, setAssignees] = useState<UserPick[]>([])
  const assigneesManuallySet = useRef(false)
  const [dueDate, setDueDate] = useState<string | null>(null)
  const lastSubmitRef = useRef(0)
  const createTask = useMutation(api.tasks.create)

  const { statuses, categories, projects, orgMembers } = useTaskReferenceData()

  /**
   * Sync the assignee field to the default assignee for the current (project, category) pair.
   * - If match found → set assignee
   * - If no match → clear assignee (previous auto-fill no longer relevant)
   * - If user manually picked an assignee → do nothing
   */
  function syncDefaultAssignee(
    projectId: Id<"projects"> | null | undefined,
    categoryId: Id<"workCategories"> | null | undefined,
  ) {
    if (assigneesManuallySet.current) return
    if (!projectId || !categoryId || !projects || !orgMembers) {
      setAssignees([])
      return
    }
    const proj = projects.find((p) => p._id === projectId)
    const match = (proj?.defaultAssignees as Array<{ workCategoryId: Id<"workCategories">; userId: Id<"users"> }> | undefined)
      ?.find((da) => da.workCategoryId === categoryId)
    const member = match ? orgMembers.find((m) => m._id === match.userId) : null
    if (member) {
      setAssignees([{ _id: member._id, name: member.name, email: member.email, imageUrl: member.imageUrl }])
    } else {
      setAssignees([])
    }
  }

  function resetFields() {
    if (groupBy !== "status") setStatus(null)
    if (groupBy !== "category") setCategory(null)
    if (groupBy !== "project") { setProject(null); setClient(null) }
    if (groupBy !== "assignee") setAssignees([])
    assigneesManuallySet.current = false
    setDueDate(null)
  }

  const hasPrefilled = useRef(false)

  const { active, title, setTitle, inputRef, activate, deactivate, handleKeyDown: hookHandleKeyDown } =
    useInlineAdd((trimmed) => {
      const now = Date.now()
      if (now - lastSubmitRef.current < 100) return
      lastSubmitRef.current = now

      const args: {
        title: string
        projectId?: Id<"projects">
        workCategoryId?: Id<"workCategories">
        statusId?: Id<"statuses">
        assigneeIds?: Id<"users">[]
        dueDate?: string
      } = { title: trimmed }

      if (status) args.statusId = status._id
      if (category) args.workCategoryId = category._id
      if (project) args.projectId = project._id
      if (assignees.length > 0) args.assigneeIds = assignees.map((a) => a._id)
      if (dueDate) args.dueDate = dueDate

      if (groupBy && groupKey && !groupKey.startsWith("__")) {
        switch (groupBy) {
          case "project":
            if (!args.projectId) args.projectId = groupKey as Id<"projects">
            break
          case "category":
            if (!args.workCategoryId) args.workCategoryId = groupKey as Id<"workCategories">
            break
          case "status":
            if (!args.statusId) args.statusId = groupKey as Id<"statuses">
            break
          case "assignee":
            if (!args.assigneeIds) args.assigneeIds = [groupKey as Id<"users">]
            break
        }
      }

      if (!args.statusId) {
        const tabType = tab === "all" ? "backlog" : tab
        const defaultStatus = statuses?.find((s) => s.type === tabType)
        if (defaultStatus) args.statusId = defaultStatus._id
      }

      const resolvedStatus = status ?? (
        args.statusId
          ? (() => {
              const match = statuses?.find((s) => s._id === args.statusId)
              return match
                ? { _id: match._id, name: match.name, color: match.color, type: match.type }
                : null
            })()
          : null
      )

      const localId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `inline-${Date.now()}-${Math.random().toString(36).slice(2)}`

      onCreateInlineTask?.({
        localId,
        groupKey,
        title: trimmed,
        createdAt: Date.now(),
        status: resolvedStatus,
        category,
        project,
        client,
        assignees,
        dueDate,
        saveState: "saving",
      })

      resetFields()

      void createTask(args)
        .then((taskId) => {
          onInlineTaskSettled?.(groupKey, localId, { serverId: taskId })
        })
        .catch((err) => {
          onInlineTaskSettled?.(groupKey, localId, { error: true })
          toastError(err, "Failed to create task")
        })
    })

  // Pre-fill from group context once queries load
  useEffect(() => {
    if (!active || hasPrefilled.current) return
    if (!groupBy || !groupKey || groupKey.startsWith("__")) return

    switch (groupBy) {
      case "status": {
        if (!statuses) return
        const s = statuses.find((st) => st._id === groupKey)
        if (s) setStatus({ _id: s._id, name: s.name, color: s.color, type: s.type })
        break
      }
      case "category": {
        if (!categories) return
        const c = categories.find((cat) => cat._id === groupKey)
        if (c) setCategory({ _id: c._id, name: c.name, color: c.color })
        break
      }
      case "project": {
        if (!projects) return
        const p = projects.find((pr) => pr._id === groupKey)
        if (p) {
          setProject({ _id: p._id, name: p.name, code: p.code })
          setClient({ _id: p.clientId as Id<"clients">, name: p.clientName ?? "Unknown", prefix: p.clientPrefix ?? "", usePrefix: p.clientUsePrefix })
        }
        break
      }
      case "assignee": {
        if (!orgMembers) return
        const m = orgMembers.find((u) => u._id === groupKey)
        if (m) setAssignees([{ _id: m._id, name: m.name, email: m.email, imageUrl: m.imageUrl }])
        break
      }
    }
    hasPrefilled.current = true
  }, [active, groupBy, groupKey, statuses, categories, projects, orgMembers])

  // Wrap the hook's handleKeyDown to add component-level cleanup on Escape
  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      resetFields()
      hasPrefilled.current = false
      deactivate()
      return
    }
    hookHandleKeyDown(e)
  }

  // Row-level blur: only deactivate when focus leaves the entire row (not just the input)
  function handleRowBlur(e: React.FocusEvent) {
    const relatedTarget = e.relatedTarget as HTMLElement | null
    // If focus moves to another element inside this row or its popovers, stay open
    if (relatedTarget && (rowRef.current?.contains(relatedTarget) || relatedTarget.closest?.("[role='dialog'], [cmdk-list], [cmdk-input]"))) {
      return
    }
    // Focus left the row entirely — close if title is empty
    if (!title.trim()) {
      resetFields()
      hasPrefilled.current = false
      deactivate()
    }
  }

  // Document-level Enter/Escape scoped to this row (for focus on inline cells, not input)
  const rowRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef(() => {})
  submitRef.current = () => {
    const trimmed = title.trim()
    if (trimmed) {
      setTitle("")
      // Trigger the onSubmit callback through the hook isn't possible here,
      // so we simulate Enter on the input
      inputRef.current?.focus()
      inputRef.current?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      )
    }
  }

  useEffect(() => {
    if (!active) return
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.closest?.("[role='dialog'], [cmdk-list], [cmdk-input]")) return
      if (rowRef.current && !rowRef.current.contains(target)) return
      if (target === inputRef.current) return // input handles its own keys via hook

      if (e.key === "Enter") {
        e.preventDefault()
        submitRef.current()
      } else if (e.key === "Escape") {
        resetFields()
        hasPrefilled.current = false
        deactivate()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [active, deactivate])

  function handleAssigneeToggle(_userId: Id<"users">, member: UserPick) {
    assigneesManuallySet.current = true
    setAssignees((prev) => {
      const exists = prev.some((a) => a._id === member._id)
      return exists ? prev.filter((a) => a._id !== member._id) : [...prev, member]
    })
  }

  if (!active) {
    return <InlineAddButton onClick={activate} />
  }

  return (
    <div
      ref={rowRef}
      onBlur={handleRowBlur}
      className={`group/row relative grid ${TASK_GRID_COLS} items-center gap-x-6 border-b border-border/40 pr-3 py-2.5 before:pointer-events-none before:absolute before:inset-y-0 before:-left-12 before:w-12 [&>*]:min-w-0 [&>*]:overflow-hidden`}
    >
      <div className="flex items-center gap-1.5">
        <PlusIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
        <input
          ref={inputRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder="Task name..."
          aria-label="New task title"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      <div />

      <InlineStatusCell
        status={status}
        isAdmin={isAdmin}
        onSelect={(_id, s) => setStatus(s)}
      />

      <InlineCategoryCell
        category={category}
        onSelect={(catId, c) => {
          setCategory(c)
          syncDefaultAssignee(project?._id, catId)
        }}
      />

      <InlineProjectCell
        project={project}
        client={client}
        onSelect={(projId, p, c) => {
          setProject(p)
          setClient(c)
          syncDefaultAssignee(projId, category?._id)
        }}
      />

      <InlineAssigneeCell
        assignees={assignees}
        onToggle={handleAssigneeToggle}
      />

      <InlineDueDateCell
        dueDate={dueDate}
        onSelect={(d) => setDueDate(d)}
      />

      <div />
      <div />
    </div>
  )
}

"use client"

import { useState, useRef, useCallback, useEffect } from "react"
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
import type { Doc, Id } from "@/convex/_generated/dataModel"
import type { GroupByOption, TaskTab } from "@/lib/hooks/use-task-filters"

type StatusPick = Pick<Doc<"statuses">, "_id" | "name" | "color" | "type">
type CategoryPick = Pick<Doc<"workCategories">, "_id" | "name" | "color">
type ProjectPick = Pick<Doc<"projects">, "_id" | "name" | "code">
type ClientPick = Pick<Doc<"clients">, "_id" | "name">
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
  const [active, setActive] = useState(false)
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<StatusPick | null>(null)
  const [category, setCategory] = useState<CategoryPick | null>(null)
  const [project, setProject] = useState<ProjectPick | null>(null)
  const [client, setClient] = useState<ClientPick | null>(null)
  const [assignees, setAssignees] = useState<UserPick[]>([])
  const [dueDate, setDueDate] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastSubmitRef = useRef(0)
  const createTask = useMutation(api.tasks.create)

  // Reference data from page-level context (no per-row subscriptions)
  const { statuses, categories, projects, orgMembers } = useTaskReferenceData()

  const activate = useCallback(() => {
    setActive(true)
  }, [])

  // Pre-fill from group context once queries load
  const hasPrefilled = useRef(false)
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
          setClient({ _id: p.clientId as Id<"clients">, name: p.clientName ?? "Unknown" })
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

  function resetFields() {
    setTitle("")
    // Keep group-inherited values, clear everything else
    if (groupBy !== "status") setStatus(null)
    if (groupBy !== "category") setCategory(null)
    if (groupBy !== "project") { setProject(null); setClient(null) }
    if (groupBy !== "assignee") setAssignees([])
    setDueDate(null)
  }

  async function handleSubmit() {
    const trimmed = title.trim()
    const now = Date.now()
    if (!trimmed || now - lastSubmitRef.current < 100) return
    lastSubmitRef.current = now

    const args: {
      title: string
      projectId?: Id<"projects">
      workCategoryId?: Id<"workCategories">
      statusId?: Id<"statuses">
      assigneeIds?: Id<"users">[]
      dueDate?: string
    } = { title: trimmed }

    // Explicit inline selections take priority
    if (status) args.statusId = status._id
    if (category) args.workCategoryId = category._id
    if (project) args.projectId = project._id
    if (assignees.length > 0) args.assigneeIds = assignees.map((a) => a._id)
    if (dueDate) args.dueDate = dueDate

    // Group-inherited defaults (only if not explicitly set)
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

    // Tab-based status fallback: if still no status, use first status of current tab's type
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
    requestAnimationFrame(() => {
      inputRef.current?.focus()
    })

    void createTask(args)
      .then((taskId) => {
        onInlineTaskSettled?.(groupKey, localId, { serverId: taskId })
      })
      .catch((err) => {
        onInlineTaskSettled?.(groupKey, localId, { error: true })
        toastError(err, "Failed to create task")
      })
  }

  // Ref to always have latest submit/reset without re-registering listener
  const submitRef = useRef(handleSubmit)
  const resetRef = useRef(resetFields)
  submitRef.current = handleSubmit
  resetRef.current = resetFields

  // Enter/Escape when the add row is active — scoped to this row
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      // Only handle keys from within this row or its popovers
      const insidePopover = target.closest?.("[role='dialog'], [cmdk-list], [cmdk-input]")
      if (insidePopover) return
      if (rowRef.current && !rowRef.current.contains(target)) return

      if (e.key === "Enter") {
        e.preventDefault()
        submitRef.current()
      } else if (e.key === "Escape") {
        resetRef.current()
        hasPrefilled.current = false
        setActive(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [active])

  function handleAssigneeToggle(_userId: Id<"users">, member: UserPick) {
    setAssignees((prev) => {
      const exists = prev.some((a) => a._id === member._id)
      return exists ? prev.filter((a) => a._id !== member._id) : [...prev, member]
    })
  }

  if (!active) {
    return (
      <button
        onClick={activate}
        className="flex w-full items-center gap-1.5 py-2 pr-3 text-[13px] text-muted-foreground/40 transition-colors hover:bg-muted/30 hover:text-muted-foreground/60"
      >
        <PlusIcon className="size-3.5" />
        Add task...
      </button>
    )
  }

  return (
    <div
      ref={rowRef}
      className={`group/row relative grid ${TASK_GRID_COLS} items-center gap-x-6 border-b border-border/40 pr-3 py-2.5 before:pointer-events-none before:absolute before:inset-y-0 before:-left-13 before:w-13 [&>*]:min-w-0 [&>*]:overflow-hidden`}
    >
      {/* Task title input */}
      <div className="flex items-center gap-1.5">
        <PlusIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
        <input
          ref={inputRef}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task name..."
          aria-label="New task title"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
        />
      </div>

      {/* Activity — empty */}
      <div />

      {/* Status */}
      <InlineStatusCell
        status={status}
        isAdmin={isAdmin}
        onSelect={(_id, s) => setStatus(s)}
      />

      {/* Category */}
      <InlineCategoryCell
        category={category}
        onSelect={(_id, c) => setCategory(c)}
      />

      {/* Project */}
      <InlineProjectCell
        project={project}
        client={client}
        onSelect={(_id, p, c) => { setProject(p); setClient(c) }}
      />

      {/* Assignee */}
      <InlineAssigneeCell
        assignees={assignees}
        onToggle={handleAssigneeToggle}
      />

      {/* Due date */}
      <InlineDueDateCell
        dueDate={dueDate}
        onSelect={(d) => setDueDate(d)}
      />

      {/* Time — empty */}
      <div />

      {/* Menu — empty */}
      <div />
    </div>
  )
}

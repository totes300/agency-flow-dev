"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { UserAvatar } from "@/components/user-avatar"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { Switch } from "@/components/ui/switch"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import { useMutation, useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { TaskPlanSection } from "@/components/planner/task-plan-section"
import { formatDuration, parseDuration } from "@/lib/duration"
import { isOverdue } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import {
  CircleCheckIcon,
  UsersIcon,
  FolderIcon,
  TagIcon,
  CalendarIcon,
  ClockIcon,
  DollarSignIcon,
  TimerIcon,
  UserIcon,
  CalendarPlusIcon,
  CheckIcon,
} from "lucide-react"
import type { Id, Doc } from "@/convex/_generated/dataModel"

type TaskDetailData = {
  _id: Id<"tasks">
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type"> | null
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null
  client: Pick<Doc<"clients">, "_id" | "name" | "prefix" | "usePrefix"> | null
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  statusType: string
  dueDate?: string
  estimate?: number
  billable: boolean
  totalMinutes?: number
  createdByUser?: Pick<Doc<"users">, "_id" | "name" | "imageUrl"> | null
  createdAt?: number
}

export function MetadataRow({
  icon: Icon,
  label,
  children,
  variant = "inline",
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  children: React.ReactNode
  variant?: "inline" | "stacked"
}) {
  if (variant === "stacked") {
    return (
      <div className="group/metadata py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-[0.01em]">{label}</span>
        <div className="mt-1 min-w-0 rounded-md py-0.5 text-[13px] font-normal text-foreground transition-colors hover:bg-accent -mx-2 px-2 cursor-default">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex items-center min-h-9 py-1">
      <div className="flex items-center gap-2.5 w-[130px] shrink-0">
        <Icon className="size-4 text-foreground/50" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-foreground/70">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-2 py-1 -mx-2 rounded-md transition-colors hover:bg-accent cursor-default">{children}</div>
    </div>
  )
}

export function TaskDetailMetadata({
  task,
  isAdmin,
  layout = "grid",
}: {
  task: TaskDetailData
  isAdmin: boolean
  layout?: "grid" | "stack"
}) {
  const updateTask = useMutation(api.tasks.update)
  const bulkUpdateBillable = useMutation(api.timeEntries.bulkUpdateBillable)
  const overdue = isOverdue(task.dueDate)

  // Billable toggle with confirmation dialog
  const [billableDialog, setBillableDialog] = useState<{ open: boolean; target: boolean }>({
    open: false, target: false,
  })

  // Count mismatched entries (only query when we need it — after toggle)
  const mismatchedCount = useQuery(api.timeEntries.countMismatchedBillable, {
    taskId: task._id,
    targetBillable: !task.billable,
  })

  const handleBillableChange = useCallback(async (checked: boolean) => {
    // Query still loading — don't act yet
    if (mismatchedCount === undefined) return
    if (mismatchedCount > 0) {
      setBillableDialog({ open: true, target: checked })
      return
    }
    // No mismatched entries — just toggle
    try {
      await updateTask({ id: task._id, billable: checked })
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }, [mismatchedCount, task._id, updateTask])

  async function handleBillableConfirm(updateEntries: boolean) {
    const { target } = billableDialog
    try {
      await updateTask({ id: task._id, billable: target })
      if (updateEntries) {
        await bulkUpdateBillable({ taskId: task._id, isBillable: target })
      }
    } catch (err) {
      toastError(err, "Failed to update")
    }
    setBillableDialog({ open: false, target: false })
  }

  return (
    <div className={cn(layout === "stack" ? "flex min-h-full flex-col px-[18px] pb-5" : "shrink-0 px-7 pb-6")}>
      {layout === "grid" ? (
        <div className="grid grid-cols-2 gap-x-0">
          {/* Left column */}
          <div className="flex flex-col pr-6 border-r border-border/50">
            <MetadataRow icon={CircleCheckIcon} label="Status">
              <InlineStatusCell taskId={task._id} status={task.status} isAdmin={isAdmin} />
            </MetadataRow>
            <MetadataRow icon={UsersIcon} label="Assignees">
              <InlineAssigneeCell taskId={task._id} assignees={task.assignees} emptyLabel="Add assignee" />
            </MetadataRow>
            <MetadataRow icon={TagIcon} label="Category">
              <InlineCategoryCell taskId={task._id} category={task.category} emptyLabel="Add category" />
            </MetadataRow>
            <MetadataRow icon={CalendarIcon} label="Due date">
              <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={overdue} emptyLabel="Add due date" />
            </MetadataRow>
          </div>

          {/* Right column */}
          <div className="flex flex-col pl-6">
            <MetadataRow icon={FolderIcon} label="Project">
              <InlineProjectCell taskId={task._id} project={task.project} client={task.client} emptyLabel="Add project" />
            </MetadataRow>
            <MetadataRow icon={ClockIcon} label="Estimate">
              <InlineEstimateCell taskId={task._id} estimate={task.estimate} />
            </MetadataRow>
            <MetadataRow icon={TimerIcon} label="Tracked">
              <div className="group/row">
                <InlineTimeCell
                  taskId={task._id}
                  totalMinutes={task.totalMinutes ?? 0}
                  isDone={task.statusType === "done"}
                  isBillable={task.billable}
                />
              </div>
            </MetadataRow>
            <MetadataRow icon={DollarSignIcon} label="Billable">
              <div className="flex items-center gap-2">
                <Switch
                  checked={task.billable}
                  onCheckedChange={handleBillableChange}
                  disabled={!isAdmin || mismatchedCount === undefined}
                  aria-label="Billable"
                  className="scale-[0.8] origin-left"
                />
                <span className="text-[13px] text-muted-foreground">
                  {task.billable ? "Yes" : "No"}
                </span>
              </div>
            </MetadataRow>
          </div>

          {/* Plan section — the task's Planner sittings (Phase 10) */}
          <div className="col-span-2 mt-2 border-t border-border/50 pt-2">
            <TaskPlanSection taskId={task._id} isAdmin={isAdmin} variant="inline" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="pb-4 pt-8">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">Properties</span>
          </div>

          {/* Group 1: Status, Assignees, Category */}
          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={CircleCheckIcon} label="Status" variant="stacked">
              <InlineStatusCell taskId={task._id} status={task.status} isAdmin={isAdmin} />
            </MetadataRow>
            <MetadataRow icon={UsersIcon} label="Assignees" variant="stacked">
              <InlineAssigneeCell taskId={task._id} assignees={task.assignees} emptyLabel="Add assignee" />
            </MetadataRow>
            <MetadataRow icon={TagIcon} label="Category" variant="stacked">
              <InlineCategoryCell taskId={task._id} category={task.category} emptyLabel="Add category" />
            </MetadataRow>
          </div>

          {/* Group 2: Due date, Estimate, Tracked */}
          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={CalendarIcon} label="Due date" variant="stacked">
              <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={overdue} emptyLabel="Add due date" />
            </MetadataRow>
            <MetadataRow icon={ClockIcon} label="Estimate" variant="stacked">
              <InlineEstimateCell taskId={task._id} estimate={task.estimate} />
            </MetadataRow>
            <MetadataRow icon={TimerIcon} label="Tracked" variant="stacked">
              <span className="text-[13px] text-foreground">
                {formatDuration(task.totalMinutes ?? 0)}
              </span>
            </MetadataRow>
          </div>

          {/* Group 3: Billable, Project */}
          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={DollarSignIcon} label="Billing" variant="stacked">
              <InlineBillableSelect billable={task.billable} isAdmin={isAdmin} onChange={handleBillableChange} disabled={mismatchedCount === undefined} />
            </MetadataRow>
            <MetadataRow icon={FolderIcon} label="Project" variant="stacked">
              <InlineProjectCell taskId={task._id} project={task.project} client={task.client} emptyLabel="Add project" />
            </MetadataRow>
          </div>

          {/* Group 4: Plan — the task's Planner sittings (Phase 10) */}
          <div className="mb-4 border-b border-border/40 pb-4">
            <TaskPlanSection taskId={task._id} isAdmin={isAdmin} variant="stacked" />
          </div>

          {/* Group 5: Created by, Created on */}
          <div>
            {task.createdByUser && (
              <MetadataRow icon={UserIcon} label="Created by" variant="stacked">
                <div className="flex items-center gap-1.5">
                  <UserAvatar
                    name={task.createdByUser.name ?? "?"}
                    imageUrl={task.createdByUser.imageUrl}
                    className="size-5 text-[8px]"
                  />
                  <span className="text-[13px] text-foreground">
                    {task.createdByUser.name}
                  </span>
                </div>
              </MetadataRow>
            )}
            {task.createdAt && (
              <MetadataRow icon={CalendarPlusIcon} label="Created on" variant="stacked">
                <span className="text-[13px] text-foreground">
                  {new Date(task.createdAt).toLocaleDateString(undefined, {
                    month: "short", day: "numeric", year: "numeric",
                  })}
                </span>
              </MetadataRow>
            )}
          </div>
        </div>
      )}

      {/* Billable cascade confirmation */}
      <AlertDialog
        open={billableDialog.open}
        onOpenChange={(open) => { if (!open) setBillableDialog((s) => ({ ...s, open: false })) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update existing time entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This task has {mismatchedCount ?? 0} time{" "}
              {(mismatchedCount ?? 0) === 1 ? "entry" : "entries"} marked as{" "}
              {billableDialog.target ? "non-billable" : "billable"}.
              Would you like to update them too?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="outline"
              onClick={() => handleBillableConfirm(false)}
            >
              Only future entries
            </AlertDialogAction>
            <AlertDialogAction onClick={() => handleBillableConfirm(true)}>
              Update all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Inline estimate editor ──────────────────────────────────────────────────────

export function InlineEstimateCell({
  taskId,
  estimate,
}: {
  taskId: Id<"tasks">
  estimate?: number
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const updateTask = useMutation(api.tasks.update)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function handleOpen() {
    setValue(estimate ? formatDuration(estimate) : "")
    setEditing(true)
  }

  async function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) {
      // Clear estimate
      try {
        await updateTask({ id: taskId, estimate: null })
      } catch (err) {
        toastError(err, "Failed to update estimate")
      }
      setEditing(false)
      return
    }

    const minutes = parseDuration(trimmed)
    if (minutes === null) {
      // Invalid input — reset
      setEditing(false)
      return
    }

    if (minutes !== estimate) {
      try {
        await updateTask({ id: taskId, estimate: minutes })
      } catch (err) {
        toastError(err, "Failed to update estimate")
      }
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) handleSave()
          if (e.key === "Escape") setEditing(false)
        }}
        placeholder="e.g. 2h 30m"
        className="h-6 w-full rounded bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={handleOpen}
      className="text-[13px] text-foreground"
    >
      {estimate ? formatDuration(estimate) : (
        <span className="flex items-center gap-1.5 text-foreground/50 transition-colors group-hover/metadata:text-foreground/50">
          <ClockIcon className="size-[17px]" strokeWidth={2} />
          <span className="text-[13px]">Add estimate</span>
        </span>
      )}
    </button>
  )
}

// ─── Inline billable select (dropdown) ───────────────────────────────────────

function InlineBillableSelect({
  billable,
  isAdmin,
  onChange,
  disabled,
}: {
  billable: boolean
  isAdmin: boolean
  onChange: (checked: boolean) => void
  disabled: boolean
}) {
  const label = billable ? "Billable" : "Non-Billable"

  if (!isAdmin) {
    return <span className="text-[13px] text-foreground">{label}</span>
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "text-[13px] text-foreground transition-opacity",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {([
          { value: true, label: "Billable" },
          { value: false, label: "Non-Billable" },
        ] as const).map((opt) => (
          <DropdownMenuItem
            key={opt.label}
            onSelect={() => { if (opt.value !== billable) onChange(opt.value) }}
          >
            {opt.label}
            {opt.value === billable && <CheckIcon className="ml-auto size-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

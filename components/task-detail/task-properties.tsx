"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import {
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  CircleCheckIcon,
  ClockIcon,
  DollarSignIcon,
  FolderIcon,
  SignalIcon,
  SunIcon,
  TagIcon,
  TagsIcon,
  TimerIcon,
  UserIcon,
  UsersIcon,
  CalendarArrowUpIcon,
} from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { PRIORITY_LABELS } from "@/convex/tasks/model"
import { UserAvatar } from "@/components/user-avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { ColoredPillBadge } from "@/components/ui/colored-pill-badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PriorityIcon } from "@/components/icons/priority-icon"
import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { useTaskReferenceData } from "@/components/tasks/task-reference-data"
import { TaskPlanSection } from "@/components/planner/task-plan-section"
import { formatDuration, parseDuration } from "@/lib/duration"
import { formatShortDate, isOverdue } from "@/lib/format"
import { getStatusColor } from "@/lib/status-colors"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import type { PropertyMenuKind } from "@/components/task-view/property-menus"
import type { MemberRef, TaskRowModel } from "@/components/task-view/row-model"
import type { DetailSun, TaskDetailDTO } from "@/components/task-detail/use-task-detail"

export type PropertiesLayout = "stack" | "sidebar"

/**
 * One property row. `stacked` = label above the value (the drawer's
 * property column); `sidebar` = label left, value right (the full page's
 * Linear-style sidebar); `inline` = icon + label left (kept for callers).
 */
export function MetadataRow({
  icon: Icon,
  label,
  children,
  variant = "inline",
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  children: React.ReactNode
  variant?: "inline" | "stacked" | "sidebar"
}) {
  if (variant === "stacked") {
    return (
      <div className="group/metadata py-1.5">
        <span className="text-[11px] font-medium text-muted-foreground tracking-[0.01em]">{label}</span>
        <div className="mt-1 min-w-0 rounded-md py-0.5 text-[13px] font-normal text-foreground transition-colors hover:bg-accent -mx-2 px-2 cursor-default">{children}</div>
      </div>
    )
  }

  if (variant === "sidebar") {
    return (
      <div className="group/metadata grid min-h-8 grid-cols-[92px_minmax(0,1fr)] items-center">
        <span className="truncate pl-1.5 text-[13px] text-muted-foreground">{label}</span>
        <div className="min-w-0 rounded-md px-1.5 py-1 text-[13px] text-foreground transition-colors hover:bg-accent">{children}</div>
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

/**
 * The single task property panel (docs/prd-tasks-refactor.md §6.2, U9):
 * stacked in the drawer's property column (the current drawer, plus
 * Priority, Labels, Start date and the Today row), as a label-left sidebar on
 * the full page. Status, assignees, category, due date, project, estimate and
 * billing keep the drawer's existing editors; priority, labels and start date
 * open the shared `PropertyMenu`; Today is the sun (D9).
 */
export function TaskProperties({
  task,
  row,
  isAdmin,
  layout,
  sun,
  openMenu,
  memberById,
}: {
  task: TaskDetailDTO
  row: TaskRowModel
  memberById: ReadonlyMap<Id<"users">, MemberRef>
  isAdmin: boolean
  layout: PropertiesLayout
  sun: DetailSun
  openMenu: (kind: PropertyMenuKind, taskId: Id<"tasks">, anchor: HTMLElement) => void
}) {
  const variant = layout === "stack" ? "stacked" : "sidebar"
  const { statuses } = useTaskReferenceData()
  const billable = useBillableToggle(task._id, task.billable)

  // The existing editors take the legacy shapes; names come from workspaceRefs.
  const status = statuses?.find((s) => s._id === task.statusId) ?? null
  const assignees = row.assignees.map((m) => ({
    _id: m._id,
    name: m.name,
    email: m.email ?? undefined,
    imageUrl: m.imageUrl ?? undefined,
  }))
  const project = row.project ? { _id: row.project._id, name: row.project.name, code: row.project.code } : null
  const client = row.client
    ? { _id: row.client._id, name: row.client.name, prefix: row.client.prefix ?? "", usePrefix: row.client.usePrefix }
    : null
  const category = row.workCategory
    ? { _id: row.workCategory._id, name: row.workCategory.name, color: row.workCategory.color }
    : null
  const createdBy = memberById.get(task.createdBy) ?? null
  const open = (kind: PropertyMenuKind) => (e: React.MouseEvent<HTMLElement>) => openMenu(kind, task._id, e.currentTarget)

  const statusCell = status ? (
    <InlineStatusCell taskId={task._id} status={status} isAdmin={isAdmin} />
  ) : (
    <Skeleton className="h-5 w-24" />
  )
  const priorityCell = (
    <PropertyButton onClick={open("priority")} anchor="priority" label={`Priority: ${PRIORITY_LABELS[task.priority]}`}>
      <PriorityIcon priority={task.priority} label={false} />
      <span className={cn(task.priority === 0 && "text-foreground/50")}>
        {task.priority === 0 ? "Set priority" : PRIORITY_LABELS[task.priority]}
      </span>
    </PropertyButton>
  )
  const assigneeCell = <InlineAssigneeCell taskId={task._id} assignees={assignees} emptyLabel="Add assignee" />
  const categoryCell = <InlineCategoryCell taskId={task._id} category={category} emptyLabel="Add category" />
  const labelsCell = (
    <PropertyButton onClick={open("labels")} anchor="labels" label="Labels" wrap>
      {row.labels.length > 0 ? (
        row.labels.map((label) => (
          <ColoredPillBadge
            key={label._id}
            label={label.name}
            leading={<span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: getStatusColor(label.color).dot }} />}
          />
        ))
      ) : (
        <span className="flex items-center gap-1.5 text-foreground/50">
          <TagsIcon className="size-4" strokeWidth={1.75} />
          Add label
        </span>
      )}
    </PropertyButton>
  )
  const startCell = (
    <PropertyButton onClick={open("start")} anchor="start" label="Start date">
      {task.startDate ? (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarIcon className="size-4 opacity-40" strokeWidth={1.75} />
          {formatShortDate(task.startDate)}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-foreground/50">
          <CalendarIcon className="size-4" strokeWidth={1.75} />
          Add start date
        </span>
      )}
    </PropertyButton>
  )
  const dueCell = (
    <InlineDueDateCell
      taskId={task._id}
      dueDate={task.dueDate}
      isOverdue={isOverdue(task.dueDate ?? undefined)}
      emptyLabel="Add due date"
    />
  )
  const estimateCell = <InlineEstimateCell taskId={task._id} estimate={task.estimateMinutes ?? undefined} />
  const billingCell = (
    <InlineBillableSelect billable={task.billable} isAdmin={isAdmin} onChange={billable.change} disabled={billable.loading} />
  )
  const projectCell = <InlineProjectCell taskId={task._id} project={project} client={client} emptyLabel="Add project" />
  const todayRow = sun.state.kind === "hidden" ? null : (
    <MetadataRow icon={SunIcon} label="Today" variant={variant}>
      <TodayCell sun={sun} />
    </MetadataRow>
  )
  const createdRows = (
    <>
      {createdBy ? (
        <MetadataRow icon={UserIcon} label="Created by" variant={variant}>
          <div className="flex items-center gap-1.5">
            <UserAvatar name={createdBy.name} imageUrl={createdBy.imageUrl ?? undefined} className="size-5 text-[8px]" />
            <span className="text-[13px] text-foreground">{createdBy.name}</span>
          </div>
        </MetadataRow>
      ) : null}
      <MetadataRow icon={CalendarPlusIcon} label="Created on" variant={variant}>
        <span className="text-[13px] text-foreground">
          {new Date(task.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </MetadataRow>
    </>
  )

  return (
    <div className={cn(layout === "stack" ? "flex min-h-full flex-col px-[18px] pb-5" : "flex flex-col gap-5 px-3.5 py-4")}>
      {layout === "stack" ? (
        <div className="flex flex-col">
          <div className="pb-4 pt-8">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/60">Properties</span>
          </div>

          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={CircleCheckIcon} label="Status" variant={variant}>{statusCell}</MetadataRow>
            <MetadataRow icon={SignalIcon} label="Priority" variant={variant}>{priorityCell}</MetadataRow>
            <MetadataRow icon={UsersIcon} label="Assignees" variant={variant}>{assigneeCell}</MetadataRow>
            <MetadataRow icon={TagIcon} label="Category" variant={variant}>{categoryCell}</MetadataRow>
            <MetadataRow icon={TagsIcon} label="Labels" variant={variant}>{labelsCell}</MetadataRow>
          </div>

          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={CalendarArrowUpIcon} label="Start date" variant={variant}>{startCell}</MetadataRow>
            <MetadataRow icon={CalendarIcon} label="Due date" variant={variant}>{dueCell}</MetadataRow>
            <MetadataRow icon={ClockIcon} label="Estimate" variant={variant}>{estimateCell}</MetadataRow>
            <MetadataRow icon={TimerIcon} label="Tracked" variant={variant}>
              <span className="text-[13px] text-foreground">{formatDuration(task.trackedMinutes)}</span>
            </MetadataRow>
          </div>

          <div className="pb-4 mb-4 border-b border-border/40">
            <MetadataRow icon={DollarSignIcon} label="Billing" variant={variant}>{billingCell}</MetadataRow>
            <MetadataRow icon={FolderIcon} label="Project" variant={variant}>{projectCell}</MetadataRow>
          </div>

          <div className="mb-4 border-b border-border/40 pb-4">
            {todayRow}
            <TaskPlanSection taskId={task._id} isAdmin={isAdmin} variant="stacked" />
          </div>

          <div>{createdRows}</div>
        </div>
      ) : (
        <>
          <SidebarGroup title="Properties">
            <MetadataRow icon={CircleCheckIcon} label="Status" variant={variant}>{statusCell}</MetadataRow>
            <MetadataRow icon={SignalIcon} label="Priority" variant={variant}>{priorityCell}</MetadataRow>
            <MetadataRow icon={UsersIcon} label="Assignees" variant={variant}>{assigneeCell}</MetadataRow>
            <MetadataRow icon={TagsIcon} label="Labels" variant={variant}>{labelsCell}</MetadataRow>
          </SidebarGroup>
          <SidebarGroup title="Work">
            <MetadataRow icon={FolderIcon} label="Project" variant={variant}>{projectCell}</MetadataRow>
            <MetadataRow icon={TagIcon} label="Category" variant={variant}>{categoryCell}</MetadataRow>
            <MetadataRow icon={DollarSignIcon} label="Billing" variant={variant}>{billingCell}</MetadataRow>
          </SidebarGroup>
          <SidebarGroup title="Schedule">
            <MetadataRow icon={CalendarArrowUpIcon} label="Start date" variant={variant}>{startCell}</MetadataRow>
            <MetadataRow icon={CalendarIcon} label="Due date" variant={variant}>{dueCell}</MetadataRow>
            {todayRow}
            {/* The sittings list needs the full width: label above, like the drawer. */}
            <div className="px-1.5">
              <TaskPlanSection taskId={task._id} isAdmin={isAdmin} variant="stacked" />
            </div>
          </SidebarGroup>
          <SidebarGroup title="Time">
            <MetadataRow icon={ClockIcon} label="Estimate" variant={variant}>{estimateCell}</MetadataRow>
            <MetadataRow icon={TimerIcon} label="Tracked" variant={variant}>
              <div className="group/row -ml-1">
                <InlineTimeCell
                  taskId={task._id}
                  totalMinutes={task.trackedMinutes}
                  isDone={row.isClosed}
                  isBillable={task.billable}
                />
              </div>
            </MetadataRow>
          </SidebarGroup>
          <SidebarGroup title="Details">{createdRows}</SidebarGroup>
        </>
      )}

      <AlertDialog open={billable.dialog.open} onOpenChange={(o) => { if (!o) billable.dismiss() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update existing time entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This task has {billable.mismatchedCount ?? 0} time{" "}
              {(billable.mismatchedCount ?? 0) === 1 ? "entry" : "entries"} marked as{" "}
              {billable.dialog.target ? "non-billable" : "billable"}.
              Would you like to update them too?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="outline" onClick={() => billable.confirm(false)}>
              Only future entries
            </AlertDialogAction>
            <AlertDialogAction onClick={() => billable.confirm(true)}>Update all</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SidebarGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h4 className="mb-1 px-1.5 text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </div>
  )
}

/** A quiet value button that opens the shared property menu. */
function PropertyButton({
  onClick,
  anchor,
  label,
  wrap = false,
  children,
}: {
  onClick: (e: React.MouseEvent<HTMLElement>) => void
  anchor: PropertyMenuKind
  label: string
  wrap?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-menu-anchor={anchor}
      onClick={onClick}
      className={cn("flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[13px]", wrap && "flex-wrap gap-1")}
    >
      {children}
    </button>
  )
}

/** "Add to {whose} today" / "In {whose} today" / "Assign first" (D9, `sun.ts`). */
function TodayCell({ sun }: { sun: DetailSun }) {
  const { state } = sun
  if (state.kind === "hidden") return null
  if (state.kind === "disabled") {
    return (
      <span className="flex items-center gap-1.5 py-0.5 text-[13px] text-foreground/50" title={state.label}>
        <SunIcon className="size-4" strokeWidth={1.75} />
        Assign first
      </span>
    )
  }
  const on = state.kind === "on"
  return (
    <button
      type="button"
      onClick={sun.toggle}
      title={state.label}
      aria-pressed={on}
      className={cn("flex w-full min-w-0 items-center gap-1.5 py-0.5 text-left text-[13px]", on ? "text-foreground" : "text-foreground/50")}
    >
      <SunIcon className={cn("size-4 shrink-0", on && "text-warning")} strokeWidth={on ? 2 : 1.75} />
      <span className="truncate">{on ? `In ${sun.whose} today` : `Add to ${sun.whose} today`}</span>
    </button>
  )
}

/** Billable flag + the "update existing entries?" cascade (unchanged behaviour). */
function useBillableToggle(taskId: Id<"tasks">, billable: boolean) {
  const updateTask = useMutation(api.tasks.update)
  const bulkUpdateBillable = useMutation(api.timeEntries.bulkUpdateBillable)
  const [dialog, setDialog] = useState<{ open: boolean; target: boolean }>({ open: false, target: false })
  const mismatchedCount = useQuery(api.timeEntries.countMismatchedBillable, { taskId, targetBillable: !billable })

  const change = useCallback(
    async (checked: boolean) => {
      if (mismatchedCount === undefined) return
      if (mismatchedCount > 0) {
        setDialog({ open: true, target: checked })
        return
      }
      try {
        await updateTask({ id: taskId, billable: checked })
      } catch (err) {
        toastError(err, "Failed to update")
      }
    },
    [mismatchedCount, taskId, updateTask],
  )

  const confirm = useCallback(
    async (updateEntries: boolean) => {
      const { target } = dialog
      try {
        await updateTask({ id: taskId, billable: target })
        if (updateEntries) await bulkUpdateBillable({ taskId, isBillable: target })
      } catch (err) {
        toastError(err, "Failed to update")
      }
      setDialog({ open: false, target: false })
    },
    [bulkUpdateBillable, dialog, taskId, updateTask],
  )

  return {
    dialog,
    mismatchedCount,
    loading: mismatchedCount === undefined,
    change,
    confirm,
    dismiss: () => setDialog((s) => ({ ...s, open: false })),
  }
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

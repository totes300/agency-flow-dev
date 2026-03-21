"use client"

import { InlineStatusCell } from "@/components/tasks/inline-status-cell"
import { InlineAssigneeCell } from "@/components/tasks/inline-assignee-cell"
import { InlineProjectCell } from "@/components/tasks/inline-project-cell"
import { InlineCategoryCell } from "@/components/tasks/inline-category-cell"
import { InlineDueDateCell } from "@/components/tasks/inline-due-date-cell"
import { Switch } from "@/components/ui/switch"
import { useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { formatDuration } from "@/lib/duration"
import { isOverdue } from "@/lib/format"
import { toastError } from "@/lib/toast-helpers"
import {
  CircleCheckIcon,
  UsersIcon,
  FolderIcon,
  TagIcon,
  CalendarIcon,
  ClockIcon,
  DollarSignIcon,
  TimerIcon,
} from "lucide-react"
import type { Id, Doc } from "@/convex/_generated/dataModel"

type TaskDetailData = {
  _id: Id<"tasks">
  status: Pick<Doc<"statuses">, "_id" | "name" | "color" | "type"> | null
  assignees: Array<Pick<Doc<"users">, "_id" | "name" | "email" | "imageUrl">>
  project: Pick<Doc<"projects">, "_id" | "name" | "code"> | null
  client: Pick<Doc<"clients">, "_id" | "name"> | null
  category: Pick<Doc<"workCategories">, "_id" | "name" | "color"> | null
  statusType: string
  dueDate?: string
  estimate?: number
  billable: boolean
  totalMinutes?: number
}

function MetadataRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center min-h-9 py-1">
      <div className="flex items-center gap-2.5 w-[130px] shrink-0">
        <Icon className="size-4 text-muted-foreground/50" />
        <span className="text-[13px] font-medium text-foreground/70">{label}</span>
      </div>
      <div className="flex-1 min-w-0 px-2 py-1 -mx-2 rounded-md transition-colors hover:bg-muted/50 cursor-default">{children}</div>
    </div>
  )
}

export function TaskDetailMetadata({
  task,
  isAdmin,
}: {
  task: TaskDetailData
  isAdmin: boolean
}) {
  const updateTask = useMutation(api.tasks.update)
  const overdue = isOverdue(task.dueDate)

  async function handleBillableChange(checked: boolean) {
    try {
      await updateTask({ id: task._id, billable: checked })
    } catch (err) {
      toastError(err, "Failed to update")
    }
  }

  return (
    <div className="shrink-0 px-7 pb-6">
      <div className="grid grid-cols-2 gap-x-0">
        {/* Left column */}
        <div className="flex flex-col pr-6 border-r border-border/50">
          <MetadataRow icon={CircleCheckIcon} label="Status">
            <InlineStatusCell taskId={task._id} status={task.status} isAdmin={isAdmin} />
          </MetadataRow>
          <MetadataRow icon={UsersIcon} label="Assignees">
            <InlineAssigneeCell taskId={task._id} assignees={task.assignees} />
          </MetadataRow>
          <MetadataRow icon={CalendarIcon} label="Due date">
            <InlineDueDateCell taskId={task._id} dueDate={task.dueDate ?? null} isOverdue={overdue} />
          </MetadataRow>
          <MetadataRow icon={FolderIcon} label="Project">
            <InlineProjectCell taskId={task._id} project={task.project} client={task.client} />
          </MetadataRow>
        </div>

        {/* Right column */}
        <div className="flex flex-col pl-6">
          <MetadataRow icon={TagIcon} label="Category">
            <InlineCategoryCell taskId={task._id} category={task.category} />
          </MetadataRow>
          <MetadataRow icon={ClockIcon} label="Estimate">
            <span className="text-[13px]">
              {task.estimate ? formatDuration(task.estimate) : (
                <span className="text-muted-foreground/40">-</span>
              )}
            </span>
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
                disabled={!isAdmin}
                aria-label="Billable"
                className="scale-[0.8] origin-left"
              />
              <span className="text-[13px] text-muted-foreground">
                {task.billable ? "Yes" : "No"}
              </span>
            </div>
          </MetadataRow>
        </div>
      </div>
    </div>
  )
}

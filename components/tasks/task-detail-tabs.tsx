"use client"

import dynamic from "next/dynamic"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TaskDetailOverview } from "@/components/tasks/task-detail-overview"
import { TaskDetailTime } from "@/components/tasks/task-detail-time"
import { TaskDetailAttachments } from "@/components/tasks/task-detail-attachments"
import { MailIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

const SubtaskList = dynamic(
  () => import("@/components/tasks/subtask-list").then((m) => ({ default: m.SubtaskList })),
  { ssr: false, loading: () => null },
)

type TaskData = {
  _id: Id<"tasks">
  title: string
  description?: unknown
  statusType: string
  projectId?: Id<"projects">
  billable: boolean
  workCategoryId?: Id<"workCategories">
  assigneeIds: Id<"users">[]
  totalMinutes?: number
}

export function TaskDetailTabs({
  task,
  isAdmin,
  onOpenDetail,
}: {
  task: TaskData
  isAdmin: boolean
  onOpenDetail: (taskId: string) => void
}) {
  return (
    <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden gap-0">
      <div className="shrink-0 border-b px-7">
        <TabsList variant="line" className="w-auto border-b-0">
          <TabsTrigger value="overview" className="text-[13px]">Overview</TabsTrigger>
          <TabsTrigger value="subtasks" className="text-[13px]">Subtasks</TabsTrigger>
          <TabsTrigger value="time" className="text-[13px]">Time</TabsTrigger>
          <TabsTrigger value="attachments" className="text-[13px]">Attachments</TabsTrigger>
          <TabsTrigger value="emails" className="text-[13px]">Emails</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex-1 overflow-y-auto px-7 py-5">
        <TaskDetailOverview task={task} />
      </TabsContent>

      <TabsContent value="subtasks" className="flex-1 overflow-y-auto px-7 py-5">
        <SubtaskList
          parentTaskId={task._id}
          parentProjectId={task.projectId}
          parentBillable={task.billable}
          parentCategoryId={task.workCategoryId}
          parentAssigneeIds={task.assigneeIds}
          isAdmin={isAdmin}
          onOpenDetail={onOpenDetail}
        />
      </TabsContent>

      <TabsContent value="time" className="flex-1 overflow-y-auto px-7 py-5">
        <TaskDetailTime
          taskId={task._id}
          isBillable={task.billable}
        />
      </TabsContent>

      <TabsContent value="attachments" className="flex-1 overflow-y-auto px-7 py-5">
        <TaskDetailAttachments taskId={task._id} />
      </TabsContent>

      <TabsContent value="emails" className="flex-1 overflow-y-auto px-7 py-5">
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/40 p-12">
          <MailIcon className="size-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/50">Email integration coming soon</p>
        </div>
      </TabsContent>
    </Tabs>
  )
}

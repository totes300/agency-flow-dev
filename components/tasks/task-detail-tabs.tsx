"use client"

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { Id, Doc } from "@/convex/_generated/dataModel"

type TaskData = {
  _id: Id<"tasks">
  title: string
}

export function TaskDetailTabs({
  task,
  isAdmin,
}: {
  task: TaskData
  isAdmin: boolean
}) {
  return (
    <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden gap-0">
      <div className="shrink-0 px-7">
        <TabsList variant="line" className="w-auto">
          <TabsTrigger value="overview" className="text-[13px]">Overview</TabsTrigger>
          <TabsTrigger value="time" className="text-[13px]">Time</TabsTrigger>
          <TabsTrigger value="attachments" className="text-[13px]">Attachments</TabsTrigger>
          <TabsTrigger value="emails" className="text-[13px]">Emails</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="flex-1 overflow-y-auto px-7 py-5">
        <div className="flex flex-col gap-6">
          {/* Description placeholder — Tiptap in PR2 */}
          <div className="rounded-lg border border-border/40 p-4">
            <p className="text-sm text-muted-foreground/50">Add a description...</p>
          </div>

          {/* Subtasks placeholder — full implementation in PR2 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold">Subtasks</span>
            </div>
            <div className="rounded-lg border border-border/40 p-4 text-center text-sm text-muted-foreground/50">
              Subtask list — coming in PR2
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="time" className="flex-1 overflow-y-auto px-7 py-5">
        <div className="rounded-lg border border-border/40 p-4 text-center text-sm text-muted-foreground/50">
          Time entries — coming in PR4
        </div>
      </TabsContent>

      <TabsContent value="attachments" className="flex-1 overflow-y-auto px-7 py-5">
        <div className="rounded-lg border border-border/40 p-4 text-center text-sm text-muted-foreground/50">
          Attachments — coming in PR4
        </div>
      </TabsContent>

      <TabsContent value="emails" className="flex-1 overflow-y-auto px-7 py-5">
        <div className="rounded-lg border border-border/40 p-4 text-center text-sm text-muted-foreground/50">
          Email integration coming soon
        </div>
      </TabsContent>
    </Tabs>
  )
}

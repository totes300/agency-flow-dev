"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { toastError } from "@/lib/toast-helpers"
import dynamic from "next/dynamic"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import { TaskDetailTime } from "@/components/tasks/task-detail-time"
import { TaskDetailAttachments } from "@/components/tasks/task-detail-attachments"
import { ActivityFeed, type ReplyContext, type CommentCounts } from "@/components/tasks/activity-feed"
import { InlineCommentInput } from "@/components/tasks/inline-comment-input"
import { TypingIndicator } from "@/components/typing-indicator"
import { api } from "@/convex/_generated/api"
import { MailIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

const SubtaskList = dynamic(
  () => import("@/components/tasks/subtask-list").then((m) => ({ default: m.SubtaskList })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col gap-0.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid h-9 grid-cols-[20px_1fr_116px_108px_80px_96px_76px_36px] items-center gap-0 px-2">
            <div />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-5 w-16 animate-pulse rounded bg-muted" />
            <div className="h-3 w-10 animate-pulse rounded bg-muted" />
            <div className="h-5 w-14 animate-pulse rounded-full bg-muted" />
            <div className="h-3 w-10 animate-pulse rounded bg-muted" />
            <div />
          </div>
        ))}
      </div>
    ),
  },
)

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

type TaskData = {
  _id: Id<"tasks">
  title: string
  description?: unknown
  statusType: string
  clientName?: string
  projectName?: string
  projectId?: Id<"projects">
  billable: boolean
  workCategoryId?: Id<"workCategories">
  assigneeIds: Id<"users">[]
  totalMinutes?: number
  createdAt: number
  updatedAt?: number
  project?: { _id: Id<"projects">; name: string; code: string } | null
}

export function TaskDetailDrawerContent({
  task,
  isAdmin,
  onOpenDetail,
}: {
  task: TaskData
  isAdmin: boolean
  onOpenDetail: (taskId: string) => void
}) {
  const { isAuthenticated } = useConvexAuth()
  const typingUsers = useQuery(api.typingIndicators.getTyping, isAuthenticated ? { taskId: task._id } : "skip")

  const scrollRef = useRef<HTMLDivElement>(null)
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null)
  const [commentCounts, setCommentCounts] = useState<CommentCounts>({ total: 0, unread: 0 })

  // Reset scroll position when switching tasks
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [task._id])

  // ─── Description auto-save (same logic as TaskDetailOverview) ───────────
  const updateDescription = useMutation(api.tasks.updateDescription)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskIdRef = useRef(task._id)
  const pendingSaveRef = useRef<(() => void) | null>(null)

  useEffect(() => { taskIdRef.current = task._id }, [task._id])
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        pendingSaveRef.current?.()
      }
    }
  }, [task._id])

  const handleDescriptionUpdate = useCallback(
    (content: unknown) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const doSave = () => {
        pendingSaveRef.current = null
        void updateDescription({
          id: taskIdRef.current,
          description: JSON.stringify(content),
        }).catch((err: unknown) => toastError(err, "Failed to save description"))
      }
      pendingSaveRef.current = doSave
      debounceRef.current = setTimeout(doSave, 1000)
    },
    [updateDescription],
  )

  const descriptionContent = useMemo(() => {
    if (!task.description) return undefined
    if (typeof task.description === "string") {
      try { return JSON.parse(task.description) } catch { return undefined }
    }
    return task.description
  }, [task.description])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden gap-0">
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin">
          <div className="px-12 pt-8 pb-6">
            <TaskDetailTitle taskId={task._id} title={task.title} />
          </div>

          <div className="px-12 pb-6">
            <TabsList variant="plain" className="pb-2">
              {(
                [
                  { value: "overview", label: "Overview", badge: commentCounts.unread > 0 ? commentCounts.unread : undefined },
                  { value: "time", label: "Time" },
                  { value: "files", label: "Files" },
                  { value: "email", label: "Email" },
                ] as const
              ).map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="inline-flex items-center gap-1 text-[13px] font-medium"
                >
                  {tab.label}
                  {"badge" in tab && tab.badge != null && tab.badge > 0 && (
                    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 py-px text-[10px] font-bold leading-none text-white">
                      {tab.badge}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="h-px bg-border/70" />
          </div>

          <TabsContent value="overview" className="flex flex-col">
            <div className="px-12">
              <TiptapEditor
                content={descriptionContent}
                onUpdate={handleDescriptionUpdate}
                variant="document"
              />
            </div>

            <div className="px-12 pt-6">
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

            <div className="px-12 pt-8">
              <div className="border-t border-border/70 pt-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-muted-foreground">Activity</span>
                    {commentCounts.total > 0 && (
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2 h-[20px] text-[11px] tabular-nums font-medium",
                        commentCounts.unread > 0
                          ? "bg-red-500 text-white dark:bg-red-600"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {commentCounts.unread > 0 ? commentCounts.unread : commentCounts.total}
                      </span>
                    )}
                  </div>
                </div>
                <ActivityFeed
                  taskId={task._id}
                  isAdmin={isAdmin}
                  scrollRef={scrollRef}
                  replyContext={replyContext}
                  onReplyContextChange={setReplyContext}
                  onCommentCounts={setCommentCounts}
                />
              </div>
            </div>

            <div className="px-12 pt-6 pb-[40vh]">
              {typingUsers && typingUsers.length > 0 && (
                <div className="mb-0.5 pl-9">
                  <TypingIndicator typingUsers={typingUsers} />
                </div>
              )}
              <InlineCommentInput
                key={task._id}
                taskId={task._id}
                replyContext={replyContext}
                onClearReply={() => setReplyContext(null)}
              />
            </div>
          </TabsContent>

          <TabsContent value="time" className="px-12 py-5">
            <TaskDetailTime
              taskId={task._id}
              isBillable={task.billable}
              isDone={task.statusType === "done"}
              totalMinutes={task.totalMinutes ?? 0}
            />
          </TabsContent>

          <TabsContent value="files" className="px-12 py-5">
            <TaskDetailAttachments taskId={task._id} />
          </TabsContent>

          <TabsContent value="email" className="px-12 py-5">
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/40 p-12">
              <MailIcon className="size-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground/50">Coming soon</p>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

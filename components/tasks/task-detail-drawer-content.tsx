"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import dynamic from "next/dynamic"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import { TaskDetailTime } from "@/components/tasks/task-detail-time"
import { TaskDetailAttachments } from "@/components/tasks/task-detail-attachments"
import { InlineTimeCell } from "@/components/tasks/inline-time-cell"
import { ActivityFeed, ActivityViewToggle, type ReplyContext, type ActivityView, type CommentCounts } from "@/components/tasks/activity-feed"
import { TaskDetailCommentInput } from "@/components/tasks/task-detail-comment-input"
import { TypingIndicator } from "@/components/typing-indicator"
import { api } from "@/convex/_generated/api"
import { MailIcon } from "lucide-react"
import { cn } from "@/lib/utils"
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
  const roRef = useRef<ResizeObserver | null>(null)
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null)
  const [activityView, setActivityView] = useState<ActivityView>("all")
  const [commentCounts, setCommentCounts] = useState<CommentCounts>({ total: 0, unread: 0 })
  const [isDescExpanded, setIsDescExpanded] = useState(false)
  const [isDescOverflowing, setIsDescOverflowing] = useState(false)

  const DESC_COLLAPSED_HEIGHT = 400

  // Callback ref — re-attaches ResizeObserver whenever the DOM element mounts
  const descriptionRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null }
    if (!el) return
    const check = () => setIsDescOverflowing(el.scrollHeight > DESC_COLLAPSED_HEIGHT)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Reset collapsed state when switching tasks
  useEffect(() => { setIsDescExpanded(false) }, [task._id])

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
        }).catch(() => {})
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
      {/* Fixed header — title + log time, tabs */}
      <div className="shrink-0 px-14">
        <div className="pt-12">
          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <TaskDetailTitle taskId={task._id} title={task.title} />
            </div>
            <div className="group/row mt-0.5 shrink-0">
              <InlineTimeCell
                taskId={task._id}
                totalMinutes={task.totalMinutes ?? 0}
                isDone={task.statusType === "done"}
                isBillable={task.billable}
                variant="sidebar"
              />
            </div>
          </div>
        </div>
        <div className="h-3" />
      </div>

      <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden gap-0">
        <div className="shrink-0 mx-14 border-b">
          <TabsList variant="line" className="w-auto border-b-0">
            <TabsTrigger value="overview" className="text-[13px]">Overview</TabsTrigger>
            <TabsTrigger value="subtasks" className="text-[13px]">Subtasks</TabsTrigger>
            <TabsTrigger value="time" className="text-[13px]">Time</TabsTrigger>
            <TabsTrigger value="attachments" className="text-[13px]">Attachments</TabsTrigger>
            <TabsTrigger value="emails" className="text-[13px]">Emails</TabsTrigger>
          </TabsList>
        </div>

        {/* Overview — description and activity */}
        <TabsContent value="overview" className="flex flex-1 flex-col overflow-hidden">
          <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
            {/* Description — collapsible with fade */}
            <div className="relative px-14 pt-4 pb-2">
              <div
                ref={descriptionRef}
                className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
                style={{
                  maxHeight: isDescExpanded ? "60vh" : `${DESC_COLLAPSED_HEIGHT}px`,
                  overflowY: isDescExpanded ? "auto" : "hidden",
                }}
              >
                <TiptapEditor
                  content={descriptionContent}
                  onUpdate={handleDescriptionUpdate}
                  variant="document"
                />
              </div>

              {/* Fade overlay + show more/less toggle */}
              {isDescOverflowing && (
                <>
                  {!isDescExpanded && (
                    <div className="pointer-events-none absolute right-14 bottom-0 left-14 h-56 bg-gradient-to-t from-background from-15% via-background/40 via-60% to-transparent" />
                  )}
                  <div className="relative z-10 flex items-center gap-3 pt-1">
                    <div className="h-px flex-1 border-t border-dashed border-border/50" />
                    <button
                      type="button"
                      onClick={() => setIsDescExpanded((v) => !v)}
                      className="shrink-0 text-[13px] text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      {isDescExpanded ? "Show less" : "Show more"}
                    </button>
                    <div className="h-px flex-1 border-t border-dashed border-border/50" />
                  </div>
                </>
              )}
            </div>

            {/* Activity section */}
            <div className="px-14 pb-3 pt-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">Activity</h3>
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
                <ActivityViewToggle view={activityView} onViewChange={setActivityView} />
              </div>
              <ActivityFeed
                taskId={task._id}
                isAdmin={isAdmin}
                scrollRef={scrollRef}
                replyContext={replyContext}
                onReplyContextChange={setReplyContext}
                view={activityView}
                onViewChange={setActivityView}
                onCommentCounts={setCommentCounts}
              />
            </div>
          </div>

          {/* Sticky footer — typing + comment input */}
          <div className="shrink-0">
            {typingUsers && typingUsers.length > 0 && (
              <TypingIndicator typingUsers={typingUsers} />
            )}
            <TaskDetailCommentInput
              taskId={task._id}
              replyContext={replyContext}
              onClearReply={() => setReplyContext(null)}
            />
          </div>
        </TabsContent>

        <TabsContent value="subtasks" className="flex-1 overflow-y-auto px-14 py-5">
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

        {/* Time */}
        <TabsContent value="time" className="flex-1 overflow-y-auto px-14 py-5">
          <TaskDetailTime
            taskId={task._id}
            isBillable={task.billable}
            isDone={task.statusType === "done"}
            totalMinutes={task.totalMinutes ?? 0}
          />
        </TabsContent>

        {/* Attachments */}
        <TabsContent value="attachments" className="flex-1 overflow-y-auto px-14 py-5">
          <TaskDetailAttachments taskId={task._id} />
        </TabsContent>

        {/* Emails */}
        <TabsContent value="emails" className="flex-1 overflow-y-auto px-14 py-5">
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/40 p-12">
            <MailIcon className="size-10 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/50">Coming soon</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

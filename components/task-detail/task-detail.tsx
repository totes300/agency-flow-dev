"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useConvexAuth, useMutation, useQuery } from "convex/react"
import dynamic from "next/dynamic"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TaskDetailTitle } from "@/components/tasks/task-detail-title"
import { TaskDetailTime } from "@/components/tasks/task-detail-time"
import { TaskDetailAttachments } from "@/components/tasks/task-detail-attachments"
import { ActivityFeed, type CommentCounts, type ReplyContext } from "@/components/tasks/activity-feed"
import { InlineCommentInput } from "@/components/tasks/inline-comment-input"
import { TypingIndicator } from "@/components/typing-indicator"
import { toastError } from "@/lib/toast-helpers"
import { cn } from "@/lib/utils"
import type { CellContext } from "@/components/task-view/columns"
import type { TaskRowModel } from "@/components/task-view/row-model"
import { TaskSubtasks } from "@/components/task-detail/task-subtasks"
import type { TaskDetailDTO } from "@/components/task-detail/use-task-detail"

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

/**
 * The shared task detail body (docs/prd-tasks-refactor.md §6.2): title,
 * tabs (Overview with the unread badge, Time, Files — Email is hidden until
 * it ships), description, sub-tasks on the shared row, the activity feed with
 * the "N new since your last visit" divider, and the one comment input. The
 * drawer and the full page render the same body; the page centres it in a
 * reading column. The body owns its scroll container (the activity feed's
 * seen-marker and "new messages" pill observe it).
 */
export function TaskDetailBody({
  task,
  subtaskRows,
  subtaskCtx,
  isAdmin,
  variant,
  onOpenTask,
}: {
  task: TaskDetailDTO
  subtaskRows: TaskRowModel[] | undefined
  subtaskCtx: CellContext
  isAdmin: boolean
  variant: "drawer" | "page"
  onOpenTask: (taskId: Id<"tasks">) => void
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

  const handleDescriptionUpdate = useDescriptionAutosave(task._id)
  const descriptionContent = useMemo(() => {
    if (!task.description) return undefined
    try {
      return JSON.parse(task.description) as unknown
    } catch {
      return undefined
    }
  }, [task.description])

  const page = variant === "page"

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden gap-0">
        <div ref={scrollRef} className="relative flex-1 overflow-y-auto scrollbar-thin">
          <div className={cn(page && "mx-auto w-full max-w-[856px]")}>
            <div className={cn("px-12 pb-6", page ? "pt-10" : "pt-8")}>
              <TaskDetailTitle taskId={task._id} title={task.title} />
            </div>

            <div className="px-12 pb-6">
              <TabsList variant="plain" className="pb-2">
                {(
                  [
                    { value: "overview", label: "Overview", badge: commentCounts.unread > 0 ? commentCounts.unread : undefined },
                    { value: "time", label: "Time" },
                    { value: "files", label: "Files" },
                  ] as const
                ).map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="inline-flex items-center gap-1 text-[13px] font-medium">
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
                  taskAssigneeIds={task.assigneeIds}
                  taskId={task._id}
                />
              </div>

              {task.parentTaskId ? null : (
                <div className="px-12 pt-6">
                  <TaskSubtasks
                    parent={task}
                    rows={subtaskRows}
                    ctx={subtaskCtx}
                    variant={variant}
                    isAdmin={isAdmin}
                    onOpen={onOpenTask}
                  />
                </div>
              )}

              <div className="px-12 pt-8">
                <div className="border-t border-border/70 pt-5">
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-muted-foreground">Activity</span>
                      {commentCounts.total > 0 && (
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 h-[20px] text-[11px] tabular-nums font-medium",
                            commentCounts.unread > 0 ? "bg-red-500 text-white dark:bg-red-600" : "bg-muted text-muted-foreground",
                          )}
                        >
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

              <div className={cn("px-12 pt-6", page ? "pb-24" : "pb-[40vh]")}>
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
              <TaskDetailTime taskId={task._id} isBillable={task.billable} />
            </TabsContent>

            <TabsContent value="files" className="px-12 py-5">
              <TaskDetailAttachments taskId={task._id} />
            </TabsContent>
          </div>
        </div>
      </Tabs>
    </div>
  )
}

/** Debounced description save (1s); a pending save flushes when the task changes or the body unmounts. */
function useDescriptionAutosave(taskId: Id<"tasks">) {
  const updateDescription = useMutation(api.tasks.updateDescription)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const taskIdRef = useRef(taskId)
  const pendingSaveRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    taskIdRef.current = taskId
  }, [taskId])
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        pendingSaveRef.current?.()
      }
    }
  }, [taskId])

  return useCallback(
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
}

"use client"

import { useRef, useState } from "react"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { TaskDetailCommentInput } from "@/components/tasks/task-detail-comment-input"
import { ActivityFeed, type ReplyContext } from "@/components/tasks/activity-feed"
import { TypingIndicator } from "@/components/typing-indicator"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailSidebar({ taskId, isAdmin }: { taskId: Id<"tasks">; isAdmin?: boolean }) {
  const { isAuthenticated } = useConvexAuth()
  const typingUsers = useQuery(api.typingIndicators.getTyping, isAuthenticated ? { taskId } : "skip")

  const scrollRef = useRef<HTMLDivElement>(null)
  const [replyContext, setReplyContext] = useState<ReplyContext | null>(null)

  return (
    <div className="hidden w-[480px] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-background md:flex">
      {/* Header */}
      <div className="flex items-center border-b border-border/60 px-4 py-3">
        <span className="text-sm font-semibold">Activity</span>
      </div>

      {/* Timeline */}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto p-3 pb-2.5">
          <ActivityFeed
            taskId={taskId}
            isAdmin={isAdmin}
            scrollRef={scrollRef}
            replyContext={replyContext}
            onReplyContextChange={setReplyContext}
          />
        </div>
      </div>

      {/* Typing indicator */}
      {typingUsers && typingUsers.length > 0 && (
        <TypingIndicator typingUsers={typingUsers} />
      )}

      {/* Comment input */}
      <TaskDetailCommentInput
        taskId={taskId}
        replyContext={replyContext}
        onClearReply={() => setReplyContext(null)}
      />
    </div>
  )
}

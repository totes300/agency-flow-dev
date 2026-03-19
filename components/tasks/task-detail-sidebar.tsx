"use client"

import { useEffect, useMemo } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { UserAvatar } from "@/components/user-avatar"
import { TaskDetailCommentInput } from "@/components/tasks/task-detail-comment-input"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { mergeActivityFeed, type FeedItem } from "@/lib/task-detail"
import { extractPlainText } from "@/lib/subtask"
import { formatActivityTimestamp, firstName } from "@/lib/format"
import { BellIcon, ThumbsUpIcon, SmileIcon } from "lucide-react"
import type { Id } from "@/convex/_generated/dataModel"

export function TaskDetailSidebar({ taskId }: { taskId: Id<"tasks"> }) {
  const { isAuthenticated } = useConvexAuth()

  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const activities = useQuery(api.activityLog.byTask, isAuthenticated ? { taskId } : "skip")
  const comments = useQuery(api.comments.byTask, isAuthenticated ? { taskId } : "skip")
  const commentStats = useQuery(api.comments.unreadCount, isAuthenticated ? { taskId } : "skip")

  // Mark comments as seen once on mount and when task changes (not on every new comment)
  const markSeen = useMutation(api.comments.markSeen)
  useEffect(() => {
    if (isAuthenticated) {
      markSeen({ taskId })
    }
  }, [isAuthenticated, taskId, markSeen])

  // Build unified timeline — memoized to avoid re-sorting on unrelated re-renders
  const feed = useMemo(() => buildFeed(activities, comments), [activities, comments])
  const unreadCount = commentStats?.unread ?? 0
  const currentUserId = currentUser?._id

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-border/40">
      {/* Header — ClickUp style */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
        <span className="text-sm font-semibold">Activity</span>
        {unreadCount > 0 && (
          <div className="flex items-center gap-1.5">
            <BellIcon className="size-3.5 text-muted-foreground" />
            <span className="flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
              {unreadCount}
            </span>
          </div>
        )}
      </div>

      {/* Unified timeline */}
      <div className="flex-1 overflow-y-auto">
        {feed === null ? (
          <FeedSkeleton />
        ) : feed.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-xs text-muted-foreground/50">
            No activity yet
          </div>
        ) : (
          <div className="flex flex-col p-3">
            {feed.map((item) =>
              item.kind === "comment" ? (
                <CommentCard key={item.id} item={item} currentUserId={currentUserId} />
              ) : (
                <AuditLine key={item.id} item={item} currentUserId={currentUserId} />
              ),
            )}
          </div>
        )}
      </div>

      {/* Comment input — always visible */}
      <TaskDetailCommentInput taskId={taskId} />
    </div>
  )
}

// ─── Feed builder ───────────────────────────────────────────────────────────────

function buildFeed(
  activities: { _id: string; type: string; userId: string; userName: string; metadata: unknown; createdAt: number }[] | undefined,
  comments: { _id: string; userId: string; userName: string; userImageUrl?: string; content: unknown; createdAt: number }[] | undefined,
): FeedItem[] | null {
  if (!activities || !comments) return null

  const activityEvents = activities
    .filter((a) => a.type !== "comment_added")
    .map((a) => ({
      id: a._id,
      type: a.type,
      userId: a.userId,
      userName: a.userName,
      metadata: a.metadata as Record<string, unknown>,
      createdAt: a.createdAt,
    }))

  const commentEvents = comments.map((c) => ({
    id: c._id,
    userId: c.userId,
    userName: c.userName,
    userImageUrl: c.userImageUrl,
    content: c.content,
    createdAt: c.createdAt,
  }))

  return mergeActivityFeed(activityEvents, commentEvents)
}

// ─── Audit line — ClickUp style: "• You created this task    Dec 24 at 6:58 pm" ─

function AuditLine({ item, currentUserId }: { item: FeedItem & { kind: "audit" }; currentUserId?: Id<"users"> }) {
  // "You" if current user, otherwise first name
  const displayName = currentUserId && item.userId === currentUserId
    ? "You"
    : firstName(item.userName ?? "Someone")

  const { text, highlight } = formatActivityText(
    item.type as ActivityEventType,
    displayName,
    item.metadata,
  )

  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="text-muted-foreground/40">•</span>
      <span className="flex-1 text-[12px] leading-4 text-muted-foreground/70">
        {text}
        {highlight && (
          <span className="font-medium text-muted-foreground"> {highlight}</span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground/40">
        {formatActivityTimestamp(item.createdAt)}
      </span>
    </div>
  )
}

// ─── Comment card — ClickUp style with footer ──────────────────────────────────

function CommentCard({ item, currentUserId }: { item: FeedItem & { kind: "comment" }; currentUserId?: Id<"users"> }) {
  const plainText = extractPlainText(item.content)

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/40">
      {/* Header: avatar + name + time */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-2">
        <UserAvatar
          name={item.userName ?? "?"}
          imageUrl={item.userImageUrl}
          className="size-7 text-[10px]"
        />
        <span className="text-[13px] font-semibold text-foreground">{item.userName}</span>
        <span className="text-[11px] text-muted-foreground/50">{formatActivityTimestamp(item.createdAt)}</span>
      </div>

      {/* Body */}
      <div className="px-3.5 pb-3">
        <p className="text-[13px] leading-relaxed text-foreground">{plainText}</p>
      </div>

      {/* Footer — ClickUp style: reactions + reply */}
      <div className="flex items-center justify-between border-t border-border/30 px-3.5 py-1.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled
            aria-label="Like"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
          >
            <ThumbsUpIcon className="size-3.5" />
          </button>
          <button
            type="button"
            disabled
            aria-label="Add reaction"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
          >
            <SmileIcon className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          disabled
          className="text-[12px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
        >
          Reply
        </button>
      </div>
    </div>
  )
}

// ─── Skeleton ───────────────────────────────────────────────────────────────────

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  )
}

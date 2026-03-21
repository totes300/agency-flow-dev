"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { TaskDetailCommentInput } from "@/components/tasks/task-detail-comment-input"
import { CommentCard } from "@/components/tasks/comment-card"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { mergeActivityFeed, type FeedItem } from "@/lib/task-detail"
import { formatActivityTimestamp, firstName } from "@/lib/format"
import type { Id } from "@/convex/_generated/dataModel"
import { TypingIndicator } from "@/components/typing-indicator"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"

export function TaskDetailSidebar({ taskId }: { taskId: Id<"tasks"> }) {
  const { isAuthenticated } = useConvexAuth()

  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const activities = useQuery(api.activityLog.byTask, isAuthenticated ? { taskId } : "skip")
  const comments = useQuery(api.comments.byTask, isAuthenticated ? { taskId } : "skip")
  const reactionsMap = useQuery(api.commentReactions.byTask, isAuthenticated ? { taskId } : "skip")
  const attachmentsMap = useQuery(api.commentAttachments.byTask, isAuthenticated ? { taskId } : "skip")
  const readReceipts = useQuery(api.comments.readReceipts, isAuthenticated ? { taskId } : "skip")
  const myLastSeen = useQuery(api.comments.myLastSeen, isAuthenticated ? { taskId } : "skip")

  const typingUsers = useQuery(api.typingIndicators.getTyping, isAuthenticated ? { taskId } : "skip")

  const toggleReaction = useMutation(api.commentReactions.toggle)

  // Reply context state
  const [replyContext, setReplyContext] = useState<{ commentId: string; userName: string } | null>(null)

  const handleReply = useCallback((commentId: string, userName: string) => {
    setReplyContext({ commentId, userName })
  }, [])

  const handleToggleReaction = useCallback(
    (commentId: string, emoji: string) => {
      void toggleReaction({ commentId: commentId as Id<"comments">, emoji })
    },
    [toggleReaction],
  )

  // Mark comments as seen — debounced to avoid firing on rapid J/K navigation.
  // Re-triggers when new comments arrive while dialog is open (Messenger-style).
  const markSeen = useMutation(api.comments.markSeen)
  const commentCount = comments?.length ?? 0
  useEffect(() => {
    if (!isAuthenticated) return
    const timeout = setTimeout(() => markSeen({ taskId }), 500)
    return () => clearTimeout(timeout)
  }, [isAuthenticated, taskId, markSeen, commentCount])

  // Freeze lastSeenAt on first load so the "New" divider survives the markSeen update.
  // Once captured, it stays constant for the lifetime of this dialog mount.
  const newDividerAt = useRef<number | null>(null)
  if (myLastSeen !== undefined && newDividerAt.current === null) {
    newDividerAt.current = myLastSeen
  }

  // Build unified timeline — memoized to avoid re-sorting on unrelated re-renders
  const feed = useMemo(() => buildFeed(activities, comments), [activities, comments])
  const currentUserId = currentUser?._id

  // Scroll to bottom when feed or read receipts change
  const scrollRef = useRef<HTMLDivElement>(null)
  const feedLength = feed?.length ?? 0
  const lastSeenAt = readReceipts?.[0]?.lastSeenAt ?? 0

  useEffect(() => {
    const el = scrollRef.current
    if (!el || feedLength === 0) return
    el.scrollTop = el.scrollHeight
  }, [feedLength, lastSeenAt])

  return (
    <div className="hidden w-[460px] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-muted/60 md:flex">
      {/* Header */}
      <div className="flex items-center border-b border-border/60 px-4 py-3">
        <span className="text-sm font-semibold">Activity</span>
      </div>

      {/* Unified timeline */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 pb-2.5">
        {feed === null ? (
          <FeedSkeleton />
        ) : feed.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-muted-foreground/50">
            No activity yet
          </div>
        ) : (
          <div className="flex flex-col">
            {feed.map((item, i) => {
              const showNewDivider =
                newDividerAt.current !== null &&
                newDividerAt.current > 0 &&
                item.createdAt > newDividerAt.current &&
                item.userId !== currentUserId &&
                !feed
                  .slice(0, i)
                  .some(
                    (prev) =>
                      prev.createdAt > newDividerAt.current! &&
                      prev.userId !== currentUserId,
                  )

              return (
                <Fragment key={item.id}>
                  {showNewDivider && <NewDivider />}
                  {item.kind === "comment" ? (
                    <CommentCard
                      item={item}
                      currentUserId={currentUserId}
                      reactions={reactionsMap?.[item.id]}
                      attachments={attachmentsMap?.[item.id]}
                      onReply={handleReply}
                      onToggleReaction={handleToggleReaction}
                    />
                  ) : (
                    <AuditLine item={item} currentUserId={currentUserId} />
                  )}
                </Fragment>
              )
            })}
            <SeenBy feed={feed} readReceipts={readReceipts} currentUserId={currentUserId} />
          </div>
        )}
      </div>

      {/* Typing indicator — between feed and input */}
      {typingUsers && typingUsers.length > 0 && (
        <TypingIndicator typingUsers={typingUsers} />
      )}

      {/* Comment input — always visible */}
      <TaskDetailCommentInput
        taskId={taskId}
        replyContext={replyContext}
        onClearReply={() => setReplyContext(null)}
      />
    </div>
  )
}

// ─── Feed builder ───────────────────────────────────────────────────────────────

function buildFeed(
  activities: { _id: string; type: string; userId: string; userName: string; metadata: unknown; createdAt: number }[] | undefined,
  comments: { _id: string; userId: string; userName: string; userImageUrl?: string; content: unknown; parentCommentId?: Id<"comments">; parentUserName?: string; parentPreview?: string; createdAt: number }[] | undefined,
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
    parentCommentId: c.parentCommentId,
    parentUserName: c.parentUserName,
    parentPreview: c.parentPreview,
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

// ─── New divider — Slack-style unread marker ─────────────────────────────────────

function NewDivider() {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-muted-foreground/20" />
      <span className="text-[9px] text-muted-foreground/40">New</span>
      <div className="h-px flex-1 bg-muted-foreground/20" />
    </div>
  )
}

// ─── Seen by — chat-style read receipts ──────────────────────────────────────────

type ReadReceipt = { userId: string; userName: string; userImageUrl?: string; lastSeenAt: number }

function SeenBy({
  feed,
  readReceipts,
  currentUserId,
}: {
  feed: FeedItem[]
  readReceipts: ReadReceipt[] | undefined
  currentUserId?: string
}) {
  if (!readReceipts || readReceipts.length === 0) return null

  // Find the last comment in the feed
  const lastComment = [...feed].reverse().find((item) => item.kind === "comment")
  if (!lastComment) return null

  // Only show "Seen by" if the current user wrote the last comment
  if (lastComment.userId !== currentUserId) return null

  // Users who have seen the last comment (lastSeenAt >= comment createdAt)
  const seenUsers = readReceipts.filter((r) => r.lastSeenAt >= lastComment.createdAt)
  if (seenUsers.length === 0) return null

  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-0.5 px-4 pt-1">
        <span className="text-[10px] text-muted-foreground/40">Seen by</span>
        {seenUsers.map((user, i) => (
          <Tooltip key={user.userId}>
            <TooltipTrigger asChild>
              <span className="cursor-default text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70">
                {firstName(user.userName)}{i < seenUsers.length - 1 ? "," : ""}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Seen at {new Date(user.lastSeenAt).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
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

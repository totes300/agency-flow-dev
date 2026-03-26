"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { TaskDetailCommentInput } from "@/components/tasks/task-detail-comment-input"
import { CommentCard } from "@/components/tasks/comment-card"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { mergeActivityFeed, type FeedItem } from "@/lib/task-detail"
import { groupFeedForCommentsView, type GroupedFeedItem, type AuditBatch } from "@/lib/activity-grouping"
import { formatActivityTimestamp, firstName } from "@/lib/format"
import { ActivityBatch } from "@/components/tasks/activity-batch"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import { TypingIndicator } from "@/components/typing-indicator"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"

export function TaskDetailSidebar({ taskId, isAdmin }: { taskId: Id<"tasks">; isAdmin?: boolean }) {
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
  const updateComment = useMutation(api.comments.update)
  const removeComment = useMutation(api.comments.remove)

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

  const handleEditComment = useCallback(
    (commentId: string, content: unknown) => {
      void updateComment({ id: commentId as Id<"comments">, content })
    },
    [updateComment],
  )

  const handleDeleteComment = useCallback(
    (commentId: string) => {
      void removeComment({ id: commentId as Id<"comments"> })
    },
    [removeComment],
  )

  // Mark comments as seen — debounced to avoid firing on rapid J/K navigation.
  // Do not skip when the latest comment is mine: older comments by others may
  // still be unread, which can keep the task in an unseen state indefinitely.
  const markSeen = useMutation(api.comments.markSeen)
  const commentCount = comments?.length ?? 0
  const currentUserId = currentUser?._id
  useEffect(() => {
    if (!isAuthenticated) return
    const timeout = setTimeout(() => {
      void markSeen({ taskId })
    }, 500)
    return () => clearTimeout(timeout)
  }, [isAuthenticated, taskId, markSeen, commentCount, currentUserId])

  // Freeze lastSeenAt on first load so the "New" divider survives the markSeen update.
  // Once captured, it stays constant for the lifetime of this dialog mount.
  const [newDividerAt, setNewDividerAt] = useState<number | null>(null)
  const newDividerCaptured = useRef(false)
  useEffect(() => {
    if (!newDividerCaptured.current && myLastSeen !== undefined) {
      newDividerCaptured.current = true
      setNewDividerAt(myLastSeen)
    }
  }, [myLastSeen])

  // Stabilize reaction/attachment maps — Convex returns new object refs on every update,
  // but the inner arrays are identical if the data hasn't changed. Serialize to detect real changes.
  const stableReactionsMap = useMemo(() => reactionsMap, [JSON.stringify(reactionsMap)])
  const stableAttachmentsMap = useMemo(() => attachmentsMap, [JSON.stringify(attachmentsMap)])

  // View toggle: "comments" (default) batches audits, "all" shows flat timeline
  const [view, setView] = useState<"comments" | "all">("comments")

  // Build unified timeline — memoized to avoid re-sorting on unrelated re-renders
  const feed = useMemo(() => buildFeed(activities, comments), [activities, comments])
  const groupedFeed = useMemo(
    () => (feed ? groupFeedForCommentsView(feed) : null),
    [feed],
  )

  // Scroll to bottom when feed or read receipts change, or view switches
  const scrollRef = useRef<HTMLDivElement>(null)
  const feedLength = feed?.length ?? 0
  const receiptKey = readReceipts?.map((r) => r.lastSeenAt).join() ?? ""

  useEffect(() => {
    const el = scrollRef.current
    if (!el || feedLength === 0) return
    el.scrollTop = el.scrollHeight
  }, [feedLength, receiptKey, view])

  return (
    <div className="hidden w-[460px] shrink-0 flex-col overflow-hidden border-l border-border/60 bg-muted/60 md:flex">
      {/* Header with view toggle */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span className="text-sm font-semibold">Activity</span>
        <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
          <button
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "comments"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setView("comments")}
          >
            Comments
          </button>
          <button
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              view === "all"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setView("all")}
          >
            All
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3 pb-2.5">
        {feed === null ? (
          <FeedSkeleton />
        ) : feed.length === 0 ? (
          <div className="flex items-center justify-center p-8 text-xs text-muted-foreground/50">
            No activity yet
          </div>
        ) : view === "all" ? (
          <AllView
            feed={feed}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            newDividerAt={newDividerAt}
            reactionsMap={stableReactionsMap}
            attachmentsMap={stableAttachmentsMap}
            readReceipts={readReceipts}
            onReply={handleReply}
            onToggleReaction={handleToggleReaction}
            onEdit={handleEditComment}
            onDelete={handleDeleteComment}
          />
        ) : (
          <CommentsView
            feed={feed}
            groupedFeed={groupedFeed!}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            newDividerAt={newDividerAt}
            reactionsMap={stableReactionsMap}
            attachmentsMap={stableAttachmentsMap}
            readReceipts={readReceipts}
            onReply={handleReply}
            onToggleReaction={handleToggleReaction}
            onEdit={handleEditComment}
            onDelete={handleDeleteComment}
          />
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

// ─── Shared props for view components ────────────────────────────────────────────

type ReactionEntry = { emoji: string; count: number; userNames: string[]; hasReacted: boolean }
type AttachmentEntry = { _id: string; fileName: string; fileSize: number; mimeType: string; url: string | null }

type ViewProps = {
  feed: FeedItem[]
  currentUserId?: Id<"users">
  isAdmin?: boolean
  newDividerAt: number | null
  reactionsMap: Record<string, ReactionEntry[]> | undefined
  attachmentsMap: Record<string, AttachmentEntry[]> | undefined
  readReceipts: ReadReceipt[] | undefined
  onReply: (commentId: string, userName: string) => void
  onToggleReaction: (commentId: string, emoji: string) => void
  onEdit: (commentId: string, content: unknown) => void
  onDelete: (commentId: string) => void
}

// ─── All View — flat timeline (original behavior) ───────────────────────────────

function AllView({
  feed,
  currentUserId,
  isAdmin,
  newDividerAt,
  reactionsMap,
  attachmentsMap,
  readReceipts,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: ViewProps) {
  const lastCommentIndex = feed.findLastIndex((item) => item.kind === "comment")
  const firstNewIndex =
    newDividerAt !== null && newDividerAt > 0
      ? feed.findIndex((item) => item.createdAt > newDividerAt && item.userId !== currentUserId)
      : -1

  return (
    <div className="flex flex-col">
      {feed.map((item, i) => (
        <Fragment key={item.id}>
          {i === firstNewIndex && <NewDivider />}
          {item.kind === "comment" ? (
            <CommentCard
              item={item}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              reactions={reactionsMap?.[item.id]}
              attachments={attachmentsMap?.[item.id]}
              onReply={onReply}
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ) : (
            <AuditLine item={item} currentUserId={currentUserId} />
          )}
          {i === lastCommentIndex && (
            <SeenBy feed={feed} readReceipts={readReceipts} currentUserId={currentUserId} />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// ─── Comments View — batched audits ─────────────────────────────────────────────

function CommentsView({
  feed,
  groupedFeed,
  currentUserId,
  isAdmin,
  newDividerAt,
  reactionsMap,
  attachmentsMap,
  readReceipts,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: ViewProps & { groupedFeed: GroupedFeedItem[] }) {
  // Find the last comment index in the grouped feed for SeenBy placement
  const lastGroupedCommentIndex = groupedFeed.findLastIndex((item) => item.kind === "comment")

  // Track whether NewDivider has been rendered (only show once)
  let newDividerRendered = false

  return (
    <div className="flex flex-col">
      {groupedFeed.map((item, i) => {
        const elements: React.ReactNode[] = []

        if (item.kind === "batch") {
          // Check if this batch straddles the read boundary
          if (
            !newDividerRendered &&
            newDividerAt !== null &&
            newDividerAt > 0 &&
            item.startTime <= newDividerAt &&
            item.endTime > newDividerAt
          ) {
            // Split: read items before boundary, unread after
            const readItems = item.items.filter(
              (a) => a.createdAt <= newDividerAt || a.userId === currentUserId,
            )
            const unreadItems = item.items.filter(
              (a) => a.createdAt > newDividerAt && a.userId !== currentUserId,
            )

            if (readItems.length > 0) {
              elements.push(
                <ActivityBatch
                  key={`${item.id}-read`}
                  batch={makeBatch(item.id + "-read", readItems)}
                  currentUserId={currentUserId}
                />,
              )
            }
            elements.push(<NewDivider key="new-divider" />)
            newDividerRendered = true
            if (unreadItems.length > 0) {
              elements.push(
                <ActivityBatch
                  key={`${item.id}-new`}
                  batch={makeBatch(item.id + "-new", unreadItems)}
                  currentUserId={currentUserId}
                />,
              )
            }
          } else {
            // Entire batch is before or after the boundary
            if (
              !newDividerRendered &&
              newDividerAt !== null &&
              newDividerAt > 0 &&
              item.startTime > newDividerAt &&
              item.items.some((a) => a.userId !== currentUserId)
            ) {
              elements.push(<NewDivider key="new-divider" />)
              newDividerRendered = true
            }
            elements.push(
              <ActivityBatch key={item.id} batch={item} currentUserId={currentUserId} />,
            )
          }
        } else {
          // Comment
          if (
            !newDividerRendered &&
            newDividerAt !== null &&
            newDividerAt > 0 &&
            item.createdAt > newDividerAt &&
            item.userId !== currentUserId
          ) {
            elements.push(<NewDivider key="new-divider" />)
            newDividerRendered = true
          }
          elements.push(
            <CommentCard
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              reactions={reactionsMap?.[item.id]}
              attachments={attachmentsMap?.[item.id]}
              onReply={onReply}
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />,
          )
          if (i === lastGroupedCommentIndex) {
            elements.push(
              <SeenBy key="seen-by" feed={feed} readReceipts={readReceipts} currentUserId={currentUserId} />,
            )
          }
        }

        return <Fragment key={item.id}>{elements}</Fragment>
      })}
    </div>
  )
}

/** Create an AuditBatch from a subset of items. */
function makeBatch(id: string, items: FeedItem[]): AuditBatch {
  const auditItems = items as (FeedItem & { kind: "audit" })[]
  return {
    kind: "batch",
    id,
    items: auditItems,
    count: auditItems.length,
    startTime: auditItems[0].createdAt,
    endTime: auditItems[auditItems.length - 1].createdAt,
  }
}

// ─── Feed builder ───────────────────────────────────────────────────────────────

function buildFeed(
  activities: { _id: string; type: string; userId: string; userName: string; metadata: unknown; createdAt: number }[] | undefined,
  comments: { _id: string; userId: string; userName: string; userImageUrl?: string; content: unknown; parentCommentId?: Id<"comments">; parentUserName?: string; parentPreview?: string; createdAt: number; updatedAt?: number }[] | undefined,
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
    updatedAt: c.updatedAt,
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
      <div className="-mt-1.5 mb-4 flex items-center justify-end gap-0.5 px-1">
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

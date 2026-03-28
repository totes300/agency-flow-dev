"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useMutation } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { ChatMessage } from "@/components/tasks/chat-message"
import { formatActivityText, type ActivityEventType } from "@/lib/activity"
import { mergeActivityFeed, type FeedItem } from "@/lib/task-detail"
import { groupFeedForCommentsView, computeMessageGrouping, computeDayDividers, getDayLabel, type GroupedFeedItem, type AuditBatch } from "@/lib/activity-grouping"
import { formatActivityTimestamp, firstName } from "@/lib/format"
import { ActivityBatch } from "@/components/tasks/activity-batch"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"

export type ReplyContext = { commentId: string; userName: string }

export type ActivityView = "comments" | "all"

interface ActivityFeedProps {
  taskId: Id<"tasks">
  isAdmin?: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  replyContext: ReplyContext | null
  onReplyContextChange?: (ctx: ReplyContext | null) => void
  view?: ActivityView
  onViewChange?: (view: ActivityView) => void
}

export function ActivityFeed({ taskId, isAdmin, scrollRef, replyContext, onReplyContextChange, view: viewProp, onViewChange }: ActivityFeedProps) {
  const { isAuthenticated } = useConvexAuth()

  const currentUser = useQuery(api.users.current, isAuthenticated ? {} : "skip")
  const activities = useQuery(api.activityLog.byTask, isAuthenticated ? { taskId } : "skip")
  const comments = useQuery(api.comments.byTask, isAuthenticated ? { taskId } : "skip")
  const reactionsMap = useQuery(api.commentReactions.byTask, isAuthenticated ? { taskId } : "skip")
  const attachmentsMap = useQuery(api.commentAttachments.byTask, isAuthenticated ? { taskId } : "skip")
  const readReceipts = useQuery(api.comments.readReceipts, isAuthenticated ? { taskId } : "skip")
  const myLastSeen = useQuery(api.comments.myLastSeen, isAuthenticated ? { taskId } : "skip")

  const toggleReaction = useMutation(api.commentReactions.toggle)
  const updateComment = useMutation(api.comments.update)
  const removeComment = useMutation(api.comments.remove)

  const handleReply = useCallback((commentId: string, userName: string) => {
    onReplyContextChange?.({ commentId, userName })
  }, [onReplyContextChange])

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

  // Mark comments as seen
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
  const [newDividerAt, setNewDividerAt] = useState<number | null>(null)
  const newDividerCaptured = useRef(false)
  useEffect(() => {
    if (!newDividerCaptured.current && myLastSeen !== undefined) {
      newDividerCaptured.current = true
      setNewDividerAt(myLastSeen)
    }
  }, [myLastSeen])

  // Stabilize reaction/attachment maps
  const stableReactionsMap = useMemo(() => reactionsMap, [JSON.stringify(reactionsMap)])
  const stableAttachmentsMap = useMemo(() => attachmentsMap, [JSON.stringify(attachmentsMap)])

  // View toggle: controlled via props, or internal fallback
  const [internalView, setInternalView] = useState<ActivityView>("comments")
  const view = viewProp ?? internalView
  const setView = onViewChange ?? setInternalView

  // Build unified timeline
  const feed = useMemo(() => buildFeed(activities, comments), [activities, comments])
  const groupedFeed = useMemo(
    () => (feed ? groupFeedForCommentsView(feed) : null),
    [feed],
  )

  // Slack-style message grouping
  const messageGrouping = useMemo(
    () => (feed ? computeMessageGrouping(feed) : new Map<string, boolean>()),
    [feed],
  )

  // Day dividers
  const dayDividers = useMemo(
    () => (feed ? computeDayDividers(feed) : new Map<string, string>()),
    [feed],
  )

  // Scroll management
  const feedLength = feed?.length ?? 0
  const receiptKey = readReceipts?.map((r) => r.lastSeenAt).join() ?? ""
  const [hasNewBelow, setHasNewBelow] = useState(false)
  const isScrolledUpRef = useRef(false)
  const prevFeedLengthRef = useRef(feedLength)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      isScrolledUpRef.current = !atBottom
      if (atBottom) setHasNewBelow(false)
    }
    el.addEventListener("scroll", handleScroll, { passive: true })
    return () => el.removeEventListener("scroll", handleScroll)
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || feedLength === 0) return

    if (isScrolledUpRef.current && feedLength > prevFeedLengthRef.current) {
      setHasNewBelow(true)
    } else if (!isScrolledUpRef.current) {
      el.scrollTop = el.scrollHeight
    }
    prevFeedLengthRef.current = feedLength
  }, [feedLength, receiptKey, view, scrollRef])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setHasNewBelow(false)
  }, [scrollRef])

  return (
    <>
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
          messageGrouping={messageGrouping}
          dayDividers={dayDividers}
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
          messageGrouping={messageGrouping}
          dayDividers={dayDividers}
          onReply={handleReply}
          onToggleReaction={handleToggleReaction}
          onEdit={handleEditComment}
          onDelete={handleDeleteComment}
        />
      )}

      {/* Floating "New messages" pill */}
      {hasNewBelow && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border/50 bg-background px-3 py-1.5 text-xs font-medium text-primary shadow-md transition-colors hover:bg-muted"
        >
          <span className="text-sm">↓</span>
          New messages
        </button>
      )}
    </>
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
  messageGrouping: Map<string, boolean>
  dayDividers: Map<string, string>
  onReply: (commentId: string, userName: string) => void
  onToggleReaction: (commentId: string, emoji: string) => void
  onEdit: (commentId: string, content: unknown) => void
  onDelete: (commentId: string) => void
}

// ─── All View — flat timeline ───────────────────────────────────────────────────

function AllView({
  feed,
  currentUserId,
  isAdmin,
  newDividerAt,
  reactionsMap,
  attachmentsMap,
  readReceipts,
  messageGrouping,
  dayDividers,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: ViewProps) {
  const lastCommentIndex = feed.findLastIndex((item) => item.kind === "comment")
  const firstNewIndex =
    newDividerAt !== null && newDividerAt > 0
      ? feed.findIndex(
          (item) =>
            item.kind === "comment" &&
            item.createdAt > newDividerAt &&
            item.userId !== currentUserId,
        )
      : -1

  return (
    <div className="flex flex-col">
      {feed.map((item, i) => {
        const dayLabel = dayDividers.get(item.id)
        return (
          <Fragment key={item.id}>
            {dayLabel && <DayDivider label={dayLabel} />}
            {i === firstNewIndex && <NewDivider />}
            {item.kind === "comment" ? (
              <ChatMessage
                item={item}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                isGrouped={messageGrouping.get(item.id) ?? false}
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
        )
      })}
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
  messageGrouping,
  dayDividers,
  onReply,
  onToggleReaction,
  onEdit,
  onDelete,
}: ViewProps & { groupedFeed: GroupedFeedItem[] }) {
  const lastGroupedCommentIndex = groupedFeed.findLastIndex((item) => item.kind === "comment")

  let newDividerRendered = false

  return (
    <div className="flex flex-col">
      {groupedFeed.map((item, i) => {
        const elements: React.ReactNode[] = []

        if (item.kind === "comment") {
          const dayLabel = dayDividers.get(item.id)
          if (dayLabel) {
            elements.push(<DayDivider key={`day-${dayLabel}`} label={dayLabel} />)
          }
        }

        if (item.kind === "batch") {
          elements.push(
            <ActivityBatch key={item.id} batch={item} currentUserId={currentUserId} />,
          )
        } else {
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
            <ChatMessage
              key={item.id}
              item={item}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              isGrouped={messageGrouping.get(item.id) ?? false}
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

// ─── Audit line ─────────────────────────────────────────────────────────────────

function AuditLine({ item, currentUserId }: { item: FeedItem & { kind: "audit" }; currentUserId?: Id<"users"> }) {
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

// ─── Day divider ────────────────────────────────────────────────────────────────

function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-border/55" />
      <span className="text-[11px] font-medium text-muted-foreground/65">{label}</span>
      <div className="h-px flex-1 bg-border/55" />
    </div>
  )
}

// ─── New divider ────────────────────────────────────────────────────────────────

function NewDivider() {
  return (
    <div className="my-3 flex items-center gap-3">
      <div className="h-px flex-1 bg-destructive/50" />
      <span className="text-[9px] font-medium text-destructive/70">New</span>
      <div className="h-px flex-1 bg-destructive/50" />
    </div>
  )
}

// ─── Seen by ────────────────────────────────────────────────────────────────────

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

  const lastComment = [...feed].reverse().find((item) => item.kind === "comment")
  if (!lastComment) return null

  if (lastComment.userId !== currentUserId) return null

  const seenUsers = readReceipts.filter((r) => r.lastSeenAt >= lastComment.createdAt)
  if (seenUsers.length === 0) return null

  return (
    <TooltipProvider>
      <div className="mb-2 mt-0.5 flex items-center gap-0.5 pl-[38px]">
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

// ─── View toggle (reusable by parents) ──────────────────────────────────────────

export function ActivityViewToggle({
  view,
  onViewChange,
}: {
  view: ActivityView
  onViewChange: (v: ActivityView) => void
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      <button
        className={cn(
          "rounded px-2.5 py-1 text-xs font-medium transition-colors",
          view === "comments"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onViewChange("comments")}
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
        onClick={() => onViewChange("all")}
      >
        All
      </button>
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

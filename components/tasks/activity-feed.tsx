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
import { toastError } from "@/lib/toast-helpers"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"

export type ReplyContext = { commentId: string; userName: string }

export type ActivityView = "comments" | "all"

export type CommentCounts = {
  total: number
  unread: number
}

interface ActivityFeedProps {
  taskId: Id<"tasks">
  isAdmin?: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
  replyContext: ReplyContext | null
  onReplyContextChange?: (ctx: ReplyContext | null) => void
  view?: ActivityView
  onViewChange?: (view: ActivityView) => void
  onCommentCounts?: (counts: CommentCounts) => void
}

export function ActivityFeed({ taskId, isAdmin, scrollRef, replyContext, onReplyContextChange, view: viewProp, onViewChange, onCommentCounts }: ActivityFeedProps) {
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
    async (commentId: string, emoji: string) => {
      try {
        await toggleReaction({ commentId: commentId as Id<"comments">, emoji })
      } catch (err) {
        toastError(err, "Failed to update reaction")
      }
    },
    [toggleReaction],
  )

  const handleEditComment = useCallback(
    async (commentId: string, content: unknown) => {
      try {
        await updateComment({ id: commentId as Id<"comments">, content })
      } catch (err) {
        toastError(err, "Failed to update comment")
      }
    },
    [updateComment],
  )

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      try {
        await removeComment({ id: commentId as Id<"comments"> })
      } catch (err) {
        toastError(err, "Failed to delete comment")
      }
    },
    [removeComment],
  )

  // Mark comments as seen — only when the activity section scrolls into view
  const markSeen = useMutation(api.comments.markSeen)
  const commentCount = comments?.length ?? 0
  const currentUserId = currentUser?._id
  const sentinelRef = useRef<HTMLDivElement>(null)
  const markSeenFiredRef = useRef(false)

  // Reset markSeen flag when task changes (newDivider reset is below with its declaration)
  useEffect(() => {
    markSeenFiredRef.current = false
  }, [taskId])

  useEffect(() => {
    const sentinel = sentinelRef.current
    const scrollContainer = scrollRef.current
    if (!sentinel || !scrollContainer || !isAuthenticated) return

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !markSeenFiredRef.current) {
          markSeenFiredRef.current = true
          void markSeen({ taskId })
        }
      },
      { root: scrollContainer, threshold: 0 },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [isAuthenticated, taskId, markSeen, scrollRef, commentCount])

  // Freeze lastSeenAt on first load so the "New" divider survives the markSeen update.
  const [newDividerAt, setNewDividerAt] = useState<number | null>(null)
  const newDividerCaptured = useRef(false)

  // Reset newDivider state when switching tasks
  useEffect(() => {
    newDividerCaptured.current = false
    setNewDividerAt(null)
  }, [taskId])

  useEffect(() => {
    if (!newDividerCaptured.current && myLastSeen !== undefined) {
      newDividerCaptured.current = true
      setNewDividerAt(myLastSeen)
    }
  }, [myLastSeen])

  // Report comment counts to parent for badge display
  const unreadCommentCount = useMemo(() => {
    if (!comments || myLastSeen === undefined || !currentUserId) return 0
    return comments.filter(
      (c) => c.createdAt > myLastSeen && c.userId !== currentUserId,
    ).length
  }, [comments, myLastSeen, currentUserId])

  const prevCountsRef = useRef<string>("")
  useEffect(() => {
    const key = `${commentCount}:${unreadCommentCount}`
    if (key !== prevCountsRef.current) {
      prevCountsRef.current = key
      onCommentCounts?.({ total: commentCount, unread: unreadCommentCount })
    }
  }, [commentCount, unreadCommentCount, onCommentCounts])

  // Stabilize reaction/attachment maps — use a ref to compare serialized snapshots
  // without running JSON.stringify on every render
  const prevReactionsKeyRef = useRef("")
  const stableReactionsRef = useRef(reactionsMap)
  const reactionsKey = reactionsMap ? JSON.stringify(reactionsMap) : ""
  if (reactionsKey !== prevReactionsKeyRef.current) {
    prevReactionsKeyRef.current = reactionsKey
    stableReactionsRef.current = reactionsMap
  }
  const stableReactionsMap = stableReactionsRef.current

  const prevAttachmentsKeyRef = useRef("")
  const stableAttachmentsRef = useRef(attachmentsMap)
  const attachmentsKey = attachmentsMap ? JSON.stringify(attachmentsMap) : ""
  if (attachmentsKey !== prevAttachmentsKeyRef.current) {
    prevAttachmentsKeyRef.current = attachmentsKey
    stableAttachmentsRef.current = attachmentsMap
  }
  const stableAttachmentsMap = stableAttachmentsRef.current

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
      {/* Sentinel for IntersectionObserver — marks comments as seen when scrolled into view */}
      <div ref={sentinelRef} className="h-0 w-0" aria-hidden />

      {feed === null ? (
        <FeedSkeleton />
      ) : feed.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-xs text-muted-foreground/50">
          No activity yet
        </div>
      ) : view === "comments" ? (
        <CommentsOnlyView
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

// ─── Comments Only View — no activity entries ──────────────────────────────────

function CommentsOnlyView({
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
  const commentsOnly = useMemo(() => feed.filter((item) => item.kind === "comment"), [feed])

  // Recompute day dividers and message grouping for comments-only list
  const commentDayDividers = useMemo(() => computeDayDividers(commentsOnly), [commentsOnly])
  const commentGrouping = useMemo(() => computeMessageGrouping(commentsOnly), [commentsOnly])

  const lastIndex = commentsOnly.length - 1
  const firstNewIndex =
    newDividerAt !== null && newDividerAt > 0
      ? commentsOnly.findIndex(
          (item) => item.createdAt > newDividerAt && item.userId !== currentUserId,
        )
      : -1

  if (commentsOnly.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-xs text-muted-foreground/50">
        No comments yet
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {commentsOnly.map((item, i) => {
        const dayLabel = commentDayDividers.get(item.id)
        return (
          <Fragment key={item.id}>
            {dayLabel && <DayDivider label={dayLabel} />}
            {i === firstNewIndex && <NewDivider />}
            <ChatMessage
              item={item}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              isGrouped={commentGrouping.get(item.id) ?? false}
              reactions={reactionsMap?.[item.id]}
              attachments={attachmentsMap?.[item.id]}
              onReply={onReply}
              onToggleReaction={onToggleReaction}
              onEdit={onEdit}
              onDelete={onDelete}
            />
            {i === lastIndex && (
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
  // Compute lane line positions based on same-user continuity.
  // The lane connects ALL consecutive same-user comments, broken by batches, dividers, or user change.
  // Independent of the 5-min compact grouping threshold.
  //
  // newDividerBreakId: if a "New" divider will be inserted before a comment, that breaks the lane.
  const laneInfo = useMemo(() => {
    let newDividerBreakId: string | null = null
    if (newDividerAt !== null && newDividerAt > 0) {
      for (const item of groupedFeed) {
        if (item.kind === "comment" && item.createdAt > newDividerAt && item.userId !== currentUserId) {
          newDividerBreakId = item.id
          break
        }
      }
    }

    const hasLaneAbove = new Map<string, boolean>()
    const hasLaneBelow = new Map<string, boolean>()

    for (let i = 0; i < groupedFeed.length; i++) {
      const item = groupedFeed[i]
      if (item.kind !== "comment") continue

      const prev = groupedFeed[i - 1]
      const prevSameUser = prev?.kind === "comment" && prev.userId === item.userId
      const hasDayDivider = dayDividers.has(item.id)
      const isNewBreak = item.id === newDividerBreakId
      hasLaneAbove.set(item.id, prevSameUser && !hasDayDivider && !isNewBreak)

      const next = groupedFeed[i + 1]
      const nextSameUser = next?.kind === "comment" && next.userId === item.userId
      const nextHasDayDivider = next?.kind === "comment" && dayDividers.has(next.id)
      const nextIsNewBreak = next?.kind === "comment" && next.id === newDividerBreakId
      hasLaneBelow.set(item.id, nextSameUser && !nextHasDayDivider && !nextIsNewBreak)
    }

    return { hasLaneAbove, hasLaneBelow }
  }, [groupedFeed, dayDividers, newDividerAt, currentUserId])

  const lastGroupedCommentIndex = groupedFeed.findLastIndex((item) => item.kind === "comment")
  let newDividerRendered = false
  const rendered: React.ReactNode[] = []

  groupedFeed.forEach((item, i) => {
    if (item.kind === "comment") {
      const dayLabel = dayDividers.get(item.id)
      if (dayLabel) {
        rendered.push(<DayDivider key={`day-${dayLabel}`} label={dayLabel} />)
      }
    }

    if (
      item.kind === "comment" &&
      !newDividerRendered &&
      newDividerAt !== null &&
      newDividerAt > 0 &&
      item.createdAt > newDividerAt &&
      item.userId !== currentUserId
    ) {
      rendered.push(<NewDivider key="new-divider" />)
      newDividerRendered = true
    }

    if (item.kind === "batch") {
      rendered.push(
        <ActivityBatch key={item.id} batch={item} currentUserId={currentUserId} />,
      )
    } else {
      const isGrouped = messageGrouping.get(item.id) ?? false
      rendered.push(
        <ChatMessage
          key={item.id}
          item={item}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          isGrouped={isGrouped}
          laneAbove={laneInfo.hasLaneAbove.get(item.id) ?? false}
          laneBelow={laneInfo.hasLaneBelow.get(item.id) ?? false}
          reactions={reactionsMap?.[item.id]}
          attachments={attachmentsMap?.[item.id]}
          onReply={onReply}
          onToggleReaction={onToggleReaction}
          onEdit={onEdit}
          onDelete={onDelete}
        />,
      )
      if (i === lastGroupedCommentIndex) {
        rendered.push(
          <SeenBy key="seen-by" feed={feed} readReceipts={readReceipts} currentUserId={currentUserId} />,
        )
      }
    }
  })

  return <div className="flex flex-col">{rendered}</div>
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
      <div className="h-px flex-1 bg-border/40" />
      <span className="text-[11px] font-medium text-muted-foreground/65">{label}</span>
      <div className="h-px flex-1 bg-border/40" />
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

  const lastComment = feed.findLast((item) => item.kind === "comment")
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
    <div role="radiogroup" aria-label="Activity view" className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
      <button
        role="radio"
        aria-checked={view === "all"}
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
      <button
        role="radio"
        aria-checked={view === "comments"}
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

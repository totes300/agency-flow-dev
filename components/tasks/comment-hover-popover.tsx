"use client"

import { useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { UserAvatar } from "@/components/user-avatar"
import { formatRelativeTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Id } from "@/convex/_generated/dataModel"

export function CommentHoverPopover({
  taskId,
  totalCount,
  onOpenDetail,
  children,
}: {
  taskId: Id<"tasks">
  totalCount?: number
  onOpenDetail?: (taskId: string) => void
  children: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const data = useQuery(
    api.comments.latestPreview,
    isOpen ? { taskId } : "skip",
  )

  return (
    <HoverCard openDelay={250} closeDelay={100} open={isOpen} onOpenChange={setIsOpen}>
      <HoverCardTrigger asChild>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="center" className="w-[320px] p-0 hidden md:block">
        <div className="px-4 pt-3 pb-1">
          <p className="text-xs font-medium text-muted-foreground">
            Comments{totalCount != null && <span className="ml-1 text-muted-foreground/50">{totalCount}</span>}
          </p>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {!data ? (
            <div className="divide-y divide-border/40">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-3">
                  <div className="size-5 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <div className="h-2.5 w-24 rounded bg-muted animate-pulse" />
                    <div className="h-2.5 w-full rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground/60">No comments yet</p>
          ) : (
            <div className="divide-y divide-border/40">
              {data.map((comment) => (
                <div key={comment._id} className="flex items-start gap-2.5 px-4 py-3">
                  <UserAvatar
                    name={comment.userName}
                    imageUrl={comment.userImageUrl}
                    className="size-5 text-[8px] shrink-0 mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1">
                      <span className="text-xs font-semibold truncate">{comment.userName}</span>
                      <span className="text-muted-foreground/30 shrink-0">·</span>
                      <span className="text-[11px] text-muted-foreground/70 shrink-0">
                        {formatRelativeTime(comment.createdAt)}
                      </span>
                      {comment.isUnread && (
                        <span className="size-1.5 rounded-full bg-blue-500 shrink-0 relative top-[-1px]" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-foreground/70 line-clamp-2 leading-relaxed">
                      {comment.preview}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-4 py-2.5 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            View all comments
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

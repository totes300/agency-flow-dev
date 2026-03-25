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
  onOpenDetail,
  children,
}: {
  taskId: Id<"tasks">
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
      <HoverCardContent align="start" className="w-80 p-0 hidden md:block">
        <div className="p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Recent Comments</p>
          {!data ? (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="size-5 rounded-full bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-1/3 rounded bg-muted animate-pulse" />
                    <div className="h-3 w-full rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : data.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">No comments yet</p>
          ) : (
            <div className="space-y-1">
              {data.map((comment) => (
                <div
                  key={comment._id}
                  className={cn(
                    "rounded-md px-2 py-1.5",
                    comment.isUnread && "bg-primary/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <UserAvatar
                      name={comment.userName}
                      imageUrl={comment.userImageUrl}
                      className="size-5 text-[8px]"
                    />
                    <span className="text-xs font-medium truncate">{comment.userName}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
                      {formatRelativeTime(comment.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 ml-7 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {comment.preview}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
        {onOpenDetail && (
          <button
            className="w-full border-t border-border/40 px-3 py-2 text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            onClick={() => onOpenDetail(taskId)}
          >
            View all comments
          </button>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

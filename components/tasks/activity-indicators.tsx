"use client"

import { MessageCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Comment pill — gray when seen, red when unseen. */
export function CommentPill({ count, unreadCount, hasUnseen }: { count: number; unreadCount: number; hasUnseen: boolean }) {
  const displayCount = hasUnseen ? unreadCount : count

  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 h-[22px] text-[11px] tabular-nums font-medium",
      hasUnseen
        ? "bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
        : "bg-muted text-muted-foreground",
    )}>
      <MessageCircleIcon className="size-3" strokeWidth={hasUnseen ? 2.5 : 2.25} />
      {displayCount}
    </span>
  )
}

/** Inline 13px progress ring — sits next to the task title, same visual weight as FileTextIcon. */
export function InlineSubtaskRing({ done, total, isUnseen }: { done: number; total: number; isUnseen: boolean }) {
  if (total === 0) return null
  const circumference = 2 * Math.PI * 6
  const progress = done / total
  const offset = circumference * (1 - progress)
  const isComplete = done === total

  return (
    <svg width={13} height={13} viewBox="0 0 16 16" className="block">
      <circle
        cx={8} cy={8} r={6}
        fill="none"
        stroke={isComplete && isUnseen ? "none" : "var(--border)"}
        strokeWidth={1.75}
      />
      {progress > 0 ? (
        <circle
          cx={8} cy={8} r={6}
          fill="none"
          className={isComplete && isUnseen ? "stroke-emerald-500" : isUnseen ? "stroke-foreground" : "stroke-muted-foreground"}
          strokeWidth={isUnseen ? 2 : 1.75}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
          style={isComplete && isUnseen ? { opacity: 1 } : isUnseen ? { opacity: 0.7 } : { opacity: 0.45 }}
        />
      ) : null}
    </svg>
  )
}

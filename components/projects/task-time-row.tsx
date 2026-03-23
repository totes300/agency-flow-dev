"use client"

import { formatMinutes, formatDateRange } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = {
  taskId: string
  title: string
  firstDate: string
  lastDate: string
  totalMinutes: number
  onClick: (taskId: string) => void
  muted?: boolean
}

export function TaskTimeRow({ taskId, title, firstDate, lastDate, totalMinutes, onClick, muted }: Props) {
  return (
    <div className="flex items-center gap-3 pl-8 py-1">
      <span className={cn("w-20 shrink-0 text-xs tabular-nums", muted ? "text-muted-foreground/50" : "text-muted-foreground")}>
        {formatDateRange(firstDate, lastDate)}
      </span>
      <button
        type="button"
        onClick={() => onClick(taskId)}
        className={cn(
          "min-w-0 truncate text-left text-sm hover:underline",
          muted ? "text-muted-foreground" : "text-foreground"
        )}
      >
        {title}
      </button>
      <span className={cn(
        "ml-auto shrink-0 font-mono text-xs font-medium tabular-nums",
        muted ? "text-muted-foreground/70" : "text-foreground"
      )}>
        {formatMinutes(totalMinutes)}
      </span>
    </div>
  )
}

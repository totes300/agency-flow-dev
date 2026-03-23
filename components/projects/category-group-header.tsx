"use client"

import { getCategoryColor } from "@/convex/lib/constants"
import { formatMinutes, formatCurrencyPrecise } from "@/lib/format"
import { cn } from "@/lib/utils"

type Props = {
  categoryName: string
  categoryColor: string
  taskCount: number
  totalMinutes: number
  totalAmount?: number
  currency?: string
  muted?: boolean
}

export function CategoryGroupHeader({
  categoryName,
  categoryColor,
  taskCount,
  totalMinutes,
  totalAmount,
  currency,
  muted,
}: Props) {
  const c = getCategoryColor(categoryColor)

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: muted ? undefined : c.text, opacity: muted ? 0.4 : 1 }}
      />
      <span className={cn("text-sm font-semibold", muted && "text-muted-foreground font-medium")}>
        {categoryName}
      </span>
      <span className={cn("text-xs", muted ? "text-muted-foreground/50" : "text-muted-foreground")}>
        {taskCount} {taskCount === 1 ? "task" : "tasks"}
      </span>
      <span className={cn(
        "ml-auto font-mono text-xs font-medium tabular-nums",
        muted ? "text-muted-foreground/70" : "text-foreground"
      )}>
        {formatMinutes(totalMinutes)}
        {totalAmount != null && totalAmount > 0 && currency && (
          <span className="text-muted-foreground"> · {formatCurrencyPrecise(totalAmount, currency)}</span>
        )}
      </span>
    </div>
  )
}

import { cn } from "@/lib/utils"
import { PROGRESS_TRACK, PROGRESS_FILL, PROGRESS_FILL_MUTED } from "@/lib/table-tokens"

/**
 * Progress bar + percentage in a table cell.
 * Flat, sharp bar (rounded-sm) with dark fill — spreadsheet aesthetic.
 */
export function ProgressCell({
  percent,
  muted,
  className,
}: {
  percent: number | null
  muted?: boolean
  className?: string
}) {
  if (percent === null) {
    return <span className="text-sm text-muted-foreground">—</span>
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("flex-1 max-w-28 overflow-hidden", PROGRESS_TRACK)}>
        <div
          className={muted ? PROGRESS_FILL_MUTED : PROGRESS_FILL}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <span className={cn("text-sm tabular-nums", muted ? "text-muted-foreground/60" : "text-muted-foreground")}>
        {percent}%
      </span>
    </div>
  )
}

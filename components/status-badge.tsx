import { getStatusColor } from "@/lib/status-colors"
import { StatusIcon } from "@/components/status-icon"
import { cn } from "@/lib/utils"
import type { StatusType } from "@/convex/lib/constants"

/**
 * Displays a status as a pill with a Linear-style SVG icon.
 * Used in task lists, project views, and settings.
 */
export function StatusBadge({
  name,
  color,
  type,
  className,
}: {
  name: string
  color: string
  type?: StatusType | "backlog"
  className?: string
}) {
  const cfg = getStatusColor(color)
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex w-fit items-center gap-[5px] rounded-full border border-border/50 py-0.5 pl-1.5 pr-2 text-xs font-normal leading-[18px] text-muted-foreground",
        className,
      )}
    >
      {type ? (
        <StatusIcon type={type} color={cfg.dot} size={14} />
      ) : (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: cfg.dot }}
        />
      )}
      {name}
    </span>
  )
}

import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import type { StatusColorName } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a status as a pill with a colored dot.
 * Used in task lists, project views, and settings.
 */
export function StatusBadge({
  name,
  color,
  className,
}: {
  name: string
  color: string
  className?: string
}) {
  const cfg = STATUS_COLOR_CONFIG[color as StatusColorName]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted/60 py-0.5 pl-1.5 pr-2.5 text-xs font-medium leading-4",
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{
          backgroundColor: cfg?.dot ?? STATUS_COLOR_CONFIG.gray.dot,
        }}
      />
      {name}
    </span>
  )
}

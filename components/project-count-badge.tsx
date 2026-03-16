import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import { cn } from "@/lib/utils"

export function ProjectCountBadge({
  count,
  className,
}: {
  count: number
  className?: string
}) {
  const isActive = count > 0
  const dotColor = isActive
    ? STATUS_COLOR_CONFIG.green.dot
    : STATUS_COLOR_CONFIG.amber.dot

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-muted/60 py-0.5 pl-1.5 pr-2.5 text-xs font-medium leading-4",
        className,
      )}
    >
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      {isActive ? `${count} active` : "0 pending"}
    </span>
  )
}

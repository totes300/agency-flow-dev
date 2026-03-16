import { getStatusColor } from "@/lib/status-colors"
import { cn } from "@/lib/utils"

/**
 * Small colored dot representing a status color.
 * Used in onboarding forms and compact status indicators.
 */
export function StatusDot({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const cfg = getStatusColor(color)
  return (
    <span
      className={cn("inline-block size-3 rounded-full", className)}
      style={{ backgroundColor: cfg.dot }}
    />
  )
}

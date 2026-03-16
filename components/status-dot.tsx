import { STATUS_COLOR_CONFIG } from "@/lib/status-colors"
import type { StatusColorName } from "@/convex/lib/constants"
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
  const cfg = STATUS_COLOR_CONFIG[color as StatusColorName]
  return (
    <span
      className={cn("inline-block size-3 rounded-full", className)}
      style={{ backgroundColor: cfg?.dot ?? STATUS_COLOR_CONFIG.gray.dot }}
    />
  )
}

import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Small colored dot representing a category color.
 * Used in onboarding forms and compact category indicators.
 */
export function CategoryDot({
  color,
  className,
}: {
  color: string
  className?: string
}) {
  const c = getCategoryColor(color)
  return (
    <span
      className={cn("inline-block size-3 rounded-full", className)}
      style={{ backgroundColor: c.text }}
    />
  )
}

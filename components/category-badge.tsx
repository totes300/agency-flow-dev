import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a work category as a colored pill.
 * Used in task lists, time entries, project views, and settings.
 */
export function CategoryBadge({
  name,
  color,
  className,
}: {
  name: string
  color: string
  className?: string
}) {
  const c = getCategoryColor(color)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium leading-4",
        className,
      )}
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {name}
    </span>
  )
}

import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a work category as a colored badge (Tailwind style).
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
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        className,
      )}
      style={{
        backgroundColor: c.bg,
        color: c.text,
        boxShadow: `inset 0 0 0 1px ${c.ring}`,
      }}
    >
      {name}
    </span>
  )
}

import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a work category as a tinted pill with colored dot.
 * 6e style: faint tinted bg + dot + muted text.
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
      data-slot="category-badge"
      className={cn(
        "inline-flex w-fit items-center gap-[5px] rounded-full py-0.5 pl-[7px] pr-[9px] text-xs font-normal leading-[18px] text-muted-foreground",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${c.dot} 7%, transparent)`,
      }}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: c.dot }}
      />
      {name}
    </span>
  )
}

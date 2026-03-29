import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a work category as a tinted badge with colored dot.
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
        "inline-flex w-fit items-center gap-[5px] rounded-[5px] py-[3px] pl-[7px] pr-[9px] text-xs font-normal leading-[18px]",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${c.dot} 13%, transparent)`,
        color: `color-mix(in srgb, ${c.dot} 72%, var(--color-foreground))`,
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

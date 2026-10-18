import { getCategoryColor } from "@/convex/lib/constants"
import { cn } from "@/lib/utils"

/**
 * Displays a work category as a tinted badge with colored dot.
 * Used in task lists, time entries, project views, and settings.
 * `plain` drops the tint (dot + muted name) for dense surfaces such as board
 * cards, where a filled pill on every card is too heavy.
 */
export function CategoryBadge({
  name,
  color,
  variant = "tinted",
  className,
}: {
  name: string
  color: string
  variant?: "tinted" | "plain"
  className?: string
}) {
  const c = getCategoryColor(color)
  if (variant === "plain") {
    return (
      <span
        data-slot="category-badge"
        className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}
      >
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} />
        <span className="truncate">{name}</span>
      </span>
    )
  }
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

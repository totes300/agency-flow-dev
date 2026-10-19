import { PRIORITY, PRIORITY_LABELS, type TaskPriority } from "@/convex/tasks/model"
import { cn } from "@/lib/utils"

/**
 * Linear-style priority icon (D7: 0 none, 1 urgent, 2 high, 3 medium, 4 low).
 * None = three dashes, urgent = filled "!" square, high/medium/low = three
 * bars with 3/2/1 filled. Drawn in foreground tints so it follows the theme.
 */
export function PriorityIcon({
  priority,
  size = 16,
  label = true,
  className,
}: {
  priority: TaskPriority
  size?: number
  /** Expose the priority name as the accessible name (default). */
  label?: boolean
  className?: string
}) {
  const a11y = label
    ? { role: "img", "aria-label": PRIORITY_LABELS[priority] }
    : { "aria-hidden": true }

  if (priority === PRIORITY.none) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={cn("shrink-0 fill-muted-foreground", className)} {...a11y}>
        <rect x="1.5" y="7.25" width="3" height="1.5" rx=".6" />
        <rect x="6.5" y="7.25" width="3" height="1.5" rx=".6" />
        <rect x="11.5" y="7.25" width="3" height="1.5" rx=".6" />
      </svg>
    )
  }

  if (priority === PRIORITY.urgent) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" className={cn("shrink-0", className)} {...a11y}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" className="fill-foreground/70" />
        <path d="M8 4.3v4.4" stroke="var(--background)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.3" r="1" fill="var(--background)" />
      </svg>
    )
  }

  const filled = priority === PRIORITY.high ? 3 : priority === PRIORITY.medium ? 2 : 1
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={cn("shrink-0", className)} {...a11y}>
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={1.75 + i * 4.75}
          y={9.5 - i * 3}
          width="3"
          height={4.75 + i * 3}
          rx=".9"
          className={i < filled ? "fill-foreground/70" : "fill-foreground/15"}
        />
      ))}
    </svg>
  )
}

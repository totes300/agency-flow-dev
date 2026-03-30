import { getStatusColor } from "@/lib/status-colors"
import { StatusIcon } from "@/components/status-icon"
import { cn } from "@/lib/utils"
import type { StatusType } from "@/convex/lib/constants"

/**
 * Displays a status as a badge with a Linear-style SVG icon.
 *
 * Variants:
 * - `"solid"` (default): Tinted background from status color, colored text/icons.
 * - `"inline"`: Icon + text only, no background. For use inside dropdown lists.
 */
export function StatusBadge({
  name,
  color,
  type,
  variant = "solid",
  className,
}: {
  name: string
  color: string
  type?: StatusType | "backlog"
  variant?: "solid" | "inline"
  className?: string
}) {
  const cfg = getStatusColor(color)
  const isGray = color === "gray"

  if (variant === "inline") {
    return (
      <span
        data-slot="status-badge"
        className={cn(
          "inline-flex w-fit items-center gap-[5px] text-xs font-normal text-foreground",
          className,
        )}
      >
        {type ? (
          <StatusIcon type={type} color={cfg.dot} size={14} />
        ) : (
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: cfg.dot }}
          />
        )}
        {name}
      </span>
    )
  }

  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex w-fit items-center gap-[5px] rounded-[5px] py-[3px] pl-[6px] pr-[9px] text-xs font-normal leading-[18px]",
        isGray && "bg-gray-200/60 text-gray-500 dark:bg-gray-600/30 dark:text-gray-400",
        className,
      )}
      style={!isGray ? {
        backgroundColor: `color-mix(in srgb, ${cfg.dot} 13%, transparent)`,
        color: `color-mix(in srgb, ${cfg.dot} 72%, var(--color-foreground))`,
      } : undefined}
    >
      {type ? (
        <StatusIcon type={type} color={cfg.dot} size={14} />
      ) : (
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: cfg.dot }}
        />
      )}
      {name}
    </span>
  )
}

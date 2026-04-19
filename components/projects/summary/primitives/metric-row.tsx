import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type MetricRowProps = {
  label: string
  value: string
  /**
   * Optional contextual note rendered on the same baseline as the value.
   * Accepts any ReactNode so consumers can inline icons, badges, or
   * formatted fragments without forking the row.
   */
  detail?: ReactNode
  /**
   * Optional adornment rendered inline with the value (e.g. a trend icon).
   */
  trailing?: ReactNode
  variant?: "default" | "destructive" | "positive"
  className?: string
}

/**
 * A single label + value pair with optional inline detail/trailing adornment,
 * designed for the Project Summary card's column body. Detail renders on the
 * same baseline as the value (not below it) so every MetricRow is two lines
 * tall regardless of detail presence — grid rows line up across columns.
 * Detail wraps below only when the cell is too narrow.
 */
export function MetricRow({
  label,
  value,
  detail,
  trailing,
  variant = "default",
  className,
}: MetricRowProps) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "text-lg font-semibold leading-tight tracking-tight tabular-nums",
            variant === "destructive" && "text-destructive",
            variant === "positive" && "text-success",
          )}
        >
          {value}
        </span>
        {trailing}
        {detail && (
          <span className="text-xs text-muted-foreground tabular-nums">{detail}</span>
        )}
      </div>
    </div>
  )
}

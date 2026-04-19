import { AlertTriangleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMinutes } from "@/lib/format"

type BudgetArcProps = {
  usedMinutes: number
  budgetMinutes: number
  ariaLabel?: string
  className?: string
}

const WIDTH = 128
const HEIGHT = 72
const STROKE_WIDTH = 10
const RADIUS = 54
const ARC_LENGTH = Math.PI * RADIUS
const ARC_PATH = `M 10 64 A ${RADIUS} ${RADIUS} 0 0 1 118 64`

/**
 * Semicircle budget gauge. Arc fills clockwise from the left endpoint toward
 * the right in proportion to `usedMinutes / budgetMinutes`. When over budget,
 * the arc renders fully in destructive color — the exact overage is meant to
 * live in a sibling surface (e.g. the Overage column) so we don't duplicate.
 *
 * Basin content is deliberately just the used-time value and the budget
 * context — the section title owns the "which metric is this?" answer.
 */
export function BudgetArc({
  usedMinutes,
  budgetMinutes,
  ariaLabel = "Total hours",
  className,
}: BudgetArcProps) {
  const hasBudget = budgetMinutes > 0
  const ratio = hasBudget ? usedMinutes / budgetMinutes : 0
  const clamped = Math.min(Math.max(ratio, 0), 1)
  const isOver = usedMinutes > budgetMinutes && hasBudget
  const dashOffset = ARC_LENGTH * (1 - clamped)
  const percent = Math.round(ratio * 100)

  const accessibleLabel = hasBudget
    ? `${ariaLabel}: ${formatMinutes(usedMinutes)} of ${formatMinutes(budgetMinutes)} budget (${percent}%${isOver ? ", over budget" : ""})`
    : `${ariaLabel}: ${formatMinutes(usedMinutes)}, no budget set`

  return (
    <div className={cn("flex shrink-0 flex-col items-center", className)}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={accessibleLabel}
        className="block"
      >
        <path
          d={ARC_PATH}
          fill="none"
          className="stroke-muted"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
        <path
          d={ARC_PATH}
          fill="none"
          className={cn(
            "transition-[stroke-dashoffset] duration-500 ease-out",
            isOver ? "stroke-destructive" : "stroke-foreground",
          )}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={isOver ? 0 : dashOffset}
        />
      </svg>
      <div className="-mt-6 flex flex-col items-center gap-0.5">
        <div className="flex items-center gap-1">
          {isOver && (
            <AlertTriangleIcon aria-hidden className="size-3.5 text-destructive" />
          )}
          <p
            className={cn(
              "text-xl font-semibold leading-none tracking-tight tabular-nums",
              isOver && "text-destructive",
            )}
          >
            {formatMinutes(usedMinutes)}
          </p>
        </div>
        {hasBudget && (
          <p className="text-xs leading-tight text-muted-foreground tabular-nums">
            of {formatMinutes(budgetMinutes)} budget
          </p>
        )}
      </div>
    </div>
  )
}

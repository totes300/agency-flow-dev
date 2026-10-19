import { cn } from "@/lib/utils"

const SIZE = 14
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Linear-style inline progress ring for table cells: a thin grey track and an
 * arc for how much of the budget is used. Neutral by design (no colour) — a
 * lighter arc while under budget, a full foreground ring at or over it. The
 * exact numbers live in the text beside it; this is only the glanceable signal.
 */
export function BudgetRing({
  used,
  budget,
  className,
}: {
  used: number
  budget: number
  className?: string
}) {
  const ratio = budget > 0 ? used / budget : 0
  const filled = Math.min(Math.max(ratio, 0), 1)
  const full = budget > 0 && used >= budget

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${Math.round(ratio * 100)}% of budget used`}
      className={cn("shrink-0", className)}
    >
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        className="stroke-border"
        strokeWidth={STROKE}
      />
      {filled > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          className={full ? "stroke-foreground" : "stroke-muted-foreground"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${filled * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
    </svg>
  )
}

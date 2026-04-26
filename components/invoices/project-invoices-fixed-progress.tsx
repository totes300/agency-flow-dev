import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"

/**
 * Fixed-price projects' type-specific third card.
 *
 *   under budget   → neutral tone, progress bar up to %
 *   over budget    → red tone, bar capped at 100% with an "Over by $Z" pill
 *
 * Over-budget is the card's *only* color signal — we don't also turn
 * "Past due" red for the same reason, since that tracks collections risk
 * which is independent of scope creep.
 */
export function ProjectInvoicesFixedProgress({
  billed,
  budget,
  currency,
}: {
  billed: number
  budget: number
  currency: string
}) {
  const hasBudget = budget > 0
  const overBy = billed - budget
  const isOver = hasBudget && overBy > 0

  const percent = hasBudget
    ? Math.round((billed / budget) * 100)
    : 0
  const barPercent = Math.min(percent, 100)

  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground">Budget</p>
          {isOver && (
            <span className="inline-flex items-center rounded-[5px] border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive tabular-nums">
              Over by {formatCurrency(overBy, currency)}
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
            isOver && "text-destructive",
          )}
        >
          {hasBudget ? `${percent}%` : "—"}
        </p>
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {formatCurrency(billed, currency)}
          {hasBudget ? ` of ${formatCurrency(budget, currency)}` : " billed"}
        </div>

        {hasBudget && (
          <div
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                isOver ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${barPercent}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

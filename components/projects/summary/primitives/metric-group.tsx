import { cn } from "@/lib/utils"

type MetricGroupProps = {
  children: React.ReactNode
  /**
   * Number of columns. Defaults to 2 — the dominant pattern in the summary
   * card. Use 3 when a group has 6+ evenly-weighted metrics and the column is
   * wide enough; use 1 when you need stack spacing that still participates in
   * the column's gap rhythm.
   */
  columns?: 1 | 2 | 3
  className?: string
}

const COLUMN_CLASS: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
}

/**
 * A row-major grid of metric rows, used inside a SummaryColumn. Row gap is
 * matched to the column's vertical rhythm (gap-3) so stacked `MetricRow`s and
 * grouped rows feel uniform.
 *
 * Compose with a lead `MetricRow` sibling above it for a "headline + breakdown"
 * layout, or use on its own when every metric has equal weight.
 */
export function MetricGroup({ children, columns = 2, className }: MetricGroupProps) {
  return (
    <div
      className={cn(
        "grid items-start gap-x-6 gap-y-3",
        COLUMN_CLASS[columns],
        className,
      )}
    >
      {children}
    </div>
  )
}

import { cn } from "@/lib/utils"

type SummaryColumnProps = {
  title: string
  children: React.ReactNode
  className?: string
}

/**
 * One column in the Project Summary card. Holds a column title and a vertical
 * stack of metric rows (or groups) underneath. For a 2-column metric layout,
 * compose a `MetricGroup` inside as a child — the column itself stays simple.
 */
export function SummaryColumn({ title, children, className }: SummaryColumnProps) {
  return (
    <div className={cn("flex flex-col gap-4 px-5 py-4", className)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="flex flex-col gap-3">{children}</div>
    </div>
  )
}

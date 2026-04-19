import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type SummaryCardShellProps = {
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  badge?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/**
 * Outer shell for the Project Summary card. Bonsai-style single wide card with
 * 3 vertical columns separated by hairline dividers. Responsive: columns stack
 * on small screens with horizontal dividers instead.
 *
 * Consumers pass exactly three children (the three SummaryColumns). The shell
 * is agnostic to what's inside — per-type layout is composed by the caller.
 */
export function SummaryCardShell({
  title,
  subtitle,
  trailing,
  badge,
  children,
  className,
}: SummaryCardShellProps) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-foreground">{title}</p>
            {badge}
          </div>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
      <div className="grid border-t border-border/60 md:grid-cols-3 md:divide-x md:divide-border/60 divide-y md:divide-y-0 divide-border/60">
        {children}
      </div>
    </Card>
  )
}

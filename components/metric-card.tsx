import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type MetricCardProps = {
  label: string
  value: string
  detail?: React.ReactNode
  variant?: "default" | "destructive" | "warning"
  className?: string
}

export function MetricCard({ label, value, detail, variant = "default", className }: MetricCardProps) {
  return (
    <Card size="sm" className={className}>
      <CardContent>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          variant === "destructive" && "text-destructive",
          variant === "warning" && "text-warning",
        )}>{value}</p>
        {detail && (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{detail}</p>
        )}
      </CardContent>
    </Card>
  )
}

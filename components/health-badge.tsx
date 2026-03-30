import { cn } from "@/lib/utils"

const HEALTH_CONFIG = {
  on_track: { label: "On track", dot: "#22c55e" },
  at_risk: { label: "At risk", dot: "#f59e0b" },
  over_budget: { label: "Over budget", dot: "#ef4444" },
} as const

type HealthStatus = keyof typeof HEALTH_CONFIG

export function getHealthStatus(utilization: number): HealthStatus {
  if (utilization > 100) return "over_budget"
  if (utilization >= 80) return "at_risk"
  return "on_track"
}

export function HealthBadge({
  status,
  className,
}: {
  status: HealthStatus
  className?: string
}) {
  const config = HEALTH_CONFIG[status]
  return (
    <span
      data-slot="health-badge"
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full border border-border/50 py-0.5 pl-1.5 pr-2.5 text-xs font-normal text-muted-foreground",
        className,
      )}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: config.dot }}
      />
      {config.label}
    </span>
  )
}

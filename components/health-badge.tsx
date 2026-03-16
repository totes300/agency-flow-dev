import { cn } from "@/lib/utils"

const HEALTH_CONFIG = {
  on_track: { label: "On track", dotColor: "bg-green-500", textColor: "text-green-700 dark:text-green-400" },
  at_risk: { label: "At risk", dotColor: "bg-amber-500", textColor: "text-amber-700 dark:text-amber-400" },
  over_budget: { label: "Over budget", dotColor: "bg-red-500", textColor: "text-red-700 dark:text-red-400" },
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
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", config.textColor, className)}>
      <span className={cn("size-1.5 rounded-full", config.dotColor)} />
      {config.label}
    </span>
  )
}

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const BALANCE_CONFIG = {
  due: { label: "due", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800" },
  deficit: { label: "deficit", className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800" },
  rollover: { label: "rollover", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800" },
  unused: { label: "unused", className: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-800" },
  on_track: { label: "on track", className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800" },
} as const

export type BalanceStatus = keyof typeof BALANCE_CONFIG

export function RetainerBalanceBadge({
  status,
  className,
}: {
  status: BalanceStatus
  className?: string
}) {
  const config = BALANCE_CONFIG[status]
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", config.className, className)}
    >
      {config.label}
    </Badge>
  )
}

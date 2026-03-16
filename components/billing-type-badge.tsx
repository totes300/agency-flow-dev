import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const BILLING_TYPE_CONFIG = {
  fixed: { label: "Fixed", className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-800" },
  t_and_m: { label: "T&M", className: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-400 dark:border-green-800" },
  retainer: { label: "Retainer", className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-800" },
} as const

export type BillingType = keyof typeof BILLING_TYPE_CONFIG

export function BillingTypeBadge({
  type,
  className,
}: {
  type: BillingType
  className?: string
}) {
  const config = BILLING_TYPE_CONFIG[type]
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium", config.className, className)}
    >
      {config.label}
    </Badge>
  )
}

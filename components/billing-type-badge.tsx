import { cn } from "@/lib/utils"

const BILLING_TYPE_CONFIG = {
  fixed: { label: "Fixed" },
  t_and_m: { label: "T&M" },
  retainer: { label: "Retainer" },
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
    <span
      data-slot="billing-type-badge"
      className={cn(
        "inline-flex w-fit items-center rounded-full border border-border/50 px-2 py-0.5 text-xs font-normal text-muted-foreground",
        className,
      )}
    >
      {config.label}
    </span>
  )
}

import { cn } from "@/lib/utils"

export function BillingStatusBadge({
  isBillable,
  invoiceId,
  className,
}: {
  isBillable: boolean
  invoiceId?: string | null
  className?: string
}) {
  if (!isBillable || invoiceId) return null

  return (
    <span
      data-slot="billing-status-badge"
      className={cn(
        "inline-flex w-fit items-center rounded-full border border-border/50 px-2 py-0.5 text-xs font-normal text-muted-foreground",
        className,
      )}
    >
      Unbilled
    </span>
  )
}

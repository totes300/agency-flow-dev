import { cn } from "@/lib/utils"

type StatusTagVariant = "billable" | "non-billable" | "invoiced" | "overtime"

const variantStyles: Record<StatusTagVariant, string> = {
  billable: "text-xs text-muted-foreground",
  "non-billable": "bg-muted rounded px-2 py-0.5 text-xs font-medium text-muted-foreground",
  invoiced: "bg-green-50 border border-green-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400",
  overtime: "bg-red-50 border border-red-200 rounded px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-400",
}

const variantLabels: Record<StatusTagVariant, string> = {
  billable: "Billable",
  "non-billable": "Non-billable",
  invoiced: "Invoiced",
  overtime: "Overtime",
}

/**
 * Inline status tag for time entries.
 * Billable = plain quiet text. Non-billable = muted pill. Invoiced/Overtime = colored pill.
 */
export function StatusTag({
  variant,
  className,
}: {
  variant: StatusTagVariant
  className?: string
}) {
  return (
    <span className={cn(variantStyles[variant], className)}>
      {variantLabels[variant]}
    </span>
  )
}

import { cn } from "@/lib/utils"

type StatusTagVariant = "billable" | "non-billable" | "mixed" | "invoiced" | "overtime"

const BADGE_BASE = "inline-flex h-5 items-center justify-center rounded-4xl border px-2 text-[10px] font-medium"

const variantStyles: Record<StatusTagVariant, string> = {
  billable: `${BADGE_BASE} min-w-16 border-border text-muted-foreground`,
  "non-billable": `${BADGE_BASE} border-border text-muted-foreground`,
  mixed: `${BADGE_BASE} min-w-16 border-destructive/20 bg-destructive/10 text-destructive/70 dark:bg-destructive/15 dark:text-destructive/60`,
  invoiced: `${BADGE_BASE} border-success/30 text-success`,
  overtime: `${BADGE_BASE} border-destructive/20 bg-destructive/10 text-destructive/70 dark:bg-destructive/15 dark:text-destructive/60`,
}

const variantLabels: Record<StatusTagVariant, string> = {
  billable: "Billable",
  "non-billable": "Non-billable",
  mixed: "Mixed",
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

import type { LucideIcon } from "lucide-react"

/**
 * Generic content-empty banner used across project sub-tabs (Time, Invoices).
 * Icon + title + optional description + optional action row.
 */
export function EmptyStateBanner({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border bg-muted/30 p-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
        <Icon className="size-5 text-muted-foreground/60" />
      </div>
      <div className="max-w-md">
        <p className="text-sm font-medium">{title}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  )
}

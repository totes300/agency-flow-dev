import { Trash2Icon } from "lucide-react"
import { formatCurrencyPrecise } from "@/lib/format"

export function RateBadge({
  amount,
  currency,
  suffix = "/h",
  onRemove,
}: {
  amount: number
  currency: string
  suffix?: string
  onRemove?: () => void
}) {
  return (
    <span className="group/badge inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
      <span className="font-medium tabular-nums">
        {formatCurrencyPrecise(amount, currency)}
      </span>
      <span className="text-muted-foreground">{suffix}</span>
      <span className="text-muted-foreground/60">{currency}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          className="ml-0.5 text-transparent transition-colors group-hover/badge:text-muted-foreground/40 hover:!text-destructive"
          aria-label={`Remove ${currency} rate`}
        >
          <Trash2Icon className="size-3" />
        </button>
      )}
    </span>
  )
}

export function NoRatesPlaceholder() {
  return <span className="text-xs text-muted-foreground">No rates set</span>
}

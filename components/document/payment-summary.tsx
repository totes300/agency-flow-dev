"use client"

import type { ReactNode } from "react"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"

type PaymentTone = "due" | "success" | "neutral"

const TONE_CLASS: Record<PaymentTone, string> = {
  due: "border-amber-200 bg-amber-50/70 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100",
  success: "border-emerald-200 bg-emerald-50/70 text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/25 dark:text-emerald-100",
  neutral: "border-border bg-muted/40 text-muted-foreground",
}

/**
 * Shared "Payment" box rendered at the top of both invoice and monthly
 * report documents. The body (`children`) carries the document-specific
 * copy — this component owns layout, tone color, and amount formatting.
 */
export function DocumentPaymentSummary({
  amount,
  currency,
  status,
  tone,
  children,
}: {
  amount: number
  currency: string
  status: string
  tone: PaymentTone
  children: ReactNode
}) {
  return (
    <aside
      className={cn("rounded-lg border px-5 py-4", TONE_CLASS[tone])}
      aria-label="Payment summary"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Payment
        </p>
        <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground">
          {status}
        </span>
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">
        {formatCurrency(amount, currency)}
      </p>
      <p className="mt-2 text-sm text-foreground">{children}</p>
    </aside>
  )
}

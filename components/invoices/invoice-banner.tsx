"use client"

import { Button } from "@/components/ui/button"
import { useBillingActions } from "@/lib/hooks/use-billing-actions"
import type { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"
import {
  deriveInvoiceBannerView,
  type InvoiceBannerState,
} from "@/lib/invoice-banner-view"
import { HourglassIcon, ReceiptIcon, RepeatIcon, TimerIcon, type LucideIcon } from "lucide-react"

export type { InvoiceBannerState } from "@/lib/invoice-banner-view"

/**
 * Single shared "ready to bill" banner across all 3 project Overviews.
 *
 * Renders a compact 4-column layout:
 *   [icon] [title + subline (+ optional cadence chip)] [amount column] [Generate]
 *
 * Visibility per project type is the caller's responsibility: pass `null` to
 * render nothing (mid-cycle rollover retainer, fully invoiced Fixed, no
 * uninvoiced T&M hours, etc.).
 *
 * The CTA opens the Close workspace for retainer / T&M (the only place a
 * close is committed, docs/prd-billing-refactor.md D8) and bills a fixed fee
 * via `createFixedInvoice`.
 */
const ICON_BY_KIND: Record<InvoiceBannerState["kind"], LucideIcon> = {
  fixed: ReceiptIcon,
  tm: TimerIcon,
  // Both retainer kinds share the same visual identity (RepeatIcon +
  // emerald tint). The user pattern-matches the surface to "retainer
  // billing" regardless of whether it's monthly or cycle-based.
  "retainer-monthly": RepeatIcon,
  "retainer-cycle": RepeatIcon,
}

// Subtle category-token tints per billing type so users pattern-match the
// surface without reading the title.
const TINT_BY_KIND: Record<InvoiceBannerState["kind"], string> = {
  fixed: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  tm: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  "retainer-monthly":
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  "retainer-cycle":
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
}

const CADENCE_THRESHOLD_DAYS = 30

export function InvoiceBanner({
  state,
  projectId,
  currency,
  timezone,
}: {
  state: InvoiceBannerState | null
  projectId: Id<"projects">
  currency: string
  timezone: string
}) {
  const { reviewClose, billFixedFee, pending } = useBillingActions()

  if (!state) return null

  const Icon = ICON_BY_KIND[state.kind]
  const view = deriveInvoiceBannerView(state, currency, timezone)
  const showCadenceChip =
    (state.kind === "fixed" || state.kind === "tm") &&
    state.daysSinceLastInvoice !== null &&
    state.daysSinceLastInvoice >= CADENCE_THRESHOLD_DAYS

  // Retainer and T&M periods are reviewed and committed in the Close
  // workspace (D8); a fixed fee bills straight to a draft (D5). Retainer
  // targets are the period's last month — the workspace snaps it to the grid.
  function handleGenerate() {
    if (!state) return
    if (state.kind === "fixed") {
      void billFixedFee(projectId)
    } else if (state.kind === "tm") {
      reviewClose(projectId)
    } else {
      reviewClose(projectId, { year: state.targetYear, month: state.targetMonth })
    }
  }

  return (
    <div className="grid grid-cols-[36px_1fr_auto_auto] items-center gap-4 rounded-lg border bg-card px-4 py-3">
      <span className={cn("grid size-9 place-items-center rounded-lg", TINT_BY_KIND[state.kind])}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{view.title}</span>
          {showCadenceChip && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums"
              aria-label={`${state.daysSinceLastInvoice} days since last invoice`}
            >
              <HourglassIcon className="size-3" aria-hidden />
              {state.daysSinceLastInvoice} days
            </span>
          )}
        </div>
        {view.subline && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{view.subline}</p>
        )}
      </div>
      <div className="text-right">
        <div
          className={cn(
            "text-sm font-semibold tabular-nums",
            view.amountTone === "warn" && "text-amber-700 dark:text-amber-500",
            view.amountTone === "neutral" && "text-foreground",
          )}
        >
          {view.amount}
        </div>
        <div
          className={cn(
            "text-xs",
            view.labelTone === "ok"
              ? "text-emerald-700 dark:text-emerald-500"
              : "text-muted-foreground",
          )}
        >
          {view.amountLabel}
        </div>
      </div>
      <Button size="sm" disabled={pending} onClick={handleGenerate}>
        {state.kind === "fixed" ? "Generate invoice" : "Review to invoice"}
      </Button>
    </div>
  )
}

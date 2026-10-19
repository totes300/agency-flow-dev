"use client"

import type { ReactNode } from "react"
import { BillingTabStrip } from "@/components/billing/billing-tab-strip"

/**
 * Billing hub toolbar shell — one full-width row with a single continuous
 * bottom hairline: the shared tab strip on the left, tab-specific controls
 * (filter + search) clustered on the right. Active-filter pills render on a
 * second row only when present, so the bar collapses cleanly on an empty view.
 *
 * The Close tab and the invoice tabs pass different `rightControls` /
 * `activeFilters` but share the exact same tab strip, so the tabs read as one
 * navigation regardless of which surface is below (PRD slice 08).
 */
export function BillingToolbar({
  closeCount = 0,
  draftCount = 0,
  outstandingCount = 0,
  hasOverdue = false,
  rightControls,
  activeFilters,
}: {
  closeCount?: number
  draftCount?: number
  outstandingCount?: number
  hasOverdue?: boolean
  rightControls: ReactNode
  activeFilters?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <BillingTabStrip
          closeCount={closeCount}
          draftCount={draftCount}
          outstandingCount={outstandingCount}
          hasOverdue={hasOverdue}
        />
        <div className="flex items-center gap-2 pb-2">{rightControls}</div>
      </div>
      {activeFilters}
    </div>
  )
}

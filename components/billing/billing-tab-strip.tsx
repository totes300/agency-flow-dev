"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DEFAULT_STATUS_TAB,
  INVOICE_STATUS_TABS,
  parseStatusTab,
  type InvoiceStatusTab,
} from "@/lib/invoices/status-tab"

/**
 * The Billing hub tab strip (Close · Draft · Outstanding · Paid · Void),
 * shared by the Close-queue toolbar and the invoice-list toolbar so both tabs
 * live on one continuous hairline (PRD slice 08). URL-driven via `?status=`.
 *
 * Count chips render on the three "working" tabs (Close, Draft, Outstanding)
 * only when > 0. Paid/Void are archival — countless by design. `hasOverdue`
 * paints the presence-only red dot on Outstanding (no count, so steady-state
 * overdue doesn't normalize into noise).
 */
export function BillingTabStrip({
  closeCount = 0,
  draftCount = 0,
  outstandingCount = 0,
  hasOverdue = false,
}: {
  closeCount?: number
  draftCount?: number
  outstandingCount?: number
  hasOverdue?: boolean
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeStatus = parseStatusTab(searchParams.get("status"))

  function setStatus(value: InvoiceStatusTab) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === DEFAULT_STATUS_TAB) params.delete("status")
    else params.set("status", value)
    // Tab change resets query refinements that don't cross lifecycle stages.
    params.delete("search")
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <Tabs value={activeStatus} onValueChange={(v) => setStatus(v as InvoiceStatusTab)}>
      <TabsList variant="line" className="border-b-0">
        {INVOICE_STATUS_TABS.map((tab) => {
          const count = countForTab(tab.key, {
            closeCount,
            draftCount,
            outstandingCount,
          })
          return (
            <TabsTrigger key={tab.key} value={tab.key}>
              {tab.label}
              {count !== null && count > 0 && <CountChip count={count} />}
              {tab.key === "outstanding" && hasOverdue && (
                <span
                  className="ml-1.5 inline-block size-1.5 rounded-full bg-red-500"
                  aria-label="Has overdue invoices"
                />
              )}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}

function countForTab(
  key: InvoiceStatusTab,
  counts: { closeCount: number; draftCount: number; outstandingCount: number },
): number | null {
  switch (key) {
    case "close":
      return counts.closeCount
    case "draft":
      return counts.draftCount
    case "outstanding":
      return counts.outstandingCount
    case "paid":
    case "void":
      return null
  }
}

function CountChip({ count }: { count: number }) {
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums leading-none text-muted-foreground">
      {count}
    </span>
  )
}

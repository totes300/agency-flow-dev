"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  InvoicesFilterBar,
  InvoicesActiveFilters,
} from "@/components/invoices/invoices-filter-bar"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import type { Filter } from "@/components/ui/filters"
import {
  DEFAULT_STATUS_TAB,
  INVOICE_STATUS_TABS,
  parseStatusTab,
  type InvoiceStatusTab,
} from "@/lib/invoices/status-tab"

/**
 * Toolbar layout — single full-width row with one continuous bottom hairline:
 *
 *   [Tabs ─────────────────]                       [Filter] [Search]
 *   ──────────────────────────────────────────────────────────────────
 *
 * Tabs (navigation) sit on the left. Filter + search (query refinement)
 * cluster on the right — same axis, opposite categories. The hairline runs
 * end-to-end so the table below feels anchored to a designed bar instead
 * of floating beneath a tab strip that ends mid-page.
 *
 * Active filter pills render on a second row only when filters exist, so
 * the bar collapses cleanly on an empty view.
 *
 * Tab count chips are rendered on the three "working" tabs only —
 * Ready, Draft, Outstanding — and only when their count is > 0. Paid
 * and Void are archival buckets where a count grows monotonically and
 * adds noise without informing action, so they stay countless. Counts
 * are unfiltered bucket totals; the per-tab summary strip below the
 * tabs answers the "what's in my filtered view right now" question.
 *
 * `hasOverdue` paints a small red dot next to the Outstanding tab when at
 * least one invoice is past its due date. We intentionally don't show the
 * count: in steady state there's almost always something overdue, so a
 * count would normalize into noise. The dot is presence-only — "go look
 * here when you have time" — and the actual breakdown lives in the
 * Outstanding tab's summary strip.
 */
export function InvoicesFilters({
  filters,
  setFilters,
  readyCount = 0,
  draftCount = 0,
  outstandingCount = 0,
  hasOverdue = false,
}: {
  filters: Filter[]
  setFilters: (updater: Filter[] | ((prev: Filter[]) => Filter[])) => void
  readyCount?: number
  draftCount?: number
  outstandingCount?: number
  hasOverdue?: boolean
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeStatus = parseStatusTab(searchParams.get("status"))
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  function setStatus(value: InvoiceStatusTab) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === DEFAULT_STATUS_TAB) {
      params.delete("status")
    } else {
      params.set("status", value)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Single toolbar row, full-width hairline. `items-end` aligns the tab
          underline with the filter/search baseline so the line reads as one
          continuous edge. The TabsList's own border is suppressed since the
          parent provides the hairline (active trigger's -mb-px slides its
          accent border onto the same y-axis). */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b">
        <Tabs
          value={activeStatus}
          onValueChange={(v) => setStatus(v as InvoiceStatusTab)}
        >
          <TabsList variant="line" className="border-b-0">
            {INVOICE_STATUS_TABS.map((tab) => {
              const count = countForTab(tab.key, {
                readyCount,
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

        <div className="flex items-center gap-2 pb-2">
          <InvoicesFilterBar filters={filters} setFilters={setFilters} />
          <div className="relative w-64">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search invoice number or subject"
              aria-label="Search invoices"
              className="h-8 pl-8"
            />
          </div>
        </div>
      </div>

      <InvoicesActiveFilters filters={filters} setFilters={setFilters} />
    </div>
  )
}

// Returns the count to display on a tab, or `null` for tabs that
// intentionally never show a count (Paid and Void — archival buckets).
function countForTab(
  key: InvoiceStatusTab,
  counts: { readyCount: number; draftCount: number; outstandingCount: number },
): number | null {
  switch (key) {
    case "ready":
      return counts.readyCount
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

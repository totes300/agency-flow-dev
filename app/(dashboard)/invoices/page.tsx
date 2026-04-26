"use client"

import { useCallback, useRef, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { InvoicesPageSkeleton } from "@/components/invoices/invoices-page-skeleton"
import { InvoicesMetricCards } from "@/components/invoices/invoices-metric-cards"
import { InvoicesFilters } from "@/components/invoices/invoices-filters"
import { ReadyToInvoiceCard } from "@/components/invoices/ready-to-invoice-card"
import { InvoiceList, type InvoiceRow } from "@/components/invoices/invoice-list"
import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state"
import type { Filter } from "@/components/ui/filters"
import {
  useInvoicesQueryArgs,
  type InvoicesStatus,
} from "@/lib/hooks/use-invoices-query-args"

function parseStatus(value: string | null): InvoicesStatus | undefined {
  if (
    value === "draft" ||
    value === "invoiced" ||
    value === "paid" ||
    value === "void"
  ) {
    return value
  }
  return undefined
}

/**
 * State ownership:
 *   - Status tab      → URL (`?status=`) — navigation-like, back-button-worthy
 *   - Search          → URL (`?search=`) — shareable, debounced replace
 *   - Client/project/date filters → in-memory React state (ephemeral popover
 *     interactions; URL encoding added noise without real shareability)
 *
 * Loading transitions:
 *   Convex `useQuery` returns `undefined` whenever its args change. A naive
 *   "if any query is undefined → full-page skeleton" guard would flash the
 *   layout on every filter/tab/search click. Instead we stale-while-revalidate:
 *   stash the last known values in refs and render those until the new result
 *   lands. The full-page skeleton only appears on first load.
 */
export default function InvoicesPage() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const status = parseStatus(searchParams.get("status"))
  const search = searchParams.get("search") || undefined
  const [filters, setFilters] = useState<Filter[]>([])
  const queryArgs = useInvoicesQueryArgs({ filters, status, search })

  const hasFilters = filters.length > 0 || Boolean(status || search)
  const clearFilters = useCallback(() => {
    setFilters([])
    router.replace(pathname)
  }, [pathname, router])

  const liveInvoices = useQuery(
    api.invoices.listAllInvoices,
    isAuthenticated ? queryArgs : "skip",
  )
  const liveMetrics = useQuery(api.invoices.getInvoiceMetrics, isAuthenticated ? {} : "skip")
  const liveReady = useQuery(api.invoices.getReadyToInvoice, isAuthenticated ? {} : "skip")
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")

  // Stale-while-revalidate refs — see class-level comment above.
  const lastInvoices = useRef<typeof liveInvoices>(undefined)
  const lastMetrics = useRef<typeof liveMetrics>(undefined)
  const lastReady = useRef<typeof liveReady>(undefined)
  if (liveInvoices !== undefined) lastInvoices.current = liveInvoices
  if (liveMetrics !== undefined) lastMetrics.current = liveMetrics
  if (liveReady !== undefined) lastReady.current = liveReady

  const invoices = liveInvoices ?? lastInvoices.current
  const metrics = liveMetrics ?? lastMetrics.current
  const ready = liveReady ?? lastReady.current

  const header = (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
      <p className="text-sm text-muted-foreground">
        Manage invoices across all projects.
      </p>
    </div>
  )

  // Phase 1: first load — no cached data to show yet.
  if (invoices === undefined || metrics === undefined || ready === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        {header}
        <InvoicesPageSkeleton />
      </div>
    )
  }

  // Phase 2: truly empty — no invoices, no ready months, no filters applied.
  const isTrulyEmpty = invoices.length === 0 && ready.length === 0 && !hasFilters
  if (isTrulyEmpty) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        {header}
        <InvoicesEmptyState reason="global-no-invoices" />
      </div>
    )
  }

  // Phase 3: content. When filters are set and the result set is empty, the
  // table-level "no matches" fallback is rendered inside `<InvoiceList>` so
  // the metric cards + filter bar stay visible (users can clear the filter).
  const timezone = orgSettings?.timezone ?? "UTC"

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      {header}
      <ReadyToInvoiceCard rows={ready} />
      <InvoicesMetricCards metrics={metrics} />
      <InvoicesFilters filters={filters} setFilters={setFilters} />
      <InvoiceList
        invoices={invoices as InvoiceRow[]}
        showProject={true}
        timezone={timezone}
        emptyState={
          hasFilters ? (
            <InvoicesEmptyState
              reason="no-matches"
              onClearFilters={clearFilters}
              className="flex items-center justify-center py-16"
            />
          ) : null
        }
      />
    </div>
  )
}

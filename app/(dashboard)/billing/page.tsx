"use client"

import { useCallback, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { SearchIcon } from "lucide-react"
import { useQuery, useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Input } from "@/components/ui/input"
import { InvoicesPageSkeleton } from "@/components/invoices/invoices-page-skeleton"
import { CloseQueueSkeleton } from "@/components/billing/close-queue-skeleton"
import { CloseQueueView } from "@/components/billing/close-queue"
import { BillingToolbar } from "@/components/billing/billing-toolbar"
import { BillingSummary } from "@/components/billing/billing-summary"
import {
  InvoicesFilterBar,
  InvoicesActiveFilters,
} from "@/components/invoices/invoices-filter-bar"
import { InvoiceList } from "@/components/invoices/invoice-list"
import {
  InvoicesEmptyState,
  type InvoicesEmptyReason,
} from "@/components/invoices/invoices-empty-state"
import { TabSummaryStrip } from "@/components/invoices/tab-summary-strip"
import { toInvoiceListRow, type ListRow } from "@/lib/invoices/list-rows"
import type { Filter } from "@/components/ui/filters"
import { useInvoicesQueryArgs } from "@/lib/hooks/use-invoices-query-args"
import { useLastDefined } from "@/lib/hooks/use-last-defined"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { ORG_TIMEZONE_FALLBACK } from "@/lib/hooks/use-org-timezone"
import {
  parseStatusTab,
  STATUS_TAB_TO_QUERY,
  tabIsClose,
} from "@/lib/invoices/status-tab"

/**
 * /billing — the Billing hub (renamed from /invoices, PRD slice 08). Tabs:
 * Close · Draft · Outstanding · Paid · Void.
 *
 *   - Close: the month-close queue (`CloseQueueView`) — every closable period,
 *     month-grouped, the front door of the month-end ritual. Replaces the old
 *     one-click "Ready" tab; the only path to a draft is now the Close
 *     workspace.
 *   - Draft / Outstanding / Paid / Void: the invoice ledger, unchanged.
 *
 * Invoice document URLs stay at `/invoices/[id]`; only the hub moved.
 */
export default function BillingPage() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const statusTab = parseStatusTab(searchParams.get("status"))

  // Counts feed the shared tab strip in every branch.
  const liveNavSignals = useQuery(
    api.billingViews.getNavSignals,
    isAuthenticated ? {} : "skip",
  )
  const liveMetrics = useQuery(
    api.invoices.getInvoiceMetrics,
    isAuthenticated ? {} : "skip",
  )
  const navSignals = useLastDefined(liveNavSignals)
  const metrics = useLastDefined(liveMetrics)

  const closeCount =
    (navSignals?.toGenerateCount ?? 0) + (navSignals?.toCloseCount ?? 0)
  const draftCount = metrics?.draft.count ?? 0
  const outstandingCount =
    (metrics?.unpaid.count ?? 0) + (metrics?.pastDue.count ?? 0)
  const hasOverdue = (navSignals?.overdueCount ?? 0) > 0

  const header = <h1 className="text-xl font-semibold tracking-tight">Billing</h1>

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      {header}
      <BillingSummary
        readyAmountByCurrency={navSignals?.readyAmountByCurrency ?? {}}
        readyCount={navSignals?.toGenerateCount ?? 0}
        closeCount={navSignals?.toCloseCount ?? 0}
        outstandingByCurrency={metrics?.outstanding?.currencySums ?? {}}
        outstandingCount={outstandingCount}
        overdueCount={metrics?.pastDue.count ?? 0}
      />
      {tabIsClose(statusTab) ? (
        <CloseTab
          draftCount={draftCount}
          outstandingCount={outstandingCount}
          hasOverdue={hasOverdue}
        />
      ) : (
        <InvoiceTab
          closeCount={closeCount}
          draftCount={draftCount}
          outstandingCount={outstandingCount}
          hasOverdue={hasOverdue}
        />
      )}
    </div>
  )
}

// ─── Close tab ──────────────────────────────────────────────────────────────

function CloseTab({
  draftCount,
  outstandingCount,
  hasOverdue,
}: {
  draftCount: number
  outstandingCount: number
  hasOverdue: boolean
}) {
  const { isAuthenticated } = useConvexAuth()
  const liveQueue = useQuery(
    api.billingViews.getCloseQueue,
    isAuthenticated ? {} : "skip",
  )
  const queue = useLastDefined(liveQueue)

  if (queue === undefined) return <CloseQueueSkeleton />

  return (
    <CloseQueueView
      data={queue}
      draftCount={draftCount}
      outstandingCount={outstandingCount}
      hasOverdue={hasOverdue}
    />
  )
}

// ─── Invoice tabs (Draft / Outstanding / Paid / Void) ────────────────────────

function InvoiceTab({
  closeCount,
  draftCount,
  outstandingCount,
  hasOverdue,
}: {
  closeCount: number
  draftCount: number
  outstandingCount: number
  hasOverdue: boolean
}) {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const statusTab = parseStatusTab(searchParams.get("status"))
  const search = searchParams.get("search") || undefined
  const [filters, setFilters] = useState<Filter[]>([])
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")

  const queryArgs = useInvoicesQueryArgs({
    filters,
    status: STATUS_TAB_TO_QUERY[statusTab],
    search,
  })

  const hasFilters = filters.length > 0 || Boolean(search)
  const clearFilters = useCallback(() => {
    setFilters([])
    router.replace(pathname)
  }, [pathname, router])

  const liveInvoices = useQuery(
    api.invoices.listAllInvoices,
    isAuthenticated ? queryArgs : "skip",
  )
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")

  const invoices = useLastDefined(liveInvoices)
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK

  const toolbar = (
    <BillingToolbar
      closeCount={closeCount}
      draftCount={draftCount}
      outstandingCount={outstandingCount}
      hasOverdue={hasOverdue}
      rightControls={
        <>
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
        </>
      }
      activeFilters={
        <InvoicesActiveFilters filters={filters} setFilters={setFilters} />
      }
    />
  )

  if (invoices === undefined) {
    return (
      <>
        {toolbar}
        <InvoicesPageSkeleton />
      </>
    )
  }

  const listRows: ListRow[] = invoices.map(toInvoiceListRow)

  return (
    <>
      {toolbar}
      <InvoiceList
        rows={listRows}
        showProject
        showType={statusTab !== "paid"}
        showStatus={statusTab === "outstanding"}
        showDate
        timezone={timezone}
        dateColumn={statusTab === "paid" ? "paid" : "due"}
        emptyState={
          hasFilters ? (
            <InvoicesEmptyState reason="no-matches" onClearFilters={clearFilters} />
          ) : (
            // InvoiceTab only renders for non-close tabs, so this is always a
            // valid `tab-draft|outstanding|paid|void` reason.
            <InvoicesEmptyState reason={`tab-${statusTab}` as InvoicesEmptyReason} />
          )
        }
      />
      {/* Totals sit under the table, Stripe-style, like the Close queue's count. */}
      <div className="-mt-3 px-3">
        <TabSummaryStrip rows={listRows} tab={statusTab} timezone={timezone} />
      </div>
    </>
  )
}

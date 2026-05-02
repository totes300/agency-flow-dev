"use client"

import { useCallback, useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery, useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import { InvoicesPageSkeleton } from "@/components/invoices/invoices-page-skeleton"
import { InboxEmptyState } from "@/components/invoices/inbox-empty-state"
import { InvoicesFilters } from "@/components/invoices/invoices-filters"
import { InvoiceList } from "@/components/invoices/invoice-list"
import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state"
import { TabSummaryStrip } from "@/components/invoices/tab-summary-strip"
import {
  toReadyListRow,
  toInvoiceListRow,
  type ListRow,
} from "@/lib/invoices/list-rows"
import { filterReadyRows } from "@/lib/invoices/filter-ready-rows"
import type { Filter } from "@/components/ui/filters"
import { useInvoicesQueryArgs } from "@/lib/hooks/use-invoices-query-args"
import { useLastDefined } from "@/lib/hooks/use-last-defined"
import { ORG_TIMEZONE_FALLBACK } from "@/lib/hooks/use-org-timezone"
import {
  parseStatusTab,
  STATUS_TAB_TO_QUERY,
  tabIncludesInvoices,
  tabIncludesReady,
} from "@/lib/invoices/status-tab"

/**
 * /invoices page — composes:
 *   - "Inbox zero" empty state on Ready tab when there's nothing to bill
 *   - Toolbar with status tab nav (URL-driven `?status=`), filter, and search
 *   - InvoiceList — single-stage per tab (no mixed lifecycle)
 *
 * Tabs are mono-stage: each tab shows exactly one lifecycle stage. There's
 * no "All" tab — mixing ready (action-mode) with issued invoices
 * (ledger-mode) has no shared use case for an agency owner. Overdue
 * urgency surfaces as a red dot on the Outstanding tab and as the
 * "of which overdue" subline inside that tab's summary strip — nowhere
 * else, because in steady state there is always at least one overdue
 * invoice and a global banner would normalize the noise.
 *
 * URL state convention (CLAUDE.md): status + search live in URL params; the
 * advanced filter pills live in component state because they're popover
 * interactions without real share-link value.
 *
 * Three-phase loading: first paint shows a content-aware skeleton; once any
 * query has resolved, stale-while-revalidate refs hold prior values across
 * filter/tab clicks so the layout doesn't flash.
 */
export default function InvoicesPage() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const statusTab = parseStatusTab(searchParams.get("status"))
  const search = searchParams.get("search") || undefined
  const [filters, setFilters] = useState<Filter[]>([])
  const queryArgs = useInvoicesQueryArgs({
    filters,
    status: STATUS_TAB_TO_QUERY[statusTab],
    search,
  })

  // `hasFilters` controls the "no matches — clear" empty state. Tab is
  // navigation (not a filter), so it's intentionally excluded — switching
  // tabs is a deliberate stage change, not a query refinement.
  const hasFilters = filters.length > 0 || Boolean(search)
  const clearFilters = useCallback(() => {
    setFilters([])
    router.replace(pathname)
  }, [pathname, router])

  // ─── Live queries ─────────────────────────────────────────────────────────────
  // Skip the invoice query when the tab excludes invoices (i.e. `ready`),
  // and skip ready when the tab is a specific invoice status — saves a
  // subscription on tabs where the data isn't shown.
  const wantsInvoices = tabIncludesInvoices(statusTab)
  const wantsReady = tabIncludesReady(statusTab)

  const liveInvoices = useQuery(
    api.invoices.listAllInvoices,
    isAuthenticated && wantsInvoices ? queryArgs : "skip",
  )
  // Tiny purpose-built signal for the red dot on the Outstanding tab. The
  // sidebar already subscribes to this query, so co-subscribing here is
  // free (Convex deduplicates identical subscriptions).
  const liveNavSignals = useQuery(
    api.invoices.getInvoicingNavSignals,
    isAuthenticated ? {} : "skip",
  )
  // Per-status bucket counts feed the tab badges (Draft, Outstanding).
  // Ready uses its own `ready.length` from `getReadyToInvoiceUnified`.
  // Paid + Void are intentionally not shown — counts in archival buckets
  // grow monotonically and add noise without informing action.
  const liveMetrics = useQuery(
    api.invoices.getInvoiceMetrics,
    isAuthenticated ? {} : "skip",
  )
  const liveReady = useQuery(
    api.invoices.getReadyToInvoiceUnified,
    isAuthenticated ? {} : "skip",
  )
  // Only subscribe to the empty-state context when the ready feed is empty —
  // the rare case in active use. Saves a per-render fetch on the busy
  // admin's screen. Flicker risk acceptable: ready resolves first.
  const needsEmptyContext = liveReady !== undefined && liveReady.length === 0
  const liveEmptyContext = useQuery(
    api.invoices.getInboxEmptyStateContext,
    isAuthenticated && needsEmptyContext ? {} : "skip",
  )
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")

  // Stale-while-revalidate — keeps the last known values visible while a
  // re-subscription resolves new args (filter / tab clicks). Without it the
  // user sees a full-page skeleton on every tab toggle.
  const invoices = useLastDefined(liveInvoices)
  const navSignals = useLastDefined(liveNavSignals)
  const metrics = useLastDefined(liveMetrics)
  const ready = useLastDefined(liveReady)
  const emptyContext = useLastDefined(liveEmptyContext)
  const timezone = orgSettings?.timezone ?? ORG_TIMEZONE_FALLBACK
  const hasOverdue = (navSignals?.overdueCount ?? 0) > 0
  // Tab badges show *unfiltered* bucket sizes — the badge answers "how
  // much exists in this bucket overall," while the per-tab summary strip
  // answers "what's in front of me right now after filters." Two distinct
  // purposes, so they're allowed to disagree when filters are active.
  const draftCount = metrics?.draft.count ?? 0
  const outstandingCount =
    (metrics?.unpaid.count ?? 0) + (metrics?.pastDue.count ?? 0)

  // ─── Header ───────────────────────────────────────────────────────────────────
  // Title only — no helper subtitle. The breadcrumb + tabs already say what
  // this page is, and SaaS conventions (Linear, Notion, Stripe, Plane) all
  // converged on a clean title row here.
  const header = (
    <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
  )

  // Phase 1: first load — block on whatever queries this tab actually needs.
  // `emptyContext` only blocks when ready is empty, since it's only fetched
  // in that branch. Re-derive gates from materialized values (not `live*`)
  // because `useLastDefined` may be holding prior values during re-sub.
  const blockedOnInvoices = wantsInvoices && invoices === undefined
  const blockedOnReady = ready === undefined
  const blockedOnEmptyContext =
    ready !== undefined && ready.length === 0 && emptyContext === undefined
  // navSignals isn't a blocker — the dot just doesn't paint until it
  // resolves, which is fine: the user perceives no missing surface.
  if (blockedOnInvoices || blockedOnReady || blockedOnEmptyContext) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        {header}
        <InvoicesPageSkeleton />
      </div>
    )
  }

  // Inbox-zero reward state — shown on the Ready tab when there's nothing
  // to bill. Overdue urgency is signaled separately by the red dot on the
  // Outstanding tab, so showing this state doesn't suppress an action.
  const showInboxAllCaughtUp = statusTab === "ready" && ready.length === 0

  // ─── Build list rows ──────────────────────────────────────────────────────
  // Each tab is mono-stage: ready rows OR invoice rows, never both.
  // Ready rows are filtered client-side: the Convex `listAllInvoices` args
  // shape doesn't apply (no issueDate/dueDate on a pre-issuance projection),
  // so we apply client/project pills + search here instead. Date pills are
  // intentionally ignored on Ready — see `filterReadyRows`.
  const listRows: ListRow[] = wantsReady
    ? filterReadyRows(ready, filters, search).map(toReadyListRow)
    : (invoices ?? []).map(toInvoiceListRow)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
      {header}

      <InvoicesFilters
        filters={filters}
        setFilters={setFilters}
        readyCount={ready.length}
        draftCount={draftCount}
        outstandingCount={outstandingCount}
        hasOverdue={hasOverdue}
      />

      {showInboxAllCaughtUp && emptyContext !== undefined ? (
        <InboxEmptyState context={emptyContext} timezone={timezone} />
      ) : (
        <>
          <TabSummaryStrip rows={listRows} tab={statusTab} timezone={timezone} />
          <InvoiceList
            rows={listRows}
            showProject
            // Status column only carries information on Ready (within-budget /
            // over) and Outstanding (overdue accent). On the monomorphic tabs
            // (Draft / Paid / Void) every row's status is the tab's name, so
            // the column is dead weight there.
            showStatus={statusTab === "ready" || statusTab === "outstanding"}
            timezone={timezone}
            emptyState={
              hasFilters ? (
                <InvoicesEmptyState
                  reason="no-matches"
                  onClearFilters={clearFilters}
                />
              ) : statusTab !== "ready" ? (
                // Ready's truly-empty state lives in `InboxEmptyState` above
                // (the celebratory "all caught up" reward). For the other
                // four tabs we render a quiet, descriptive empty state so
                // the table area never collapses to blank space.
                <InvoicesEmptyState reason={`tab-${statusTab}` as const} />
              ) : null
            }
          />
        </>
      )}
    </div>
  )
}

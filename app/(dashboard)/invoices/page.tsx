"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useConvexAuth } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { InvoicesPageSkeleton } from "@/components/invoices/invoices-page-skeleton"
import { InvoicesMetricCards } from "@/components/invoices/invoices-metric-cards"
import { InvoicesFilters } from "@/components/invoices/invoices-filters"
import { ReadyToInvoiceCard } from "@/components/invoices/ready-to-invoice-card"
import { InvoiceList, type InvoiceRow } from "@/components/invoices/invoice-list"
import { InvoicesEmptyState } from "@/components/invoices/invoices-empty-state"

type StatusParam = "draft" | "invoiced" | "paid"

function parseStatus(value: string | null): StatusParam | undefined {
  if (value === "draft" || value === "invoiced" || value === "paid") return value
  return undefined
}

export default function InvoicesPage() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const status = parseStatus(searchParams.get("status"))
  const clientId = (searchParams.get("clientId") || undefined) as Id<"clients"> | undefined
  const projectId = (searchParams.get("projectId") || undefined) as Id<"projects"> | undefined
  const search = searchParams.get("search") || undefined

  const hasFilters = Boolean(status || clientId || projectId || search)
  const clearFilters = () => router.replace(pathname)

  const invoices = useQuery(
    api.invoices.listAllInvoices,
    isAuthenticated ? { status, clientId, projectId, search } : "skip",
  )
  const metrics = useQuery(api.invoices.getInvoiceMetrics, isAuthenticated ? {} : "skip")
  const ready = useQuery(api.invoices.getReadyToInvoice, isAuthenticated ? {} : "skip")
  const orgSettings = useQuery(api.orgSettings.get, isAuthenticated ? {} : "skip")

  const header = (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Invoices</h1>
      <p className="text-sm text-muted-foreground">
        Manage invoices across all projects.
      </p>
    </div>
  )

  // Phase 1: loading
  if (invoices === undefined || metrics === undefined || ready === undefined) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
        {header}
        <InvoicesPageSkeleton />
      </div>
    )
  }

  // Phase 2: truly empty — no invoices, no ready months, no filters applied
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
      <InvoicesFilters />
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

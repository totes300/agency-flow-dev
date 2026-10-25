"use client"

import { useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useConvexAuth, useQuery } from "convex/react"
import { Building2Icon, CircleDotIcon, FolderKanbanIcon, LayersIcon, SlidersHorizontalIcon } from "lucide-react"
import { api } from "@/convex/_generated/api"
import type { NeedsActionData, NeedsActionRow } from "@/convex/billingViews"
import { PERIOD_STATE_COPY } from "@/convex/lib/billing/periodState"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Toggle } from "@/components/ui/toggle"
import { ActiveFacetPills, FacetFilterButton } from "@/components/billing/facet-filter"
import { NeedsActionList } from "@/components/billing/needs-action-list"
import {
  HubInvoiceTable,
  INVOICE_STATUS_FILTERS,
  displayStatusOf,
  invoiceStatusLabel,
  type HubInvoice,
  type InvoiceStatusFilter,
} from "@/components/billing/hub-invoices"
import { useLastDefined } from "@/lib/hooks/use-last-defined"
import { daysLeft } from "@/lib/billing/period-selection"
import { facetStateFromParams, filterRows, toggleFacetParam, type FacetDef } from "@/lib/billing/hub-facets"
import { formatMinor } from "@/lib/format"
import { cn } from "@/lib/utils"

const TYPE_LABEL: Record<string, string> = { retainer: "Retainer", t_and_m: "T&M", fixed: "Fixed fee", non_billable: "Non-billable" }

const ACTION_FACETS: FacetDef<NeedsActionRow>[] = [
  { key: "client", label: "Client", valueOf: (r) => r.clientId, nameOf: (id, rows) => rows.find((r) => r.clientId === id)?.clientName ?? id },
  { key: "project", label: "Project", valueOf: (r) => r.projectId, nameOf: (id, rows) => rows.find((r) => r.projectId === id)?.projectName ?? id },
  { key: "type", label: "Billing type", valueOf: (r) => r.billingType, nameOf: (id) => TYPE_LABEL[id] ?? id },
  {
    key: "state",
    label: "State",
    valueOf: (r) => r.group,
    nameOf: (id) => PERIOD_STATE_COPY[id as keyof typeof PERIOD_STATE_COPY]?.chip ?? id,
    order: ["needs_rate", "ready_to_invoice", "ready_to_close", "draft", "past_due"],
  },
]

const INVOICE_FACETS: FacetDef<HubInvoice>[] = [
  { key: "client", label: "Client", valueOf: (r) => r.clientId, nameOf: (id, rows) => rows.find((r) => r.clientId === id)?.clientName ?? id },
  { key: "project", label: "Project", valueOf: (r) => r.projectId, nameOf: (id, rows) => rows.find((r) => r.projectId === id)?.projectName ?? id },
]

const FACET_ICONS = {
  client: <Building2Icon className="size-3.5" />,
  project: <FolderKanbanIcon className="size-3.5" />,
  type: <LayersIcon className="size-3.5" />,
  state: <CircleDotIcon className="size-3.5" />,
}

/**
 * /billing — the Billing hub (docs/prd-project-billing-redesign.md §8): an
 * inbox of periods that need action plus the invoice ledger, switched by
 * underline tabs above the list (H1). Tiles are information only (P10).
 * URL: ?view=action|invoices, facet params, ?status= on Invoices.
 */
export default function BillingPage() {
  const { isAuthenticated } = useConvexAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const view = searchParams.get("view") === "invoices" ? "invoices" : "action"

  const data = useLastDefined(useQuery(api.billingViews.getNeedsAction, isAuthenticated ? {} : "skip"))
  const invoices = useLastDefined(useQuery(api.invoices.listAllInvoices, isAuthenticated ? {} : "skip")) as
    | HubInvoice[]
    | undefined

  const navigate = useCallback(
    (next: URLSearchParams, mode: "push" | "replace" = "replace") => {
      const qs = next.toString()
      const href = qs ? `${pathname}?${qs}` : pathname
      if (mode === "push") router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    },
    [pathname, router],
  )
  const setView = (next: "action" | "invoices") => {
    // Each view keeps only its own filters.
    const params = new URLSearchParams()
    if (next === "invoices") params.set("view", "invoices")
    navigate(params, "push")
  }
  const toggle = (key: string, value: string) => navigate(toggleFacetParam(searchParams, key, value))
  const clearFacets = (keys: string[]) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const k of keys) next.delete(k)
    navigate(next)
  }
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams.toString())
    if (value === null) next.delete(key)
    else next.set(key, value)
    navigate(next)
  }

  const todayStr = data?.today ?? ""
  const actionState = facetStateFromParams(searchParams, ACTION_FACETS)
  const invoiceState = facetStateFromParams(searchParams, INVOICE_FACETS)
  const statusParam = searchParams.get("status") as InvoiceStatusFilter | null
  const status: InvoiceStatusFilter = statusParam && INVOICE_STATUS_FILTERS.includes(statusParam) ? statusParam : "all"
  const grouped = searchParams.get("group") !== "none"
  const orderByDue = searchParams.get("order") === "due"

  const actionRows = useMemo(() => (data ? filterRows(data.rows, ACTION_FACETS, actionState) : []), [data, actionState])
  const facetedInvoices = useMemo(
    () => (invoices ? filterRows(invoices, INVOICE_FACETS, invoiceState) : []),
    [invoices, invoiceState],
  )
  const statusCount = (s: InvoiceStatusFilter) =>
    s === "all" ? facetedInvoices.length : facetedInvoices.filter((i) => displayStatusOf(i, todayStr) === s).length
  const shownInvoices = useMemo(() => {
    const rows = status === "all" ? facetedInvoices : facetedInvoices.filter((i) => displayStatusOf(i, todayStr) === status)
    return orderByDue ? [...rows].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999")) : rows
  }, [facetedInvoices, orderByDue, status, todayStr])

  const from = `/billing?${searchParams.toString()}`

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
      <div className="pt-2">
        <h1 className="text-2xl leading-tight font-semibold tracking-tight">Billing</h1>
        {data ? (
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">{sublineFor(data.today)}</p>
        ) : (
          <Skeleton className="mt-1.5 h-4 w-48" />
        )}
      </div>

      {data ? <Tiles data={data} /> : <Skeleton className="mt-5 h-[84px] w-full rounded-xl" />}

      <div className="mt-7 flex items-center gap-6 border-b border-border">
        <ViewTab active={view === "action"} onClick={() => setView("action")} label="Needs action">
          <span
            className={cn(
              "inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-xs font-semibold tabular-nums",
              (data?.needsActionCount ?? 0) > 0 ? "bg-blue-500 text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {data?.needsActionCount ?? 0}
          </span>
          {(data?.pastDueCount ?? 0) > 0 ? <span className="size-[7px] rounded-full bg-destructive" title="Past due invoice" /> : null}
        </ViewTab>
        <ViewTab active={view === "invoices"} onClick={() => setView("invoices")} label="Invoices">
          <span className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-muted px-1.5 text-xs font-semibold text-muted-foreground tabular-nums">
            {invoices?.length ?? 0}
          </span>
        </ViewTab>
        <span className="flex-1" />
        <div className="flex items-center gap-1.5 pb-1.5">
          {view === "action" ? (
            <FacetFilterButton rows={data?.rows ?? []} defs={ACTION_FACETS} state={actionState} icons={FACET_ICONS} onToggle={toggle} />
          ) : (
            <FacetFilterButton rows={invoices ?? []} defs={INVOICE_FACETS} state={invoiceState} icons={FACET_ICONS} onToggle={toggle} />
          )}
          <DisplayButton>
            {view === "action" ? (
              <DisplayRow label="Grouping">
                <Toggle size="sm" pressed={grouped} onPressedChange={() => setParam("group", null)}>
                  State
                </Toggle>
                <Toggle size="sm" pressed={!grouped} onPressedChange={() => setParam("group", "none")}>
                  None
                </Toggle>
              </DisplayRow>
            ) : (
              <DisplayRow label="Ordering">
                <Toggle size="sm" pressed={!orderByDue} onPressedChange={() => setParam("order", null)}>
                  Newest
                </Toggle>
                <Toggle size="sm" pressed={orderByDue} onPressedChange={() => setParam("order", "due")}>
                  Due date
                </Toggle>
              </DisplayRow>
            )}
          </DisplayButton>
        </div>
      </div>

      {view === "action" ? (
        <>
          <ActiveFacetPills
            rows={data?.rows ?? []}
            defs={ACTION_FACETS}
            state={actionState}
            onToggle={toggle}
            onClear={() => clearFacets(ACTION_FACETS.map((d) => d.key))}
          />
          {data ? (
            <NeedsActionList
              rows={actionRows}
              todayStr={data.today}
              grouped={grouped}
              filtered={actionRows.length !== data.rows.length}
              onViewInvoices={() => setView("invoices")}
            />
          ) : (
            <ListSkeleton />
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 pt-3.5 pb-3">
            {INVOICE_STATUS_FILTERS.map((s) => (
              <Button
                key={s}
                variant="outline"
                size="sm"
                className={cn("h-7 rounded-full", status === s && "border-transparent bg-foreground/[0.07] font-medium")}
                onClick={() => setParam("status", s === "all" ? null : s)}
              >
                {invoiceStatusLabel(s)}
                <span className="text-muted-foreground tabular-nums">{statusCount(s)}</span>
              </Button>
            ))}
          </div>
          <ActiveFacetPills
            rows={invoices ?? []}
            defs={INVOICE_FACETS}
            state={invoiceState}
            onToggle={toggle}
            onClear={() => clearFacets(INVOICE_FACETS.map((d) => d.key))}
          />
          {invoices && data ? <HubInvoiceTable invoices={shownInvoices} todayStr={data.today} from={from} /> : <ListSkeleton />}
        </>
      )}
    </div>
  )
}

/** "October 2026 · month-end in 8 days". */
function sublineFor(todayStr: string): string {
  const [y, m] = todayStr.split("-").map(Number)
  const month = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const left = daysLeft(todayStr, end)
  return `${month} · ${left <= 1 ? "month-end today" : `month-end in ${left} days`}`
}

/** Hub tiles (H3, P10): information only, not filters. */
function Tiles({ data }: { data: NeedsActionData }) {
  const { unbilled, outstanding, paidThisMonth, monthsToClose } = data.tiles
  return (
    <div className="mt-5 grid grid-cols-2 divide-border/60 rounded-xl bg-background ring-1 ring-border/70 md:grid-cols-4 md:divide-x">
      <Tile label="Unbilled" value={money(unbilled.minorByCurrency)} sub={`${unbilled.readyCount} ready · ${unbilled.draftCount} draft`} />
      <Tile
        label="Outstanding"
        value={money(outstanding.minorByCurrency)}
        sub={
          <>
            <span className={cn(outstanding.pastDueCount > 0 && "text-destructive")}>{outstanding.pastDueCount} past due</span>
            {` · ${outstanding.invoicedCount} invoiced`}
          </>
        }
      />
      <Tile
        label="Paid this month"
        value={money(paidThisMonth.minorByCurrency)}
        sub={`${paidThisMonth.count} ${paidThisMonth.count === 1 ? "invoice" : "invoices"}`}
      />
      <Tile
        label="Months to close"
        value={String(monthsToClose.count)}
        sub={`${monthsToClose.waitingCount} waiting on an earlier month`}
      />
    </div>
  )
}

/** Per-currency totals, never summed across currencies. */
function money(byCurrency: Record<string, number>): string {
  const entries = Object.entries(byCurrency)
  if (entries.length === 0) return formatMinor(0, "USD")
  return entries.map(([cur, minor]) => formatMinor(minor, cur)).join(" · ")
}

function Tile({ label, value, sub }: { label: string; value: string; sub: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-[18px] py-3.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-lg font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{sub}</span>
    </div>
  )
}

function ViewTab({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "relative -mb-px inline-flex h-11 items-center gap-2 border-b-2 text-[15px]",
        active ? "border-foreground font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {children}
    </button>
  )
}

function DisplayButton({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className="rounded-full" aria-label="Display options">
          <SlidersHorizontalIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        {children}
      </PopoverContent>
    </Popover>
  )
}

function DisplayRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex gap-1">{children}</span>
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="mt-3 flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-11 w-full" />
      ))}
    </div>
  )
}

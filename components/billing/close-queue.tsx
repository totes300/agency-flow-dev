"use client"

import { useMemo } from "react"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { BillingToolbar } from "@/components/billing/billing-toolbar"
import { CloseQueueRow } from "@/components/billing/close-queue-row"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CloseQueueEmpty } from "@/components/billing/close-queue-empty"
import {
  CloseQueueFilterBar,
  CloseQueueActiveFacets,
} from "@/components/billing/close-queue-filter-bar"
import { useCloseFacets } from "@/lib/hooks/use-close-facets"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { rowMatches } from "@/lib/billing/close-queue-filters"
import { pluralize } from "@/lib/format"
import type { CloseQueueData } from "@/convex/billingViews"

/**
 * The Billing → To close tab: one single-line row per project with a period
 * due, oldest period first, so the list reads top-down as the order to work
 * in. An open table (hairline rows, no card frame) with a results count
 * underneath. A ghost
 * search + faceted filter (client / billing type / readiness) narrow it;
 * both are URL-persisted and applied client-side.
 */
export function CloseQueueView({
  data,
  draftCount,
  outstandingCount,
  hasOverdue,
}: {
  data: CloseQueueData
  draftCount: number
  outstandingCount: number
  hasOverdue: boolean
}) {
  const { facets, toggleValue, clearAll } = useCloseFacets()
  const [searchInput, setSearchInput] = useUrlDebouncedParam("search")
  const search = searchInput

  const allRows = useMemo(
    () => data.months.flatMap((m) => m.rows),
    [data.months],
  )

  const rows = useMemo(
    () =>
      allRows
        .filter((r) => rowMatches(r, facets, search))
        .sort(
          (a, b) =>
            a.periodToken.localeCompare(b.periodToken) ||
            a.projectName.localeCompare(b.projectName),
        ),
    [allRows, facets, search],
  )

  const totallyEmpty = allRows.length === 0

  return (
    <div className="flex flex-col gap-4">
      <BillingToolbar
        closeCount={data.actionableCount}
        draftCount={draftCount}
        outstandingCount={outstandingCount}
        hasOverdue={hasOverdue}
        rightControls={
          <>
            <CloseQueueFilterBar
              rows={allRows}
              facets={facets}
              search={search}
              toggleValue={toggleValue}
            />
            <div className="relative w-64">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search project or client"
                aria-label="Search closable periods"
                className="h-8 pl-8"
              />
            </div>
          </>
        }
        activeFilters={
          <CloseQueueActiveFacets
            rows={allRows}
            facets={facets}
            toggleValue={toggleValue}
            clearAll={clearAll}
            hasSearch={search.trim() !== ""}
          />
        }
      />

      {totallyEmpty ? (
        <CloseQueueEmpty reason="caught-up" />
      ) : rows.length === 0 ? (
        <CloseQueueEmpty reason="no-matches" onClearFilters={clearAll} />
      ) : (
        <div className="flex flex-col">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-32 pl-3 text-xs font-medium sm:w-44">Period</TableHead>
                <TableHead className="text-xs font-medium">Project</TableHead>
                <TableHead className="hidden text-xs font-medium md:table-cell">Client</TableHead>
                <TableHead className="hidden w-36 text-xs font-medium sm:table-cell">Status</TableHead>
                <TableHead className="hidden w-32 text-right text-xs font-medium lg:table-cell">Time</TableHead>
                <TableHead className="w-28 text-right text-xs font-medium">Amount</TableHead>
                <TableHead className="hidden w-36 pr-3 sm:table-cell">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {rows.map((row) => (
                <CloseQueueRow key={row.key} row={row} />
              ))}
            </TableBody>
          </Table>
          <p className="px-3 pt-3 text-xs tabular-nums text-muted-foreground">
            {rows.length === allRows.length
              ? `${rows.length} ${pluralize(rows.length, "period", "periods")}`
              : `${rows.length} of ${allRows.length} periods`}
          </p>
        </div>
      )}
    </div>
  )
}

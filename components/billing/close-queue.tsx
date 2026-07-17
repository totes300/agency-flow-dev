"use client"

import { useMemo } from "react"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { BillingToolbar } from "@/components/billing/billing-toolbar"
import { CloseQueueMonthGroup } from "@/components/billing/close-queue-month"
import { CloseQueueEmpty } from "@/components/billing/close-queue-empty"
import {
  CloseQueueFilterBar,
  CloseQueueActiveFacets,
} from "@/components/billing/close-queue-filter-bar"
import { useCloseFacets } from "@/lib/hooks/use-close-facets"
import { useUrlDebouncedParam } from "@/lib/hooks/use-url-debounced-param"
import { rowMatches } from "@/lib/billing/close-queue-filters"
import type { CloseQueueData } from "@/convex/close"

/**
 * The Billing → Close tab: the front door of the month-end ritual. Month-grouped
 * flat rows with progress + review signals, oldest-first blocking, a ghost
 * search + faceted filter (client / billing type / readiness), and dedicated
 * empty states (PRD slice 08, stories 1–5, 29).
 *
 * Facets + search are URL-persisted and applied client-side over the server's
 * month groups; each month's "N of M closed" progress stays the month's real
 * state while the rows shown honor the filter.
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

  const filteredMonths = useMemo(
    () =>
      data.months
        .map((m) => ({
          ...m,
          rows: m.rows.filter((r) => rowMatches(r, facets, search)),
        }))
        .filter((m) => m.rows.length > 0),
    [data.months, facets, search],
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
      ) : filteredMonths.length === 0 ? (
        <CloseQueueEmpty reason="no-matches" onClearFilters={clearAll} />
      ) : (
        <div className="flex flex-col gap-8">
          {filteredMonths.map((m) => (
            <CloseQueueMonthGroup
              key={m.monthKey}
              label={m.label}
              rows={m.rows}
              closedCount={m.closedCount}
              totalCount={m.totalCount}
            />
          ))}
        </div>
      )}
    </div>
  )
}

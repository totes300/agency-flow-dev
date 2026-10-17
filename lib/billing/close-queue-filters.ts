// Pure filter logic for the Billing → Close queue (PRD slice 08). Facets:
// client, billing type, readiness — URL-persisted, cross-filtered with counts,
// no default filter. Kept pure so the predicate + counting are testable and the
// view/filter-bar stay thin.

import type { CloseQueueRow } from "@/convex/billingViews"

export type CloseFacetKey = "client" | "billingType" | "readiness"

/** Active facet selections. Empty arrays/undefined = facet not applied. */
export type CloseFacets = {
  client: string[]
  billingType: string[]
  readiness: string[]
}

export const EMPTY_FACETS: CloseFacets = {
  client: [],
  billingType: [],
  readiness: [],
}

export const READINESS_OPTIONS = [
  { id: "needs-review", name: "Needs review" },
  { id: "ready", name: "Ready" },
] as const

/** A row's readiness bucket — flagged rows need review, everything else is ready. */
export function readinessOf(row: CloseQueueRow): "needs-review" | "ready" {
  return row.flagCount > 0 ? "needs-review" : "ready"
}

/** True when the row satisfies every active facet, ignoring `except` (for counts). */
export function rowMatchesFacets(
  row: CloseQueueRow,
  facets: CloseFacets,
  except?: CloseFacetKey,
): boolean {
  if (
    except !== "client" &&
    facets.client.length > 0 &&
    !facets.client.includes(row.clientId)
  ) {
    return false
  }
  if (
    except !== "billingType" &&
    facets.billingType.length > 0 &&
    !facets.billingType.includes(row.billingType)
  ) {
    return false
  }
  if (
    except !== "readiness" &&
    facets.readiness.length > 0 &&
    !facets.readiness.includes(readinessOf(row))
  ) {
    return false
  }
  return true
}

/** Ghost-search over project + client name (case-insensitive). */
export function rowMatchesSearch(row: CloseQueueRow, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (q === "") return true
  return (
    row.projectName.toLowerCase().includes(q) ||
    row.clientName.toLowerCase().includes(q)
  )
}

export function rowMatches(
  row: CloseQueueRow,
  facets: CloseFacets,
  search: string,
): boolean {
  return rowMatchesFacets(row, facets) && rowMatchesSearch(row, search)
}

export function hasActiveFacets(facets: CloseFacets): boolean {
  return (
    facets.client.length > 0 ||
    facets.billingType.length > 0 ||
    facets.readiness.length > 0
  )
}

/**
 * Cross-filtered option counts for one facet: how many rows would remain if the
 * user added each option, given the OTHER facets + search already applied. This
 * is the standard faceted-count behavior (each menu reflects the rest).
 */
export function facetCounts(
  rows: CloseQueueRow[],
  facet: CloseFacetKey,
  facets: CloseFacets,
  search: string,
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!rowMatchesSearch(row, search)) continue
    if (!rowMatchesFacets(row, facets, facet)) continue
    const key =
      facet === "client"
        ? row.clientId
        : facet === "billingType"
          ? row.billingType
          : readinessOf(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Client-side faceted filtering for project time entries.
 *
 * The Time tab reuses the tasks page's Notion-style "+ Filter" engine
 * (`components/ui/filters.tsx` / `lib/filter-types.ts`). The backend query
 * (`listProjectEntries`) narrows only by project + date range + search;
 * these facets run in the browser over the loaded rows — same tradeoff the
 * server makes (it filters in memory too), without widening the query API
 * for every new facet.
 *
 * Pure helpers — no React. URL codec keeps the "filters persist in URL"
 * convention: one `filters` param, segments `facet.op.v1,v2` joined by
 * ";" (Convex ids and status keys never contain `.`, `,` or `;`).
 */

import { FilterOperator, type Filter } from "@/lib/filter-types"
import { entryStatus, type EntryShape } from "@/convex/lib/entryStatus"

export const TIME_ENTRY_FACETS = ["member", "category", "status"] as const
export type TimeEntryFacet = (typeof TIME_ENTRY_FACETS)[number]

function isTimeEntryFacet(value: string): value is TimeEntryFacet {
  return (TIME_ENTRY_FACETS as readonly string[]).includes(value)
}

/** Structural subset of `TimeEntryRow` the facets read. */
export type FilterableTimeEntry = EntryShape & {
  userId: string
  workCategoryId?: string
}

// Only the operators `defaultOperators` offers for option facets. Everything
// exclude-flavored collapses to "not" — the pill UI never produces the
// include/exclude collection operators for these facets.
const OPERATOR_TO_TOKEN = new Map<FilterOperator, string>([
  [FilterOperator.IS, "is"],
  [FilterOperator.IS_ANY_OF, "any"],
  [FilterOperator.IS_NOT, "not"],
])

const TOKEN_TO_OPERATOR = new Map<string, FilterOperator>([
  ["is", FilterOperator.IS],
  ["any", FilterOperator.IS_ANY_OF],
  ["not", FilterOperator.IS_NOT],
])

function isExclude(operator: FilterOperator): boolean {
  return (
    operator === FilterOperator.IS_NOT ||
    operator === FilterOperator.DO_NOT_INCLUDE ||
    operator === FilterOperator.EXCLUDE_ALL_OF ||
    operator === FilterOperator.EXCLUDE_IF_ANY_OF
  )
}

/**
 * Serialize active filters for the `?filters=` param. Empty-value filters
 * are dropped (a pill whose last value was unchecked). Returns undefined
 * when nothing survives so the caller can delete the param.
 */
export function serializeTimeEntryFilters(
  filters: Filter[],
): string | undefined {
  const segments: string[] = []
  for (const f of filters) {
    if (!isTimeEntryFacet(f.type) || f.value.length === 0) continue
    const token = OPERATOR_TO_TOKEN.get(f.operator) ?? "is"
    segments.push(`${f.type}.${token}.${f.value.join(",")}`)
  }
  return segments.length > 0 ? segments.join(";") : undefined
}

/**
 * Parse the `?filters=` param back into the engine's `Filter[]`. Malformed
 * segments are skipped, never thrown — a hand-edited URL degrades to fewer
 * filters. Ids are deterministic (`facet-i`) so pills keep identity across
 * URL round-trips.
 */
export function parseTimeEntryFilters(param: string | null): Filter[] {
  if (!param) return []
  const filters: Filter[] = []
  for (const segment of param.split(";")) {
    const [type, token, values] = segment.split(".")
    if (!type || !token || !values) continue
    if (!isTimeEntryFacet(type)) continue
    const operator = TOKEN_TO_OPERATOR.get(token)
    if (!operator) continue
    const value = values.split(",").filter(Boolean)
    if (value.length === 0) continue
    filters.push({
      id: `${type}-${filters.length}`,
      type,
      operator,
      value,
    })
  }
  return filters
}

/** Apply every active facet; filters AND together, values within one OR. */
export function applyTimeEntryFilters<T extends FilterableTimeEntry>(
  entries: T[],
  filters: Filter[],
): T[] {
  const active = filters.filter(
    (f) => isTimeEntryFacet(f.type) && f.value.length > 0,
  )
  if (active.length === 0) return entries

  return entries.filter((entry) =>
    active.every((f) => {
      const set = new Set(f.value)
      const rowValue =
        f.type === "member"
          ? entry.userId
          : f.type === "category"
            ? (entry.workCategoryId ?? "")
            : entryStatus(entry)
      return isExclude(f.operator) ? !set.has(rowValue) : set.has(rowValue)
    }),
  )
}

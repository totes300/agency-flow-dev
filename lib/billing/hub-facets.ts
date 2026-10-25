/**
 * Faceted "+ Filter" logic for the Billing hub lists
 * (docs/prd-project-billing-redesign.md §8): each facet reads one value off
 * a row; active facets AND together, values within a facet OR. Counts are
 * cross-filtered (each menu reflects the other active facets). State lives
 * in the URL, one comma-separated param per facet. Pure.
 */

export type FacetDef<R> = {
  key: string
  label: string
  valueOf: (row: R) => string
  /** Display name of a value; defaults to the value. */
  nameOf?: (value: string, rows: readonly R[]) => string
  /** Fixed option order (e.g. states); otherwise alphabetical by name. */
  order?: readonly string[]
}

export type FacetState = Record<string, string[]>

export function rowMatchesFacets<R>(
  row: R,
  defs: readonly FacetDef<R>[],
  state: FacetState,
  except?: string,
): boolean {
  return defs.every((d) => {
    if (d.key === except) return true
    const active = state[d.key] ?? []
    return active.length === 0 || active.includes(d.valueOf(row))
  })
}

export function filterRows<R>(rows: readonly R[], defs: readonly FacetDef<R>[], state: FacetState): R[] {
  return rows.filter((r) => rowMatchesFacets(r, defs, state))
}

export type FacetOption = { id: string; name: string; count: number }

/** Options of one facet with cross-filtered counts. */
export function facetOptions<R>(
  rows: readonly R[],
  defs: readonly FacetDef<R>[],
  state: FacetState,
  key: string,
): FacetOption[] {
  const def = defs.find((d) => d.key === key)
  if (!def) return []
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = def.valueOf(row)
    if (!counts.has(value)) counts.set(value, 0)
    if (rowMatchesFacets(row, defs, state, key)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  const options = [...counts.entries()].map(([id, count]) => ({ id, name: def.nameOf?.(id, rows) ?? id, count }))
  if (def.order) {
    const rank = (id: string) => {
      const i = def.order!.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return options.sort((a, b) => rank(a.id) - rank(b.id))
  }
  return options.sort((a, b) => a.name.localeCompare(b.name))
}

export function facetStateFromParams(params: URLSearchParams, defs: readonly { key: string }[]): FacetState {
  const state: FacetState = {}
  for (const d of defs) {
    const raw = params.get(d.key)
    if (raw) state[d.key] = raw.split(",").filter(Boolean)
  }
  return state
}

/** Toggles one value; returns the params to navigate to. */
export function toggleFacetParam(params: URLSearchParams, key: string, value: string): URLSearchParams {
  const next = new URLSearchParams(params.toString())
  const current = (next.get(key) ?? "").split(",").filter(Boolean)
  const updated = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  if (updated.length > 0) next.set(key, updated.join(","))
  else next.delete(key)
  return next
}

export function activeFacetCount(state: FacetState): number {
  return Object.values(state).reduce((sum, values) => sum + values.length, 0)
}

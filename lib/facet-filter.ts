/**
 * Generic Notion-style faceted filters (`feedback_notion_filter_pattern`) for
 * lists that are not task rows (the projects directory). Pure. The same rules
 * as the task view's `filter-model.ts`: a property's value list comes from
 * the items passing every OTHER active filter, with match counts; values with
 * no match are hidden unless selected. Values within one property are OR'd,
 * properties are AND'd.
 */

export type FacetField<T, F extends string> = {
  key: F
  label: string
  /** The item's value for this property (its filter key). */
  valueOf: (item: T) => string
  /** Display name of the item's value. */
  labelOf: (item: T) => string
  /** Fixed value order (e.g. billing types); otherwise values sort by label. */
  order?: readonly string[]
}

/** Selected values per property; a property with no values is inactive. */
export type FacetSelection<F extends string> = Partial<Record<F, readonly string[]>>

export type FacetOption = {
  key: string
  label: string
  count: number
  selected: boolean
}

function selectedOf<F extends string>(selection: FacetSelection<F>, field: F): readonly string[] {
  return selection[field] ?? []
}

function passes<T, F extends string>(
  item: T,
  fields: readonly FacetField<T, F>[],
  selection: FacetSelection<F>,
  except?: F,
): boolean {
  for (const field of fields) {
    if (field.key === except) continue
    const values = selectedOf(selection, field.key)
    if (values.length > 0 && !values.includes(field.valueOf(item))) return false
  }
  return true
}

/** Items passing every active filter. */
export function applyFacetFilters<T, F extends string>(
  items: readonly T[],
  fields: readonly FacetField<T, F>[],
  selection: FacetSelection<F>,
): T[] {
  return items.filter((item) => passes(item, fields, selection))
}

/**
 * The value list of `field`: values present in the items passing the other
 * filters (with counts), plus selected values even at zero, labelled from the
 * full item list.
 */
export function deriveFacetOptions<T, F extends string>(
  items: readonly T[],
  fields: readonly FacetField<T, F>[],
  selection: FacetSelection<F>,
  fieldKey: F,
): FacetOption[] {
  const field = fields.find((f) => f.key === fieldKey)
  if (!field) return []
  const selected = selectedOf(selection, fieldKey)
  const options = new Map<string, FacetOption>()
  for (const item of items) {
    if (!passes(item, fields, selection, fieldKey)) continue
    const key = field.valueOf(item)
    const existing = options.get(key)
    if (existing) existing.count += 1
    else options.set(key, { key, label: field.labelOf(item), count: 1, selected: selected.includes(key) })
  }
  for (const key of selected) {
    if (options.has(key)) continue
    const source = items.find((item) => field.valueOf(item) === key)
    options.set(key, { key, label: source ? field.labelOf(source) : key, count: 0, selected: true })
  }
  const result = [...options.values()]
  const order = field.order
  if (order) {
    const rank = (key: string) => {
      const i = order.indexOf(key)
      return i === -1 ? order.length : i
    }
    return result.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label))
  }
  return result.sort((a, b) => a.label.localeCompare(b.label))
}

/** Adds or removes one value of `field`. */
export function toggleFacetValue<F extends string>(
  selection: FacetSelection<F>,
  field: F,
  value: string,
): FacetSelection<F> {
  const current = selectedOf(selection, field)
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
  return { ...selection, [field]: next }
}

/** Drops every value of `field`. */
export function clearFacet<F extends string>(selection: FacetSelection<F>, field: F): FacetSelection<F> {
  return { ...selection, [field]: [] }
}

/** Properties with at least one selected value, in field order. */
export function activeFacetFields<F extends string, Field extends { key: F }>(
  fields: readonly Field[],
  selection: FacetSelection<F>,
): Field[] {
  return fields.filter((f) => selectedOf(selection, f.key).length > 0)
}

export function hasActiveFacets<T, F extends string>(
  fields: readonly FacetField<T, F>[],
  selection: FacetSelection<F>,
): boolean {
  return activeFacetFields(fields, selection).length > 0
}

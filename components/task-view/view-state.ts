import {
  DEFAULT_SYSTEM_VIEW,
  SYSTEM_VIEWS,
  taskViewGroupByValidator,
  taskViewOrderByValidator,
  taskViewPropertyValidator,
  type ListViewSurface,
  type TaskViewSpec,
} from "@/convex/tasks/model"

/**
 * URL ⇄ view spec ⇄ system-view defaults (docs/prd-tasks-refactor.md §4.4,
 * §6.1). The selected view lives in `?view=`; unsaved display changes live
 * in the URL as overrides on top of that view's spec, so a reload or a shared
 * link shows the same table. Only values that differ from the view's spec
 * are written, which makes "modified" a plain comparison. Unknown or invalid
 * params are ignored (the view's own value wins).
 *
 * Pure — the hook (`use-view-state.ts`) binds it to the router.
 */

export type GroupBy = TaskViewSpec["groupBy"]
export type OrderBy = TaskViewSpec["orderBy"]
export type ViewProperty = TaskViewSpec["visibleProperties"][number]

export const GROUP_BY_VALUES: readonly GroupBy[] = taskViewGroupByValidator.members.map((m) => m.value)
export const ORDER_BY_VALUES: readonly OrderBy[] = taskViewOrderByValidator.members.map((m) => m.value)
export const VIEW_PROPERTY_VALUES: readonly ViewProperty[] = taskViewPropertyValidator.members.map((m) => m.value)

/** Search params owned by the view state. Everything else (e.g. `detail`) is left alone. */
export const VIEW_PARAM = "view"
export const OVERRIDE_PARAMS = {
  groupBy: "group",
  orderBy: "order",
  visibleProperties: "props",
  showSubtasks: "sub",
  showEmptyGroups: "empty",
} as const

type OverrideKey = keyof typeof OVERRIDE_PARAMS

/** The display fields a URL may override. Filters and layout arrive with slice 4. */
export type ViewOverrides = Partial<Pick<TaskViewSpec, OverrideKey>>

export type SystemViewOption = { key: string; name: string }

export function systemViewsFor(surface: ListViewSurface): SystemViewOption[] {
  return Object.entries(SYSTEM_VIEWS[surface]).map(([key, view]) => ({ key, name: view.name }))
}

/** The `?view=` value if it names a system view of the surface, else the surface default. */
export function resolveViewKey(surface: ListViewSurface, raw: string | null): string {
  if (raw && Object.prototype.hasOwnProperty.call(SYSTEM_VIEWS[surface], raw)) return raw
  return DEFAULT_SYSTEM_VIEW[surface]
}

export function baseSpecFor(surface: ListViewSurface, viewKey: string): TaskViewSpec {
  return SYSTEM_VIEWS[surface][resolveViewKey(surface, viewKey)].spec
}

function parseBoolean(raw: string | null): boolean | undefined {
  if (raw === "1") return true
  if (raw === "0") return false
  return undefined
}

function parseProperties(raw: string | null): ViewProperty[] | undefined {
  if (raw === null) return undefined
  if (raw === "") return []
  const seen = new Set<ViewProperty>()
  for (const part of raw.split(",")) {
    const value = part.trim() as ViewProperty
    if ((VIEW_PROPERTY_VALUES as readonly string[]).includes(value)) seen.add(value)
  }
  return seen.size > 0 ? [...seen] : undefined
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return raw !== null && (values as readonly string[]).includes(raw) ? (raw as T) : undefined
}

/** Overrides present in the URL (valid values only). */
export function parseOverrides(params: URLSearchParams): ViewOverrides {
  const out: ViewOverrides = {}
  const groupBy = oneOf(GROUP_BY_VALUES, params.get(OVERRIDE_PARAMS.groupBy))
  if (groupBy) out.groupBy = groupBy
  const orderBy = oneOf(ORDER_BY_VALUES, params.get(OVERRIDE_PARAMS.orderBy))
  if (orderBy) out.orderBy = orderBy
  const visibleProperties = parseProperties(params.get(OVERRIDE_PARAMS.visibleProperties))
  if (visibleProperties) out.visibleProperties = visibleProperties
  const showSubtasks = parseBoolean(params.get(OVERRIDE_PARAMS.showSubtasks))
  if (showSubtasks !== undefined) out.showSubtasks = showSubtasks
  const showEmptyGroups = parseBoolean(params.get(OVERRIDE_PARAMS.showEmptyGroups))
  if (showEmptyGroups !== undefined) out.showEmptyGroups = showEmptyGroups
  return out
}

/** The effective spec: the view's spec with the URL's overrides applied. */
export function specFromSearchParams(params: URLSearchParams, base: TaskViewSpec): TaskViewSpec {
  return { ...base, ...parseOverrides(params) }
}

function sameProperties(a: readonly ViewProperty[], b: readonly ViewProperty[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

/** The fields of `spec` that differ from `base` (what the URL must carry). */
export function diffOverrides(spec: TaskViewSpec, base: TaskViewSpec): ViewOverrides {
  const out: ViewOverrides = {}
  if (spec.groupBy !== base.groupBy) out.groupBy = spec.groupBy
  if (spec.orderBy !== base.orderBy) out.orderBy = spec.orderBy
  if (!sameProperties(spec.visibleProperties, base.visibleProperties)) out.visibleProperties = spec.visibleProperties
  if (spec.showSubtasks !== base.showSubtasks) out.showSubtasks = spec.showSubtasks
  if (spec.showEmptyGroups !== base.showEmptyGroups) out.showEmptyGroups = spec.showEmptyGroups
  return out
}

/** True when the URL's display state differs from the selected view's spec (the "modified" dot). */
export function isSpecModified(spec: TaskViewSpec, base: TaskViewSpec): boolean {
  return Object.keys(diffOverrides(spec, base)).length > 0
}

/**
 * Writes `spec` into a copy of `current` as overrides on `base`, plus the
 * view key (omitted for the surface default). Params the view state does not
 * own are preserved.
 */
export function writeViewParams(
  current: URLSearchParams,
  surface: ListViewSurface,
  viewKey: string,
  spec: TaskViewSpec,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  const key = resolveViewKey(surface, viewKey)
  if (key === DEFAULT_SYSTEM_VIEW[surface]) next.delete(VIEW_PARAM)
  else next.set(VIEW_PARAM, key)

  for (const param of Object.values(OVERRIDE_PARAMS)) next.delete(param)
  const overrides = diffOverrides(spec, baseSpecFor(surface, key))
  if (overrides.groupBy) next.set(OVERRIDE_PARAMS.groupBy, overrides.groupBy)
  if (overrides.orderBy) next.set(OVERRIDE_PARAMS.orderBy, overrides.orderBy)
  if (overrides.visibleProperties) next.set(OVERRIDE_PARAMS.visibleProperties, overrides.visibleProperties.join(","))
  if (overrides.showSubtasks !== undefined) next.set(OVERRIDE_PARAMS.showSubtasks, overrides.showSubtasks ? "1" : "0")
  if (overrides.showEmptyGroups !== undefined) next.set(OVERRIDE_PARAMS.showEmptyGroups, overrides.showEmptyGroups ? "1" : "0")
  return next
}

/** `?a=b` (or "") for router navigation. */
export function toSearchString(params: URLSearchParams): string {
  const str = params.toString()
  return str ? `?${str}` : ""
}

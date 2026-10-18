import {
  DEFAULT_SYSTEM_VIEW,
  SYSTEM_VIEWS,
  normalizeViewSpec,
  taskViewFilterOperatorValidator,
  taskViewFilterPropertyValidator,
  taskViewGroupByValidator,
  taskViewOrderByValidator,
  taskViewPropertyValidator,
  type ListViewSurface,
  type TaskViewSpec,
} from "@/convex/tasks/model"
import type { ListFilter } from "@/convex/tasks/filters"

/**
 * URL ⇄ view ⇄ spec (docs/prd-tasks-refactor.md §4.4, §5.4, §6.1). Pure — the
 * hook (`use-view-state.ts`) binds it to the router and the saved views.
 *
 * - `?view=` selects a system view (`active`) or a saved view (its id); My
 *   Tasks uses `?tab=` (§6.1) and opens on its Today plan (`TODAY_VIEW_KEY`).
 * - Unsaved changes live in the URL as overrides on top of that view, so a
 *   reload or a shared link shows the same view. Only values that differ
 *   from the view are written, so "modified" is a plain comparison.
 * - A view's filters split in two:
 *   - **scope** — sent to `listView` and applied server-side (index choice):
 *     a system view's own filters (they define it: Active, Backlog, …) and a
 *     saved view's `statusCategory` filters;
 *   - **chips** — the editable filters (U7), applied client-side over the
 *     loaded rows together with the facets: a saved view's other filters, or
 *     the URL's `filter` params when present.
 *   Saving a view stores `scope + chips`.
 * - Unknown or invalid params are ignored (the view's own value wins).
 */

export type GroupBy = TaskViewSpec["groupBy"]
export type OrderBy = TaskViewSpec["orderBy"]
export type Layout = TaskViewSpec["layout"]
export type ViewProperty = TaskViewSpec["visibleProperties"][number]
export type FilterProperty = ListFilter["property"]
export type { ListFilter }

export const GROUP_BY_VALUES: readonly GroupBy[] = taskViewGroupByValidator.members.map((m) => m.value)
export const ORDER_BY_VALUES: readonly OrderBy[] = taskViewOrderByValidator.members.map((m) => m.value)
export const VIEW_PROPERTY_VALUES: readonly ViewProperty[] = taskViewPropertyValidator.members.map((m) => m.value)
export const LAYOUT_VALUES: readonly Layout[] = ["list", "board"]
const FILTER_PROPERTY_VALUES: readonly FilterProperty[] = taskViewFilterPropertyValidator.members.map((m) => m.value)
const FILTER_OPERATOR_VALUES: readonly ListFilter["operator"][] = taskViewFilterOperatorValidator.members.map((m) => m.value)

/** Search params owned by the view state. Everything else (e.g. `detail`) is left alone. */
export const VIEW_PARAM = "view"
/** My Tasks names its tabs `?tab=` (§6.1). */
export const TAB_PARAM = "tab"
export const FILTER_PARAM = "filter"
export const SEARCH_PARAM = "q"
export const OVERRIDE_PARAMS = {
  layout: "layout",
  groupBy: "group",
  orderBy: "order",
  visibleProperties: "props",
  showSubtasks: "sub",
  showEmptyGroups: "empty",
} as const

type DisplayKey = keyof typeof OVERRIDE_PARAMS

/** Everything a view stores except its filters. */
export type DisplaySpec = Omit<TaskViewSpec, "filters">

/** The unsaved state of a view: display settings + the editable filters. */
export type ViewDraft = { display: DisplaySpec; chips: ListFilter[] }

/** What the URL may override on top of a view. */
export type ViewOverrides = Partial<Pick<TaskViewSpec, DisplayKey>> & { chips?: ListFilter[] }

export type ViewScope = "system" | "personal" | "workspace"

/** One tab: a system view (org default applied) or a saved view. */
export type ViewOption = {
  key: string
  name: string
  scope: ViewScope
  /** The caller may rename / re-save / reorder / delete it (saved views only). */
  canEdit: boolean
  spec: TaskViewSpec
  /**
   * A plan, not a filter (My Tasks Today, U8): served by `tasks/today.ts`,
   * fixed layout in the user's manual order; only the visible properties change.
   */
  plan?: true
}

/** My Tasks "Today" (U8, §5.6). Not a `listView` system view. */
export const TODAY_VIEW_KEY = "today"

/** Today's display (prototype v4): no grouping, the hand-made order, My Tasks columns. */
export const TODAY_SPEC: TaskViewSpec = {
  filters: [],
  layout: "list",
  groupBy: "none",
  orderBy: "manual",
  visibleProperties: ["priority", "title", "status", "labels", "client", "due", "time"],
  showSubtasks: false,
  showEmptyGroups: false,
}

const TODAY_OPTION: ViewOption = {
  key: TODAY_VIEW_KEY,
  name: "Today",
  scope: "system",
  canEdit: false,
  spec: TODAY_SPEC,
  plan: true,
}

/** The URL param naming the view on a surface. */
export function viewParamFor(surface: ListViewSurface): string {
  return surface === "myTasks" ? TAB_PARAM : VIEW_PARAM
}

/** The view a surface opens on (no param in the URL). */
export function defaultViewKeyFor(surface: ListViewSurface): string {
  return surface === "myTasks" ? TODAY_VIEW_KEY : DEFAULT_SYSTEM_VIEW[surface]
}

/** The saved-view shape `api.tasks.views.list` returns. */
export type SavedViewInput = {
  _id: string
  name: string
  scope: "personal" | "workspace"
  canEdit: boolean
  spec: TaskViewSpec
}

// ─── Views ───────────────────────────────────────────────────────────────────

/**
 * System views in order, with the org's "Set default for everyone" applied
 * when known. My Tasks starts with its Today plan.
 */
export function systemViewOptions(
  surface: ListViewSurface,
  defaults?: Readonly<Record<string, TaskViewSpec>>,
): ViewOption[] {
  const views: ViewOption[] = Object.entries(SYSTEM_VIEWS[surface]).map(([key, view]) => ({
    key,
    name: view.name,
    scope: "system",
    canEdit: false,
    spec: defaults?.[key] ?? view.spec,
  }))
  return surface === "myTasks" ? [TODAY_OPTION, ...views] : views
}

/** All tabs: system views, then the saved views in server order (workspace, then personal). */
export function buildViewOptions(
  surface: ListViewSurface,
  saved?: readonly SavedViewInput[],
  defaults?: Readonly<Record<string, TaskViewSpec>>,
): ViewOption[] {
  return [
    ...systemViewOptions(surface, defaults),
    ...(saved ?? []).map((v) => ({ key: v._id, name: v.name, scope: v.scope, canEdit: v.canEdit, spec: v.spec })),
  ]
}

/** The view `?view=` (`?tab=`) names, else the surface's default view. */
export function resolveView(options: readonly ViewOption[], surface: ListViewSurface, raw: string | null): ViewOption {
  const hit = raw ? options.find((o) => o.key === raw) : undefined
  return hit ?? options.find((o) => o.key === defaultViewKeyFor(surface)) ?? systemViewOptions(surface)[0]
}

export function isSystemView(view: Pick<ViewOption, "scope">): boolean {
  return view.scope === "system"
}

/** Filters `listView` applies server-side for this view. */
export function scopeFiltersOf(view: ViewOption): ListFilter[] {
  return isSystemView(view) ? view.spec.filters : view.spec.filters.filter((f) => f.property === "statusCategory")
}

/** The view's own editable filters (chips). */
export function baseChipsOf(view: ViewOption): ListFilter[] {
  return isSystemView(view) ? [] : view.spec.filters.filter((f) => f.property !== "statusCategory")
}

export function displayOf(spec: TaskViewSpec): DisplaySpec {
  return {
    layout: spec.layout,
    groupBy: spec.groupBy,
    orderBy: spec.orderBy,
    visibleProperties: spec.visibleProperties,
    showSubtasks: spec.showSubtasks,
    showEmptyGroups: spec.showEmptyGroups,
  }
}

/** The full spec of a draft on a view (what "Save" stores and the table renders). */
export function draftSpec(view: ViewOption, draft: ViewDraft): TaskViewSpec {
  return { ...draft.display, filters: [...scopeFiltersOf(view), ...draft.chips] }
}

// ─── Filters ⇄ URL ───────────────────────────────────────────────────────────

const VALUE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** `status.is.k1,k2` — values are ids, `me`, `none`, digits, dates or booleans. */
export function serializeFilter(f: ListFilter): string {
  return [f.property, f.operator, f.values.join(",")].join(".")
}

export function parseFilter(raw: string): ListFilter | null {
  const [property, operator, values = "", ...rest] = raw.split(".")
  if (rest.length > 0) return null
  if (!(FILTER_PROPERTY_VALUES as readonly string[]).includes(property)) return null
  if (!(FILTER_OPERATOR_VALUES as readonly string[]).includes(operator)) return null
  // statusCategory is a view's scope, never a chip.
  if (property === "statusCategory") return null
  const parts = values === "" ? [] : values.split(",")
  if (!parts.every((v) => VALUE_PATTERN.test(v))) return null
  const filter = { property, operator, values: [...new Set(parts)] } as ListFilter
  const check = normalizeViewSpec({ ...SYSTEM_VIEWS.tasks.all.spec, filters: [filter] })
  return "error" in check ? null : filter
}

/** The URL's chips: undefined when absent (use the view's), `[]` for an explicit empty set. */
export function parseChips(params: URLSearchParams): ListFilter[] | undefined {
  const raw = params.getAll(FILTER_PARAM)
  if (raw.length === 0) return undefined
  return raw.flatMap((r) => (r === "" ? [] : parseFilter(r) ?? []))
}

function sameFilters(a: readonly ListFilter[], b: readonly ListFilter[]): boolean {
  return a.length === b.length && a.every((f, i) => serializeFilter(f) === serializeFilter(b[i]))
}

// ─── Display ⇄ URL ───────────────────────────────────────────────────────────

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
  const layout = oneOf(LAYOUT_VALUES, params.get(OVERRIDE_PARAMS.layout))
  if (layout) out.layout = layout
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
  const chips = parseChips(params)
  if (chips) out.chips = chips
  return out
}

/** The draft the URL describes on top of `view`. */
export function draftFromSearchParams(params: URLSearchParams, view: ViewOption): ViewDraft {
  const { chips, ...display } = parseOverrides(params)
  return { display: { ...displayOf(view.spec), ...display }, chips: chips ?? baseChipsOf(view) }
}

function sameProperties(a: readonly ViewProperty[], b: readonly ViewProperty[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i])
}

/** The parts of `draft` that differ from `view` (what the URL must carry). */
export function diffOverrides(draft: ViewDraft, view: ViewOption): ViewOverrides {
  const base = view.spec
  const d = draft.display
  const out: ViewOverrides = {}
  if (d.layout !== base.layout) out.layout = d.layout
  if (d.groupBy !== base.groupBy) out.groupBy = d.groupBy
  if (d.orderBy !== base.orderBy) out.orderBy = d.orderBy
  if (!sameProperties(d.visibleProperties, base.visibleProperties)) out.visibleProperties = d.visibleProperties
  if (d.showSubtasks !== base.showSubtasks) out.showSubtasks = d.showSubtasks
  if (d.showEmptyGroups !== base.showEmptyGroups) out.showEmptyGroups = d.showEmptyGroups
  if (!sameFilters(draft.chips, baseChipsOf(view))) out.chips = draft.chips
  return out
}

/** True when the URL's state differs from the selected view (the "modified" dot). */
export function isDraftModified(draft: ViewDraft, view: ViewOption): boolean {
  return Object.keys(diffOverrides(draft, view)).length > 0
}

/**
 * Writes `draft` into a copy of `current` as overrides on `view`, plus the
 * view key (omitted for the surface default). Params the view state does
 * not own are preserved.
 */
export function writeViewParams(
  current: URLSearchParams,
  surface: ListViewSurface,
  view: ViewOption,
  draft: ViewDraft,
): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  const param = viewParamFor(surface)
  if (view.key === defaultViewKeyFor(surface)) next.delete(param)
  else next.set(param, view.key)

  for (const param of Object.values(OVERRIDE_PARAMS)) next.delete(param)
  next.delete(FILTER_PARAM)
  const o = diffOverrides(draft, view)
  if (o.layout) next.set(OVERRIDE_PARAMS.layout, o.layout)
  if (o.groupBy) next.set(OVERRIDE_PARAMS.groupBy, o.groupBy)
  if (o.orderBy) next.set(OVERRIDE_PARAMS.orderBy, o.orderBy)
  if (o.visibleProperties) next.set(OVERRIDE_PARAMS.visibleProperties, o.visibleProperties.join(","))
  if (o.showSubtasks !== undefined) next.set(OVERRIDE_PARAMS.showSubtasks, o.showSubtasks ? "1" : "0")
  if (o.showEmptyGroups !== undefined) next.set(OVERRIDE_PARAMS.showEmptyGroups, o.showEmptyGroups ? "1" : "0")
  if (o.chips) {
    if (o.chips.length === 0) next.append(FILTER_PARAM, "")
    for (const f of o.chips) next.append(FILTER_PARAM, serializeFilter(f))
  }
  return next
}

/** The URL for opening `viewKey` untouched: its key, no overrides, filters or search. */
export function paramsForView(current: URLSearchParams, surface: ListViewSurface, viewKey: string): URLSearchParams {
  const next = new URLSearchParams(current.toString())
  for (const param of Object.values(OVERRIDE_PARAMS)) next.delete(param)
  next.delete(FILTER_PARAM)
  next.delete(SEARCH_PARAM)
  const param = viewParamFor(surface)
  if (viewKey === defaultViewKeyFor(surface)) next.delete(param)
  else next.set(param, viewKey)
  return next
}

/** `?a=b` (or "") for router navigation. */
export function toSearchString(params: URLSearchParams): string {
  const str = params.toString()
  return str ? `?${str}` : ""
}

// ─── listView args ───────────────────────────────────────────────────────────

/**
 * The `listView` arguments for a draft. The server only needs the scope and
 * `showSubtasks`; display settings are pinned to one constant so changing
 * grouping or columns never re-subscribes. An untouched system view goes by
 * key so the server applies the org default itself.
 */
export function listViewQueryFor(
  view: ViewOption,
  draft: ViewDraft,
): { viewKey: string } | { spec: TaskViewSpec } {
  if (isSystemView(view) && draft.display.showSubtasks === view.spec.showSubtasks) return { viewKey: view.key }
  return {
    spec: { ...SYSTEM_VIEWS.tasks.all.spec, filters: scopeFiltersOf(view), showSubtasks: draft.display.showSubtasks },
  }
}

// Pure date-string + lane math for the Planner grid. No React, no Convex,
// no Date-object timezone traps — all arithmetic runs on UTC epoch derived
// from "YYYY-MM-DD" strings (same approach as convex/workday.ts eachDate).

export type DateSpan = {
  startDate: string // "YYYY-MM-DD" inclusive
  endDate: string   // "YYYY-MM-DD" inclusive
}

function utcMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Signed day count from `a` to `b` (positive when `b` is later). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / 86_400_000)
}

/** Add `n` calendar days to a YYYY-MM-DD string. */
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(utcMs(ymd) + n * 86_400_000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Inclusive list of YYYY-MM-DD dates from start to end. */
export function eachDateYmd(startDate: string, endDate: string): string[] {
  const out: string[] = []
  const n = dayDiff(startDate, endDate)
  for (let i = 0; i <= n; i++) out.push(addDaysYmd(startDate, i))
  return out
}

/** True for Saturday or Sunday. */
export function isWeekendYmd(ymd: string): boolean {
  const w = new Date(utcMs(ymd)).getUTCDay()
  return w === 0 || w === 6
}

/** True for Monday (used to emphasize week boundaries in the month zoom). */
export function isMondayYmd(ymd: string): boolean {
  return new Date(utcMs(ymd)).getUTCDay() === 1
}

/** Monday of the ISO week containing the given day. */
export function mondayOfYmd(ymd: string): string {
  const dow = new Date(utcMs(ymd)).getUTCDay() // 0 = Sunday
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow)
}

/** Local-time Date for a YMD string (for date-fns formatting helpers). */
export function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d)
}

/** Inclusive span of a segment in days (a single-day segment = 1). */
export function spanDays(seg: DateSpan): number {
  return dayDiff(seg.startDate, seg.endDate) + 1
}

// ── Panel filters (slice 7) — panel-scoped, never touch the timeline ─────────

export type PlannerDueFilter = "all" | "overdue" | "week" | "none"

/** Scheduling state as a regular filter property (owner ruling: no separate
 *  tabs). "unscheduled" is the to-plan inbox: nothing planned and not done. */
export type PlannerScheduleFilter = "all" | "unscheduled" | "planned"

export type PlannerPanelFilters = {
  projectIds: string[]
  clientIds: string[]
  /** Category ids, plus the literal "none" for uncategorized tasks. */
  categoryKeys: string[]
  due: PlannerDueFilter
  schedule: PlannerScheduleFilter
}

export const EMPTY_PANEL_FILTERS: PlannerPanelFilters = {
  projectIds: [],
  clientIds: [],
  categoryKeys: [],
  due: "all",
  schedule: "all",
}

export function anyPanelFilterActive(f: PlannerPanelFilters): boolean {
  return (
    f.projectIds.length > 0 ||
    f.clientIds.length > 0 ||
    f.categoryKeys.length > 0 ||
    f.due !== "all" ||
    f.schedule !== "all"
  )
}

export type PanelFilterableTask = {
  projectId: string | null
  clientId: string | null
  categoryId: string | null
  dueDate: string | null
  segmentCount: number
  statusType: string
}

/** The to-plan inbox definition: nothing planned yet and not done. */
export function isUnscheduledTask(t: {
  segmentCount: number
  statusType: string
}): boolean {
  return t.segmentCount === 0 && t.statusType !== "done"
}

/**
 * Does a panel task pass the chip filters? Empty selections pass everything;
 * within one chip, options OR together; chips AND together (mockup rules).
 * Due boundaries (mockup): overdue = due < today; week = today ≤ due < today+7.
 * `todayYmd` is the org-timezone today so every viewer agrees on "overdue".
 */
export function passesPanelFilters(
  t: PanelFilterableTask,
  f: PlannerPanelFilters,
  todayYmd: string,
): boolean {
  if (f.projectIds.length > 0 && (!t.projectId || !f.projectIds.includes(t.projectId))) {
    return false
  }
  if (f.clientIds.length > 0 && (!t.clientId || !f.clientIds.includes(t.clientId))) {
    return false
  }
  if (f.categoryKeys.length > 0 && !f.categoryKeys.includes(t.categoryId ?? "none")) {
    return false
  }
  if (f.schedule === "unscheduled" && !isUnscheduledTask(t)) return false
  if (f.schedule === "planned" && t.segmentCount === 0) return false
  switch (f.due) {
    case "overdue":
      return t.dueDate !== null && t.dueDate < todayYmd
    case "week":
      return (
        t.dueDate !== null &&
        t.dueDate >= todayYmd &&
        t.dueDate < addDaysYmd(todayYmd, 7)
      )
    case "none":
      return t.dueDate === null
    default:
      return true
  }
}

export type PanelFacetTask = PanelFilterableTask & {
  projectName: string | null
  clientName: string | null
  categoryName: string | null
  categoryColor: string | null
}

export type PanelFacetOption = {
  key: string
  label: string
  /** Tasks that would match if this option were the only one selected. */
  count: number
  /** Category color key (category facet only). */
  color?: string | null
}

export type PanelFacets = {
  project: PanelFacetOption[]
  client: PanelFacetOption[]
  category: PanelFacetOption[]
  /** Match counts per due option (the option list itself is static). */
  due: Record<Exclude<PlannerDueFilter, "all">, number>
  /** Match counts per schedule option (static option list too). */
  schedule: Record<Exclude<PlannerScheduleFilter, "all">, number>
}

/**
 * Faceted (cross-filtered) option lists for the panel's filter menus: each
 * property's options come from the tasks that pass all OTHER active chips,
 * with match counts — selecting a client narrows the project menu to that
 * client's projects. Options with zero matches are dropped unless already
 * selected (they must stay untickable). The free-text search deliberately
 * does NOT feed facets.
 */
export function derivePanelFacets(
  tasks: PanelFacetTask[],
  filters: PlannerPanelFilters,
  todayYmd: string,
): PanelFacets {
  const without = (patch: Partial<PlannerPanelFilters>) =>
    tasks.filter((t) => passesPanelFilters(t, { ...filters, ...patch }, todayYmd))

  const collect = (
    pool: PanelFacetTask[],
    selected: string[],
    key: (t: PanelFacetTask) => string | null,
    label: (t: PanelFacetTask) => string | null,
    color?: (t: PanelFacetTask) => string | null,
  ): PanelFacetOption[] => {
    const options = new Map<string, PanelFacetOption>()
    for (const t of pool) {
      const k = key(t)
      if (!k) continue
      const existing = options.get(k)
      if (existing) existing.count += 1
      else {
        options.set(k, {
          key: k,
          label: label(t) ?? "",
          count: 1,
          ...(color ? { color: color(t) } : {}),
        })
      }
    }
    // A selected option must stay listed even at zero matches; resolve its
    // label from the unfiltered task list.
    for (const k of selected) {
      if (options.has(k)) continue
      const source = tasks.find((t) => key(t) === k)
      options.set(k, {
        key: k,
        label: source ? label(source) ?? "" : "",
        count: 0,
        ...(color ? { color: source ? color(source) : null } : {}),
      })
    }
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label))
  }

  const projectPool = without({ projectIds: [] })
  const clientPool = without({ clientIds: [] })
  const categoryPool = without({ categoryKeys: [] })
  const duePool = without({ due: "all" })
  const schedulePool = without({ schedule: "all" })

  const category = collect(
    categoryPool,
    filters.categoryKeys.filter((k) => k !== "none"),
    (t) => t.categoryId,
    (t) => t.categoryName,
    (t) => t.categoryColor,
  )
  const noCategoryCount = categoryPool.filter((t) => !t.categoryId).length
  if (noCategoryCount > 0 || filters.categoryKeys.includes("none")) {
    category.push({
      key: "none",
      label: "No category",
      count: noCategoryCount,
      color: null,
    })
  }

  const dueCount = (due: PlannerDueFilter) =>
    duePool.filter((t) => passesPanelFilters(t, { ...EMPTY_PANEL_FILTERS, due }, todayYmd)).length

  return {
    project: collect(
      projectPool,
      filters.projectIds,
      (t) => t.projectId,
      (t) => t.projectName,
    ),
    client: collect(
      clientPool,
      filters.clientIds,
      (t) => t.clientId,
      (t) => t.clientName,
    ),
    category,
    due: {
      overdue: dueCount("overdue"),
      week: dueCount("week"),
      none: dueCount("none"),
    },
    schedule: {
      unscheduled: schedulePool.filter(isUnscheduledTask).length,
      planned: schedulePool.filter((t) => t.segmentCount > 0).length,
    },
  }
}

/** One workday of estimate, in minutes (estimate is stored in minutes). */
const WORKDAY_MINUTES = 480

/**
 * Default span (days) when a task is dropped from the panel: the remaining
 * estimate in 8h workdays minus what is already planned, minimum one day.
 * A pure UX default — the user resizes after dropping (PRD).
 */
export function defaultSpanDays(
  estimateMinutes: number | null | undefined,
  plannedDays: number,
): number {
  if (!estimateMinutes || estimateMinutes <= 0) return 1
  return Math.max(1, Math.ceil(estimateMinutes / WORKDAY_MINUTES) - plannedDays)
}

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/**
 * Compact inclusive range label for a plan segment (drawer "Plan" section):
 * "Jul 6", "Jul 6 – 8", "Jul 30 – Aug 2", "Dec 29, 2026 – Jan 2, 2027".
 * Years appear only when the range crosses a year boundary — the plan is a
 * near-term surface and the grid header already carries the year context.
 */
export function formatSegmentRange(startYmd: string, endYmd: string): string {
  const [sy, sm, sd] = startYmd.split("-").map(Number)
  const [ey, em, ed] = endYmd.split("-").map(Number)
  const start = `${SHORT_MONTHS[sm - 1]} ${sd}`
  if (startYmd === endYmd) return start
  if (sy !== ey) {
    return `${start}, ${sy} – ${SHORT_MONTHS[em - 1]} ${ed}, ${ey}`
  }
  if (sm !== em) return `${start} – ${SHORT_MONTHS[em - 1]} ${ed}`
  return `${start} – ${ed}`
}

export type ClampedSpan = {
  /** 0-based day index of the bar's first visible day within the range. */
  startIdx: number
  /** 0-based day index of the bar's last visible day (inclusive). */
  endIdx: number
  /** True when the segment continues before the visible range. */
  clippedStart: boolean
  /** True when the segment continues after the visible range. */
  clippedEnd: boolean
}

/**
 * Clamp a segment to the visible range. Returns null when the segment does
 * not overlap the range at all.
 */
export function clampToRange(
  seg: DateSpan,
  rangeStart: string,
  rangeEnd: string,
): ClampedSpan | null {
  if (seg.endDate < rangeStart || seg.startDate > rangeEnd) return null
  const startIdx = Math.max(0, dayDiff(rangeStart, seg.startDate))
  const endIdx = Math.min(
    dayDiff(rangeStart, rangeEnd),
    dayDiff(rangeStart, seg.endDate),
  )
  return {
    startIdx,
    endIdx,
    clippedStart: seg.startDate < rangeStart,
    clippedEnd: seg.endDate > rangeEnd,
  }
}

/**
 * Greedy first-fit lane packing over visible day indexes. Placement runs
 * in `order` priority (ascending — the Planner passes segment creation
 * time), NOT in date order: a bar's lane must never depend on its own
 * dates, so resizing/moving one bar can never reshuffle its neighbours
 * (owner ruling 2026-07-06, "stable lanes"). Older bars win collisions;
 * the edited/new bar slides below. Ties fall back to input position for
 * determinism. May use one more lane than date-ordered packing would —
 * accepted trade for stability. The returned array is aligned to the
 * input; two bars share a lane only when their day ranges don't touch
 * (inclusive indexes).
 */
export function assignLanes(
  spans: Array<{ startIdx: number; endIdx: number; order: number }>,
): number[] {
  const byPriority = spans
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.order - b.s.order || a.i - b.i)

  // Stability makes lanes non-contiguous intervals: track every occupied
  // range per lane instead of a single running end.
  const laneSpans: Array<Array<{ startIdx: number; endIdx: number }>> = []
  const lanes = new Array<number>(spans.length)
  const collides = (
    lane: Array<{ startIdx: number; endIdx: number }>,
    s: { startIdx: number; endIdx: number },
  ) => lane.some((o) => o.startIdx <= s.endIdx && s.startIdx <= o.endIdx)

  for (const { s, i } of byPriority) {
    let lane = 0
    while (laneSpans[lane] && collides(laneSpans[lane], s)) lane++
    if (!laneSpans[lane]) laneSpans[lane] = []
    laneSpans[lane].push({ startIdx: s.startIdx, endIdx: s.endIdx })
    lanes[i] = lane
  }
  return lanes
}

// Capacity math (planned vs available workdays per row) was removed on
// 2026-07-05 by owner decision: overbooking is a deliberate call the planner
// makes visually — the app doesn't need to comment on it.

/**
 * Pure placement reducer for the drag engine's move mode: the pointer's day
 * index and the grab offset (which day of the bar was grabbed) propose a
 * snapped placement, clamped so the whole span stays inside the loaded
 * window. All inputs/outputs are day indexes relative to the window start.
 */
export function proposeMovePlacement(args: {
  pointerDayIdx: number
  grabOffsetDays: number
  spanDays: number
  dayCount: number
}): { startIdx: number; endIdx: number } {
  const maxStart = Math.max(0, args.dayCount - args.spanDays)
  const raw = args.pointerDayIdx - args.grabOffsetDays
  const startIdx = Math.max(0, Math.min(raw, maxStart))
  return { startIdx, endIdx: startIdx + args.spanDays - 1 }
}

/**
 * Manual restacking: the numeric `laneOrder` a dragged segment should get
 * so it lands at `pointerLane` among the target-row bars its proposed span
 * collides with. Bars above the pointer lane must stay above (smaller
 * order), bars at/below it must end up below (larger order). Returns null
 * when no write is needed: the span collides with nothing (packing decides
 * alone), or `currentOrder` already satisfies the constraints (dropping a
 * bar back where it was must not touch the database). Midpoints between
 * ms-scale orders — float precision is a non-issue at MVP depth.
 */
export function proposeLaneOrder(args: {
  segments: Array<DateSpan & { _id: string; laneOrder: number }>
  /** The dragged segment's id — excluded from packing (it is the ghost). */
  excludeId: string | null
  /** Proposed placement of the dragged segment. */
  target: DateSpan
  /** Visual lane index under the pointer within the target row. */
  pointerLane: number
  rangeStart: string
  rangeEnd: string
  /** The dragged segment's current effective order (same-row moves). */
  currentOrder?: number
}): number | null {
  const rowBars = args.segments.flatMap((seg) => {
    if (seg._id === args.excludeId) return []
    const clamped = clampToRange(seg, args.rangeStart, args.rangeEnd)
    return clamped ? [{ seg, ...clamped }] : []
  })
  const lanes = assignLanes(
    rowBars.map((b) => ({
      startIdx: b.startIdx,
      endIdx: b.endIdx,
      order: b.seg.laneOrder,
    })),
  )

  const targetClamped = clampToRange(args.target, args.rangeStart, args.rangeEnd)
  if (!targetClamped) return null

  const above: number[] = []
  const below: number[] = []
  rowBars.forEach((b, i) => {
    const overlaps =
      b.startIdx <= targetClamped.endIdx && targetClamped.startIdx <= b.endIdx
    if (!overlaps) return
    if (lanes[i] < args.pointerLane) above.push(b.seg.laneOrder)
    else below.push(b.seg.laneOrder)
  })
  if (above.length === 0 && below.length === 0) return null

  const aboveMax = above.length > 0 ? Math.max(...above) : null
  const belowMin = below.length > 0 ? Math.min(...below) : null
  if (
    args.currentOrder !== undefined &&
    (aboveMax === null || aboveMax < args.currentOrder) &&
    (belowMin === null || args.currentOrder < belowMin)
  ) {
    return null
  }
  if (aboveMax === null) return belowMin! - 1
  if (belowMin === null) return aboveMax + 1
  return (aboveMax + belowMin) / 2
}

/**
 * Pure placement reducer for the drag engine's draw-to-create mode: the
 * pressed day anchors one end, the pointer day the other — dragging in
 * either direction sketches the same snapped range (mockup rule). Minimum
 * one day falls out of the min/max. Day indexes relative to the window
 * start; the pointer index is already clamped by the caller.
 */
export function proposeDrawPlacement(args: {
  anchorIdx: number
  pointerDayIdx: number
}): { startIdx: number; endIdx: number } {
  return {
    startIdx: Math.min(args.anchorIdx, args.pointerDayIdx),
    endIdx: Math.max(args.anchorIdx, args.pointerDayIdx),
  }
}

/**
 * Pure placement reducer for the drag engine's resize modes: one edge
 * follows the pointer day-by-day while the opposite edge stays anchored.
 * Minimum one day falls out of the min/max — the moving edge can never
 * cross the anchor. `anchorIdx` may lie outside the loaded window (clipped
 * segment); the pointer index is already clamped by the caller.
 */
export function proposeResizePlacement(args: {
  pointerDayIdx: number
  /** Day index of the FIXED edge (end for resize-start, start for resize-end). */
  anchorIdx: number
  edge: "start" | "end"
}): { startIdx: number; endIdx: number } {
  if (args.edge === "start") {
    return {
      startIdx: Math.min(args.pointerDayIdx, args.anchorIdx),
      endIdx: args.anchorIdx,
    }
  }
  return {
    startIdx: args.anchorIdx,
    endIdx: Math.max(args.pointerDayIdx, args.anchorIdx),
  }
}

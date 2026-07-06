import { describe, it, expect } from "vitest"
import {
  addDaysYmd,
  assignLanes,
  clampToRange,
  dayDiff,
  defaultSpanDays,
  eachDateYmd,
  formatSegmentRange,
  isMondayYmd,
  isWeekendYmd,
  mondayOfYmd,
  derivePanelFacets,
  passesPanelFilters,
  proposeMovePlacement,
  proposeDrawPlacement,
  proposeLaneOrder,
  proposeResizePlacement,
  spanDays,
  EMPTY_PANEL_FILTERS,
  type PanelFacetTask,
  type PlannerPanelFilters,
} from "./planner"

// 2026-07-06 is a Monday; 2026-07-11/12 are Sat/Sun.
const MON = "2026-07-06"
const SUN = "2026-07-19" // end of the 2-week range starting MON

describe("date-string math", () => {
  it("dayDiff is signed and inclusive-friendly", () => {
    expect(dayDiff(MON, "2026-07-08")).toBe(2)
    expect(dayDiff("2026-07-08", MON)).toBe(-2)
    expect(dayDiff(MON, MON)).toBe(0)
  })

  it("addDaysYmd crosses month and year boundaries", () => {
    expect(addDaysYmd("2026-07-31", 1)).toBe("2026-08-01")
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28")
  })

  it("eachDateYmd yields the inclusive range", () => {
    expect(eachDateYmd(MON, "2026-07-08")).toEqual([
      "2026-07-06", "2026-07-07", "2026-07-08",
    ])
  })

  it("isWeekendYmd flags Sat/Sun only", () => {
    expect(isWeekendYmd("2026-07-11")).toBe(true) // Sat
    expect(isWeekendYmd("2026-07-12")).toBe(true) // Sun
    expect(isWeekendYmd(MON)).toBe(false)
    expect(isWeekendYmd("2026-07-10")).toBe(false) // Fri
  })

  it("spanDays counts inclusively", () => {
    expect(spanDays({ startDate: MON, endDate: MON })).toBe(1)
    expect(spanDays({ startDate: MON, endDate: "2026-07-09" })).toBe(4)
  })

  it("isMondayYmd flags Mondays only", () => {
    expect(isMondayYmd(MON)).toBe(true)
    expect(isMondayYmd("2026-07-07")).toBe(false)
    expect(isMondayYmd("2026-07-12")).toBe(false)
  })

  it("mondayOfYmd returns the ISO week's Monday, incl. for Sundays", () => {
    expect(mondayOfYmd(MON)).toBe(MON)
    expect(mondayOfYmd("2026-07-08")).toBe(MON) // Wednesday
    expect(mondayOfYmd("2026-07-12")).toBe(MON) // Sunday belongs to the Mon-start week
    expect(mondayOfYmd("2026-07-13")).toBe("2026-07-13")
  })
})

describe("passesPanelFilters", () => {
  const TODAY = "2026-07-06"
  const task = {
    projectId: "p1",
    clientId: "c1",
    categoryId: "cat1",
    dueDate: null as string | null,
    segmentCount: 0,
    statusType: "backlog",
  }
  const f = (over: Partial<PlannerPanelFilters>): PlannerPanelFilters => ({
    ...EMPTY_PANEL_FILTERS,
    ...over,
  })

  it("passes everything when no filter is active", () => {
    expect(passesPanelFilters(task, EMPTY_PANEL_FILTERS, TODAY)).toBe(true)
  })

  it("ORs within a chip, ANDs across chips", () => {
    expect(
      passesPanelFilters(task, f({ projectIds: ["p1", "p2"] }), TODAY),
    ).toBe(true)
    expect(passesPanelFilters(task, f({ projectIds: ["p2"] }), TODAY)).toBe(false)
    // Project matches but client doesn't → chips AND together.
    expect(
      passesPanelFilters(
        task,
        f({ projectIds: ["p1"], clientIds: ["c9"] }),
        TODAY,
      ),
    ).toBe(false)
  })

  it("treats missing project/client as non-matching when that chip is active", () => {
    const orphan = { ...task, projectId: null, clientId: null }
    expect(passesPanelFilters(orphan, f({ projectIds: ["p1"] }), TODAY)).toBe(false)
    expect(passesPanelFilters(orphan, f({ clientIds: ["c1"] }), TODAY)).toBe(false)
  })

  it('maps uncategorized tasks to the "none" category key', () => {
    const bare = { ...task, categoryId: null }
    expect(passesPanelFilters(bare, f({ categoryKeys: ["none"] }), TODAY)).toBe(true)
    expect(passesPanelFilters(bare, f({ categoryKeys: ["cat1"] }), TODAY)).toBe(false)
    expect(passesPanelFilters(task, f({ categoryKeys: ["none"] }), TODAY)).toBe(false)
  })

  it("due=overdue means strictly before today", () => {
    expect(
      passesPanelFilters({ ...task, dueDate: "2026-07-05" }, f({ due: "overdue" }), TODAY),
    ).toBe(true)
    expect(
      passesPanelFilters({ ...task, dueDate: TODAY }, f({ due: "overdue" }), TODAY),
    ).toBe(false)
    expect(passesPanelFilters(task, f({ due: "overdue" }), TODAY)).toBe(false)
  })

  it("due=week is a 7-day window including today, excluding today+7", () => {
    const week = f({ due: "week" })
    expect(passesPanelFilters({ ...task, dueDate: TODAY }, week, TODAY)).toBe(true)
    expect(
      passesPanelFilters({ ...task, dueDate: "2026-07-12" }, week, TODAY),
    ).toBe(true)
    expect(
      passesPanelFilters({ ...task, dueDate: "2026-07-13" }, week, TODAY),
    ).toBe(false)
    expect(
      passesPanelFilters({ ...task, dueDate: "2026-07-05" }, week, TODAY),
    ).toBe(false)
  })

  it("due=none matches only tasks without a deadline", () => {
    expect(passesPanelFilters(task, f({ due: "none" }), TODAY)).toBe(true)
    expect(
      passesPanelFilters({ ...task, dueDate: TODAY }, f({ due: "none" }), TODAY),
    ).toBe(false)
  })

  it("schedule=unscheduled is the inbox: nothing planned AND not done", () => {
    const unsched = f({ schedule: "unscheduled" })
    expect(passesPanelFilters(task, unsched, TODAY)).toBe(true)
    expect(
      passesPanelFilters({ ...task, segmentCount: 2 }, unsched, TODAY),
    ).toBe(false)
    expect(
      passesPanelFilters({ ...task, statusType: "done" }, unsched, TODAY),
    ).toBe(false)
  })

  it("schedule=planned matches tasks with at least one sitting", () => {
    const planned = f({ schedule: "planned" })
    expect(passesPanelFilters(task, planned, TODAY)).toBe(false)
    expect(
      passesPanelFilters({ ...task, segmentCount: 1 }, planned, TODAY),
    ).toBe(true)
  })
})

describe("derivePanelFacets", () => {
  const TODAY = "2026-07-06"
  const mk = (over: Partial<PanelFacetTask>): PanelFacetTask => ({
    projectId: null, projectName: null,
    clientId: null, clientName: null,
    categoryId: null, categoryName: null, categoryColor: null,
    dueDate: null,
    segmentCount: 0, statusType: "backlog",
    ...over,
  })
  // Two clients: Arlow (2 tasks, 2 projects), Pragmatico (1 task, 1 project).
  const TASKS: PanelFacetTask[] = [
    mk({ projectId: "pWeb", projectName: "Website", clientId: "cArlow", clientName: "Arlow", categoryId: "cat1", categoryName: "Design", categoryColor: "violet", dueDate: "2026-07-01" }),
    mk({ projectId: "pBrand", projectName: "Brand", clientId: "cArlow", clientName: "Arlow" }),
    mk({ projectId: "pShop", projectName: "Shop", clientId: "cPrag", clientName: "Pragmatico", dueDate: "2026-07-08" }),
  ]
  const f = (over: Partial<PlannerPanelFilters>): PlannerPanelFilters => ({
    ...EMPTY_PANEL_FILTERS,
    ...over,
  })

  it("cross-filters: selecting a client narrows the project options to that client", () => {
    const facets = derivePanelFacets(TASKS, f({ clientIds: ["cArlow"] }), TODAY)
    expect(facets.project.map((o) => o.key).sort()).toEqual(["pBrand", "pWeb"])
    // …while the client menu itself ignores its OWN selection (both clients listed).
    expect(facets.client.map((o) => o.key).sort()).toEqual(["cArlow", "cPrag"])
  })

  it("counts matches per option against the other filters", () => {
    const facets = derivePanelFacets(TASKS, EMPTY_PANEL_FILTERS, TODAY)
    expect(facets.client.find((o) => o.key === "cArlow")?.count).toBe(2)
    expect(facets.client.find((o) => o.key === "cPrag")?.count).toBe(1)
    expect(facets.due).toEqual({ overdue: 1, week: 1, none: 1 })
    expect(facets.schedule).toEqual({ unscheduled: 3, planned: 0 })
  })

  it("schedule facet cross-filters like any other property", () => {
    const withPlanned = [
      ...TASKS,
      mk({ clientId: "cArlow", clientName: "Arlow", segmentCount: 2 }),
    ]
    const facets = derivePanelFacets(
      withPlanned,
      { ...EMPTY_PANEL_FILTERS, clientIds: ["cArlow"] },
      TODAY,
    )
    // Only Arlow tasks feed the schedule counts: 2 unscheduled + 1 planned.
    expect(facets.schedule).toEqual({ unscheduled: 2, planned: 1 })
  })

  it("keeps a selected option listed even when other filters zero it out", () => {
    // Client Pragmatico + project Website (an Arlow project) → Website has
    // 0 matches under Pragmatico but must stay listed for unticking.
    const facets = derivePanelFacets(
      TASKS,
      f({ clientIds: ["cPrag"], projectIds: ["pWeb"] }),
      TODAY,
    )
    const website = facets.project.find((o) => o.key === "pWeb")
    expect(website).toMatchObject({ label: "Website", count: 0 })
    // Unselected zero-match options are dropped.
    expect(facets.project.map((o) => o.key).sort()).toEqual(["pShop", "pWeb"])
  })

  it('appends "No category" with its count only when relevant', () => {
    const facets = derivePanelFacets(TASKS, EMPTY_PANEL_FILTERS, TODAY)
    expect(facets.category.map((o) => o.key)).toEqual(["cat1", "none"])
    expect(facets.category.find((o) => o.key === "none")?.count).toBe(2)

    const onlyCategorized = derivePanelFacets([TASKS[0]], EMPTY_PANEL_FILTERS, TODAY)
    expect(onlyCategorized.category.map((o) => o.key)).toEqual(["cat1"])
  })
})

describe("defaultSpanDays", () => {
  it("defaults to 1 day when no estimate is set", () => {
    expect(defaultSpanDays(null, 0)).toBe(1)
    expect(defaultSpanDays(undefined, 3)).toBe(1)
    expect(defaultSpanDays(0, 0)).toBe(1)
  })

  it("converts the estimate to 8h workdays, rounding up", () => {
    expect(defaultSpanDays(480, 0)).toBe(1)  // exactly one day
    expect(defaultSpanDays(481, 0)).toBe(2)  // just over → round up
    expect(defaultSpanDays(1440, 0)).toBe(3) // 24h = 3 workdays
  })

  it("subtracts already-planned days, clamped to minimum 1", () => {
    expect(defaultSpanDays(1440, 2)).toBe(1) // 3d estimate, 2d planned
    expect(defaultSpanDays(1440, 3)).toBe(1) // fully planned → still 1
    expect(defaultSpanDays(1440, 9)).toBe(1) // over-planned → still 1
  })
})

describe("formatSegmentRange", () => {
  it("collapses a single day", () => {
    expect(formatSegmentRange("2026-07-06", "2026-07-06")).toBe("Jul 6")
  })

  it("shortens a same-month range", () => {
    expect(formatSegmentRange("2026-07-06", "2026-07-08")).toBe("Jul 6 – 8")
  })

  it("names both months across a month boundary", () => {
    expect(formatSegmentRange("2026-07-30", "2026-08-02")).toBe("Jul 30 – Aug 2")
  })

  it("adds years only across a year boundary", () => {
    expect(formatSegmentRange("2026-12-29", "2027-01-02")).toBe(
      "Dec 29, 2026 – Jan 2, 2027",
    )
  })
})

describe("clampToRange", () => {
  it("returns null when fully outside the range", () => {
    expect(clampToRange({ startDate: "2026-06-29", endDate: "2026-07-05" }, MON, SUN)).toBeNull()
    expect(clampToRange({ startDate: "2026-07-20", endDate: "2026-07-22" }, MON, SUN)).toBeNull()
  })

  it("passes through a fully inside segment unclipped", () => {
    expect(clampToRange({ startDate: "2026-07-07", endDate: "2026-07-09" }, MON, SUN)).toEqual({
      startIdx: 1, endIdx: 3, clippedStart: false, clippedEnd: false,
    })
  })

  it("clips at the range start edge", () => {
    expect(clampToRange({ startDate: "2026-07-03", endDate: "2026-07-07" }, MON, SUN)).toEqual({
      startIdx: 0, endIdx: 1, clippedStart: true, clippedEnd: false,
    })
  })

  it("clips at the range end edge", () => {
    expect(clampToRange({ startDate: "2026-07-18", endDate: "2026-07-25" }, MON, SUN)).toEqual({
      startIdx: 12, endIdx: 13, clippedStart: false, clippedEnd: true,
    })
  })

  it("clips both edges when the segment spans the whole range", () => {
    expect(clampToRange({ startDate: "2026-06-29", endDate: "2026-08-01" }, MON, SUN)).toEqual({
      startIdx: 0, endIdx: 13, clippedStart: true, clippedEnd: true,
    })
  })
})

describe("proposeMovePlacement", () => {
  it("keeps the grabbed day under the pointer", () => {
    // 3-day bar grabbed on its middle day, pointer over day 10
    expect(
      proposeMovePlacement({ pointerDayIdx: 10, grabOffsetDays: 1, spanDays: 3, dayCount: 84 }),
    ).toEqual({ startIdx: 9, endIdx: 11 })
  })

  it("clamps at the left window edge", () => {
    expect(
      proposeMovePlacement({ pointerDayIdx: 0, grabOffsetDays: 2, spanDays: 3, dayCount: 84 }),
    ).toEqual({ startIdx: 0, endIdx: 2 })
  })

  it("clamps at the right window edge", () => {
    expect(
      proposeMovePlacement({ pointerDayIdx: 83, grabOffsetDays: 0, spanDays: 4, dayCount: 84 }),
    ).toEqual({ startIdx: 80, endIdx: 83 })
  })

  it("handles a span wider than the window by pinning to the start", () => {
    expect(
      proposeMovePlacement({ pointerDayIdx: 3, grabOffsetDays: 1, spanDays: 10, dayCount: 7 }),
    ).toEqual({ startIdx: 0, endIdx: 9 })
  })
})

describe("proposeResizePlacement", () => {
  it("drags the end edge while the start stays anchored", () => {
    expect(
      proposeResizePlacement({ pointerDayIdx: 7, anchorIdx: 3, edge: "end" }),
    ).toEqual({ startIdx: 3, endIdx: 7 })
  })

  it("drags the start edge while the end stays anchored", () => {
    expect(
      proposeResizePlacement({ pointerDayIdx: 1, anchorIdx: 5, edge: "start" }),
    ).toEqual({ startIdx: 1, endIdx: 5 })
  })

  it("never lets the moving edge cross the anchor (minimum one day)", () => {
    // End edge dragged left past the start → clamps to a 1-day bar.
    expect(
      proposeResizePlacement({ pointerDayIdx: 0, anchorIdx: 4, edge: "end" }),
    ).toEqual({ startIdx: 4, endIdx: 4 })
    // Start edge dragged right past the end → same.
    expect(
      proposeResizePlacement({ pointerDayIdx: 9, anchorIdx: 4, edge: "start" }),
    ).toEqual({ startIdx: 4, endIdx: 4 })
  })

  it("supports anchors outside the loaded window (clipped segments)", () => {
    // Segment starts before the window (anchorIdx negative): dragging the
    // end edge keeps the off-screen start.
    expect(
      proposeResizePlacement({ pointerDayIdx: 2, anchorIdx: -3, edge: "end" }),
    ).toEqual({ startIdx: -3, endIdx: 2 })
  })
})

describe("proposeLaneOrder", () => {
  const RANGE = { rangeStart: "2026-07-06", rangeEnd: "2026-07-19" }
  // a (order 100) and b (order 200) collide → lanes 0 and 1.
  const segments = [
    { _id: "a", startDate: "2026-07-06", endDate: "2026-07-09", laneOrder: 100 },
    { _id: "b", startDate: "2026-07-07", endDate: "2026-07-10", laneOrder: 200 },
  ]
  const target = { startDate: "2026-07-08", endDate: "2026-07-09" }

  it("drops above everything → order below the smallest", () => {
    expect(
      proposeLaneOrder({ segments, excludeId: "c", target, pointerLane: 0, ...RANGE }),
    ).toBe(99)
  })

  it("drops between two bars → midpoint of their orders", () => {
    expect(
      proposeLaneOrder({ segments, excludeId: "c", target, pointerLane: 1, ...RANGE }),
    ).toBe(150)
  })

  it("drops below everything → order above the largest", () => {
    expect(
      proposeLaneOrder({ segments, excludeId: "c", target, pointerLane: 5, ...RANGE }),
    ).toBe(201)
  })

  it("returns null when the span collides with nothing", () => {
    expect(
      proposeLaneOrder({
        segments,
        excludeId: "c",
        target: { startDate: "2026-07-15", endDate: "2026-07-16" },
        pointerLane: 0,
        ...RANGE,
      }),
    ).toBeNull()
  })

  it("returns null when the current order already fits (drop in place)", () => {
    expect(
      proposeLaneOrder({
        segments,
        excludeId: "c",
        target,
        pointerLane: 1,
        currentOrder: 150,
        ...RANGE,
      }),
    ).toBeNull()
  })

  it("ignores the dragged segment itself", () => {
    const withSelf = [
      ...segments,
      { _id: "c", startDate: "2026-07-08", endDate: "2026-07-09", laneOrder: 300 },
    ]
    expect(
      proposeLaneOrder({
        segments: withSelf,
        excludeId: "c",
        target,
        pointerLane: 1,
        ...RANGE,
      }),
    ).toBe(150)
  })
})

describe("proposeDrawPlacement", () => {
  it("sketches forward from the anchor", () => {
    expect(
      proposeDrawPlacement({ anchorIdx: 2, pointerDayIdx: 5 }),
    ).toEqual({ startIdx: 2, endIdx: 5 })
  })

  it("sketches backward when dragged left of the anchor", () => {
    expect(
      proposeDrawPlacement({ anchorIdx: 5, pointerDayIdx: 2 }),
    ).toEqual({ startIdx: 2, endIdx: 5 })
  })

  it("stays a single day when the pointer holds the anchor day", () => {
    expect(
      proposeDrawPlacement({ anchorIdx: 3, pointerDayIdx: 3 }),
    ).toEqual({ startIdx: 3, endIdx: 3 })
  })
})

describe("assignLanes", () => {
  it("keeps non-overlapping bars in a single lane", () => {
    expect(
      assignLanes([
        { startIdx: 0, endIdx: 1, order: 1 },
        { startIdx: 2, endIdx: 3, order: 2 },
        { startIdx: 4, endIdx: 6, order: 3 },
      ]),
    ).toEqual([0, 0, 0])
  })

  it("stacks an overlap chain into increasing lanes by priority", () => {
    // a: 0-3, b: 1-4 (overlaps a), c: 2-5 (overlaps both)
    expect(
      assignLanes([
        { startIdx: 0, endIdx: 3, order: 1 },
        { startIdx: 1, endIdx: 4, order: 2 },
        { startIdx: 2, endIdx: 5, order: 3 },
      ]),
    ).toEqual([0, 1, 2])
  })

  it("reuses a freed lane after a chain breaks", () => {
    // a: 0-1, b: 0-5, c: 3-4 → c fits back into lane 0 after a ends
    expect(
      assignLanes([
        { startIdx: 0, endIdx: 1, order: 1 },
        { startIdx: 0, endIdx: 5, order: 2 },
        { startIdx: 3, endIdx: 4, order: 3 },
      ]),
    ).toEqual([0, 1, 0])
  })

  it("treats touching inclusive indexes as overlapping (no shared day)", () => {
    // b starts on the same day a ends → must NOT share a lane
    expect(
      assignLanes([
        { startIdx: 0, endIdx: 2, order: 1 },
        { startIdx: 2, endIdx: 4, order: 2 },
      ]),
    ).toEqual([0, 1])
  })

  it("is input-order independent: priority decides, lanes align to input", () => {
    expect(
      assignLanes([
        { startIdx: 2, endIdx: 5, order: 3 },
        { startIdx: 0, endIdx: 3, order: 1 },
        { startIdx: 1, endIdx: 4, order: 2 },
      ]),
    ).toEqual([2, 0, 1])
  })

  it("packs by priority, NOT by dates: an older later-starting bar stays on top", () => {
    // b starts earlier but is newer → the old date-ordered packing would
    // put b on lane 0; stable packing keeps a (older) on top.
    expect(
      assignLanes([
        { startIdx: 3, endIdx: 6, order: 1 },
        { startIdx: 0, endIdx: 4, order: 2 },
      ]),
    ).toEqual([0, 1])
  })

  it("resizing a bar never moves its neighbours (the owner's jumping-lanes bug)", () => {
    // Before: a (old) 0-1 and b (new) 3-4 both fit lane 0.
    const before = assignLanes([
      { startIdx: 0, endIdx: 1, order: 1 },
      { startIdx: 3, endIdx: 4, order: 2 },
    ])
    expect(before).toEqual([0, 0])
    // b is stretched left over a: a MUST keep lane 0, b slides below.
    // Under date-ordered packing the lane split would depend on b's new
    // dates — here it only depends on age, so a never moves.
    const after = assignLanes([
      { startIdx: 0, endIdx: 1, order: 1 },
      { startIdx: 1, endIdx: 4, order: 2 },
    ])
    expect(after).toEqual([0, 1])
  })

  it("a freed slot is reclaimed even between older bars (interval tracking)", () => {
    // Lane 0 holds two disjoint old bars (0-1 and 5-6); a newer middle bar
    // 2-4 must slot INTO lane 0's gap — the single-running-end packing of
    // the date-ordered version couldn't represent this.
    expect(
      assignLanes([
        { startIdx: 5, endIdx: 6, order: 1 },
        { startIdx: 0, endIdx: 1, order: 2 },
        { startIdx: 2, endIdx: 4, order: 3 },
      ]),
    ).toEqual([0, 0, 0])
  })
})

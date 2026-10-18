import { describe, expect, it } from "vitest"
import { DEFAULT_VISIBLE_PROPERTIES, SYSTEM_VIEWS, type TaskViewSpec } from "@/convex/tasks/model"
import {
  baseChipsOf,
  buildViewOptions,
  diffOverrides,
  displayOf,
  draftFromSearchParams,
  draftSpec,
  isDraftModified,
  listViewQueryFor,
  paramsForView,
  parseChips,
  parseFilter,
  parseOverrides,
  resolveView,
  scopeFiltersOf,
  serializeFilter,
  systemViewOptions,
  TODAY_SPEC,
  TODAY_VIEW_KEY,
  toSearchString,
  viewParamFor,
  writeViewParams,
  type ViewDraft,
  type ViewOption,
} from "@/components/task-view/view-state"

const params = (s: string) => new URLSearchParams(s)

const SAVED_SPEC: TaskViewSpec = {
  ...SYSTEM_VIEWS.tasks.active.spec,
  layout: "board",
  groupBy: "project",
  filters: [
    { property: "statusCategory", operator: "is", values: ["unstarted", "started"] },
    { property: "label", operator: "is", values: ["l1"] },
  ],
}

const options = buildViewOptions(
  "tasks",
  [
    { _id: "v_ws", name: "Design team", scope: "workspace", canEdit: false, spec: SAVED_SPEC },
    { _id: "v_me", name: "Waiting", scope: "personal", canEdit: true, spec: SAVED_SPEC },
  ],
  { active: { ...SYSTEM_VIEWS.tasks.active.spec, orderBy: "dueDate" } },
)
const view = (key: string) => options.find((o) => o.key === key)!
const active = view("active")
const saved = view("v_me")
const draftOf = (v: ViewOption): ViewDraft => ({ display: displayOf(v.spec), chips: baseChipsOf(v) })

describe("views", () => {
  it("lists the system views first, then saved views in server order", () => {
    expect(systemViewOptions("tasks").map((o) => [o.key, o.name, o.scope])).toEqual([
      ["active", "Active", "system"],
      ["backlog", "Backlog", "system"],
      ["all", "All tasks", "system"],
    ])
    expect(options.map((o) => o.key)).toEqual(["active", "backlog", "all", "v_ws", "v_me"])
  })

  it("applies the org's default to a system view", () => {
    expect(active.spec.orderBy).toBe("dueDate")
    expect(view("backlog").spec).toBe(SYSTEM_VIEWS.tasks.backlog.spec)
  })

  it("resolves ?view= to a system or saved view, else the surface default", () => {
    expect(resolveView(options, "tasks", null).key).toBe("active")
    expect(resolveView(options, "tasks", "nope").key).toBe("active")
    expect(resolveView(options, "tasks", "toString").key).toBe("active")
    expect(resolveView(options, "tasks", "backlog").key).toBe("backlog")
    expect(resolveView(options, "tasks", "v_me")).toBe(saved)
  })

  it("splits a view's filters into server scope and editable chips", () => {
    expect(scopeFiltersOf(active)).toEqual(SYSTEM_VIEWS.tasks.active.spec.filters)
    expect(baseChipsOf(active)).toEqual([])
    expect(scopeFiltersOf(saved)).toEqual([SAVED_SPEC.filters[0]])
    expect(baseChipsOf(saved)).toEqual([SAVED_SPEC.filters[1]])
  })
})

describe("My Tasks tabs (?tab=)", () => {
  const myOptions = buildViewOptions("myTasks", [
    { _id: "v_mine", name: "Mine", scope: "personal", canEdit: true, spec: SYSTEM_VIEWS.myTasks.assigned.spec },
  ])

  it("lists Today | Assigned | Created, then saved views", () => {
    expect(myOptions.map((o) => [o.key, o.name])).toEqual([
      ["today", "Today", ],
      ["assigned", "Assigned"],
      ["created", "Created"],
      ["v_mine", "Mine"],
    ])
    expect(myOptions[0]).toMatchObject({ plan: true, spec: TODAY_SPEC })
    // Assigned hides the Assignee column (§11.2).
    expect(myOptions[1].spec.visibleProperties).not.toContain("assignee")
  })

  it("opens on Today and names the tab with ?tab=", () => {
    expect(viewParamFor("myTasks")).toBe("tab")
    expect(viewParamFor("tasks")).toBe("view")
    expect(resolveView(myOptions, "myTasks", null).key).toBe(TODAY_VIEW_KEY)
    expect(resolveView(myOptions, "myTasks", "created").key).toBe("created")
    expect(resolveView(myOptions, "myTasks", "v_mine").key).toBe("v_mine")
    // ?view= means nothing on My Tasks.
    expect(resolveView(myOptions, "myTasks", "bogus").key).toBe(TODAY_VIEW_KEY)
  })

  it("writes ?tab= (omitted for Today) and keeps other params", () => {
    const assigned = myOptions[1]
    const toAssigned = paramsForView(params("detail=t1"), "myTasks", "assigned")
    expect(toAssigned.get("tab")).toBe("assigned")
    expect(toAssigned.get("view")).toBeNull()
    expect(toAssigned.get("detail")).toBe("t1")
    expect(paramsForView(params("tab=assigned"), "myTasks", TODAY_VIEW_KEY).get("tab")).toBeNull()
    const draft: ViewDraft = { display: { ...displayOf(assigned.spec), groupBy: "priority" }, chips: [] }
    const written = writeViewParams(params(""), "myTasks", assigned, draft)
    expect(toSearchString(written)).toBe("?tab=assigned&group=priority")
  })

  it("Today's only override is its visible properties", () => {
    const today = myOptions[0]
    const draft = draftFromSearchParams(params("props=priority,title,due"), today)
    expect(draft.display.visibleProperties).toEqual(["priority", "title", "due"])
    expect(isDraftModified(draft, today)).toBe(true)
    expect(toSearchString(writeViewParams(params(""), "myTasks", today, draft))).toBe("?props=priority%2Ctitle%2Cdue")
  })
})

describe("filters ⇄ URL", () => {
  it("round-trips a filter", () => {
    const f = { property: "assignee" as const, operator: "is" as const, values: ["me", "none", "u2"] }
    expect(serializeFilter(f)).toBe("assignee.is.me,none,u2")
    expect(parseFilter(serializeFilter(f))).toEqual(f)
    expect(parseFilter("dueDate.before.2026-10-21")).toEqual({ property: "dueDate", operator: "before", values: ["2026-10-21"] })
    expect(parseFilter("dueDate.isEmpty.")).toEqual({ property: "dueDate", operator: "isEmpty", values: [] })
  })

  it("drops invalid filters and the statusCategory scope", () => {
    for (const raw of ["planet.is.x", "status.near.x", "status.is.", "priority.is.9", "status.is.a b", "status.before.x", "statusCategory.is.backlog", "a.b.c.d"]) {
      expect(parseFilter(raw)).toBeNull()
    }
  })

  it("absent → undefined (the view's chips), empty → explicit no chips", () => {
    expect(parseChips(params("view=v_me"))).toBeUndefined()
    expect(parseChips(params("filter="))).toEqual([])
    expect(parseChips(params("filter=status.is.s1&filter=bogus&filter=priority.is.1,2"))).toEqual([
      { property: "status", operator: "is", values: ["s1"] },
      { property: "priority", operator: "is", values: ["1", "2"] },
    ])
  })
})

describe("URL → draft", () => {
  it("is the view itself when the URL carries no overrides", () => {
    expect(draftFromSearchParams(params("detail=abc"), active)).toEqual(draftOf(active))
    expect(draftFromSearchParams(params(""), saved).chips).toEqual(baseChipsOf(saved))
  })

  it("applies valid display overrides incl. layout", () => {
    const draft = draftFromSearchParams(params("layout=board&group=assignee&order=title&props=title,due&sub=1&empty=1"), active)
    expect(draft.display).toEqual({
      ...displayOf(active.spec),
      layout: "board",
      groupBy: "assignee",
      orderBy: "title",
      visibleProperties: ["title", "due"],
      showSubtasks: true,
      showEmptyGroups: true,
    })
  })

  it("ignores invalid values", () => {
    expect(parseOverrides(params("layout=grid&group=planet&order=random&sub=yes&empty=2&props=bogus,,"))).toEqual({})
    expect(parseOverrides(params("props=due,bogus,due,time")).visibleProperties).toEqual(["due", "time"])
    expect(parseOverrides(params("props=")).visibleProperties).toEqual([])
  })

  it("URL chips replace a saved view's chips; the scope stays", () => {
    const draft = draftFromSearchParams(params("view=v_me&filter=priority.is.1"), saved)
    expect(draft.chips).toEqual([{ property: "priority", operator: "is", values: ["1"] }])
    expect(draftSpec(saved, draft).filters).toEqual([
      SAVED_SPEC.filters[0],
      { property: "priority", operator: "is", values: ["1"] },
    ])
    expect(draftFromSearchParams(params("view=v_me&filter="), saved).chips).toEqual([])
  })
})

describe("draft → URL", () => {
  it("writes only what differs from the view", () => {
    const all = view("all")
    const next = writeViewParams(params(""), "tasks", all, { ...draftOf(all), display: { ...draftOf(all).display, orderBy: "title" } })
    expect(next.toString()).toBe("view=all&order=title")
  })

  it("omits the default view and clears overrides equal to it", () => {
    const next = writeViewParams(params("view=active&order=title&group=priority&filter=status.is.s1"), "tasks", active, draftOf(active))
    expect(toSearchString(next)).toBe("")
  })

  it("preserves params it does not own", () => {
    const backlog = view("backlog")
    const next = writeViewParams(params("detail=t1&order=title&q=logo"), "tasks", backlog, draftOf(backlog))
    expect(next.get("detail")).toBe("t1")
    expect(next.get("q")).toBe("logo")
    expect(next.get("view")).toBe("backlog")
    expect(next.has("order")).toBe(false)
  })

  it("writes chips as repeated filter params, and an explicit empty set for a saved view", () => {
    const chips = [
      { property: "status" as const, operator: "is" as const, values: ["s1", "s2"] },
      { property: "newComments" as const, operator: "is" as const, values: ["true"] },
    ]
    const url = writeViewParams(params(""), "tasks", active, { ...draftOf(active), chips })
    expect(url.getAll("filter")).toEqual(["status.is.s1,s2", "newComments.is.true"])
    expect(writeViewParams(params(""), "tasks", saved, { ...draftOf(saved), chips: [] }).getAll("filter")).toEqual([""])
  })

  it("round-trips: draft → URL → draft", () => {
    const backlog = view("backlog")
    const draft: ViewDraft = {
      display: {
        ...displayOf(backlog.spec),
        layout: "board",
        groupBy: "none",
        orderBy: "createdAt",
        visibleProperties: ["priority", "title", "labels"],
        showSubtasks: true,
        showEmptyGroups: true,
      },
      chips: [{ property: "assignee", operator: "is", values: ["none"] }],
    }
    const url = writeViewParams(params(""), "tasks", backlog, draft)
    expect(draftFromSearchParams(url, resolveView(options, "tasks", url.get("view")))).toEqual(draft)
  })

  it("opening a view drops overrides, filters and search", () => {
    const next = paramsForView(params("view=all&order=title&filter=status.is.s1&q=x&detail=t1"), "tasks", "v_me")
    expect(next.toString()).toBe("view=v_me&detail=t1")
    expect(paramsForView(params("view=all"), "tasks", "active").toString()).toBe("")
  })
})

describe("modified detection", () => {
  it("is unmodified for the plain view", () => {
    expect(isDraftModified(draftOf(active), active)).toBe(false)
    expect(isDraftModified(draftOf(saved), saved)).toBe(false)
    expect(
      isDraftModified({ ...draftOf(active), display: { ...draftOf(active).display, visibleProperties: [...DEFAULT_VISIBLE_PROPERTIES] } }, active),
    ).toBe(false)
  })

  it("is modified when a display field, the layout or the chips differ", () => {
    const d = draftOf(active)
    expect(isDraftModified({ ...d, display: { ...d.display, orderBy: "title" } }, active)).toBe(true)
    expect(isDraftModified({ ...d, display: { ...d.display, layout: "board" } }, active)).toBe(true)
    expect(isDraftModified({ ...d, chips: [{ property: "priority", operator: "is", values: ["1"] }] }, active)).toBe(true)
    expect(isDraftModified({ ...draftOf(saved), chips: [] }, saved)).toBe(true)
    expect(diffOverrides({ ...d, display: { ...d.display, showSubtasks: true } }, active)).toEqual({ showSubtasks: true })
  })

  it("matches what the URL carries", () => {
    expect(isDraftModified(draftFromSearchParams(params("order=title"), active), active)).toBe(true)
    expect(isDraftModified(draftFromSearchParams(params("order=dueDate"), active), active)).toBe(false)
  })
})

describe("listView args", () => {
  it("an untouched system view goes by key (the server applies the org default)", () => {
    expect(listViewQueryFor(active, draftOf(active))).toEqual({ viewKey: "active" })
    // Display changes and chips are client-side: the subscription stays the same.
    const d = { ...draftOf(active), display: { ...draftOf(active).display, groupBy: "none" as const }, chips: [{ property: "priority" as const, operator: "is" as const, values: ["1"] }] }
    expect(listViewQueryFor(active, d)).toEqual({ viewKey: "active" })
  })

  it("sends the scope + showSubtasks only, with display fields pinned", () => {
    const d = { ...draftOf(active), display: { ...draftOf(active).display, showSubtasks: true } }
    expect(listViewQueryFor(active, d)).toEqual({
      spec: { ...SYSTEM_VIEWS.tasks.all.spec, filters: active.spec.filters, showSubtasks: true },
    })
    const a = listViewQueryFor(saved, draftOf(saved))
    const b = listViewQueryFor(saved, { ...draftOf(saved), display: { ...draftOf(saved).display, groupBy: "status" }, chips: [] })
    expect(a).toEqual(b)
    expect(a).toEqual({ spec: { ...SYSTEM_VIEWS.tasks.all.spec, filters: [SAVED_SPEC.filters[0]], showSubtasks: false } })
  })
})

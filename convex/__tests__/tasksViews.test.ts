// @vitest-environment edge-runtime
//
// Tasks refactor slice 4 (docs/prd-tasks-refactor.md §4.4, U5, U6, §5.3):
// saved views + "Set default for everyone" in convex/tasks/views.ts.
//   access matrix   admin / member / member (other) / other-org × personal vs workspace
//   spec validation names, filters, normalisation
//   defaults        viewDefaults override a system view in `views.list` and `listView`
//   pure helper     convex/tasks/filters.ts (shared by read.ts and the client)

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  DEFAULT_STATUS_SEED,
  MAX_VIEWS_PER_SCOPE,
  NONE_FILTER_VALUE,
  SYSTEM_VIEWS,
  normalizeViewSpec,
  type TaskViewSpec,
} from "../tasks/model";
import { matchesFilter, type FilterSubject } from "../tasks/filters";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_views";
const OTHER = "org_views_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "member" | "member2" | "otherOrg";

const IDENTITY: Record<Caller, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  member: { subject: "clerk_mia", orgId: ORG, orgRole: "org:member" },
  member2: { subject: "clerk_max", orgId: ORG, orgRole: "org:member" },
  otherOrg: { subject: "clerk_other", orgId: OTHER, orgRole: "org:admin" },
};

const as = (t: T, caller: Caller) => t.withIdentity(IDENTITY[caller]);

const SPEC: TaskViewSpec = {
  ...SYSTEM_VIEWS.tasks.all.spec,
  filters: [{ property: "priority", operator: "is", values: ["1", "2"] }],
  groupBy: "project",
};

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const users: Record<string, Id<"users">> = {};
    for (const [key, name] of [["admin", "Admin"], ["mia", "Mia"], ["max", "Max"], ["other", "Other"]] as const) {
      users[key] = await ctx.db.insert("users", {
        name, externalId: `clerk_${key}`, email: `${key}@x.test`, createdAt: now, updatedAt: now,
      });
    }
    for (const [key, role, orgId] of [
      ["admin", "admin", ORG], ["mia", "member", ORG], ["max", "member", ORG], ["other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId: `clerk_${key}`, userId: users[key], role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, users.admin], [OTHER, users.other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        brandName: orgId, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color,
          category: s.category, position: `a${i}`, isDefault: s.isDefault,
          createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    return users;
  });
}

const create = (t: T, caller: Caller, scope: "personal" | "workspace", name = "View", spec = SPEC) =>
  as(t, caller).mutation(api.tasks.views.create, { surface: "tasks", name, scope, spec });

const names = (views: ReadonlyArray<{ name: string }>) => views.map((v) => v.name);

// ─── Access matrix ───────────────────────────────────────────────────────────

describe("taskViews access matrix", () => {
  it("personal views: everyone creates their own; only the owner sees and changes them", async () => {
    const t = createT();
    await setup(t);
    const mine = await create(t, "member", "personal", "Mia's view");
    const adminView = await create(t, "admin", "personal", "Admin's view");

    expect(names((await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views)).toEqual(["Mia's view"]);
    expect(names((await as(t, "member2").query(api.tasks.views.list, { surface: "tasks" })).views)).toEqual([]);
    // An admin does not see (or reach) another user's personal view.
    expect(names((await as(t, "admin").query(api.tasks.views.list, { surface: "tasks" })).views)).toEqual(["Admin's view"]);
    expect(names((await as(t, "otherOrg").query(api.tasks.views.list, { surface: "tasks" })).views)).toEqual([]);

    const listed = (await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views[0];
    expect(listed).toMatchObject({ scope: "personal", canEdit: true, spec: SPEC });

    // Owner: rename, re-save, delete.
    await as(t, "member").mutation(api.tasks.views.update, { viewId: mine, name: "Renamed", spec: { ...SPEC, layout: "board" } });
    const after = (await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views[0];
    expect(after).toMatchObject({ name: "Renamed", spec: { layout: "board" } });

    for (const caller of ["member2", "admin", "otherOrg"] as const) {
      await expect(as(t, caller).mutation(api.tasks.views.update, { viewId: mine, name: "Hijack" })).rejects.toThrow(/not found/i);
      await expect(as(t, caller).mutation(api.tasks.views.remove, { viewId: mine })).rejects.toThrow(/not found/i);
      await expect(as(t, caller).mutation(api.tasks.views.reorder, { viewId: mine, afterId: null })).rejects.toThrow(/not found/i);
    }
    await expect(as(t, "member").mutation(api.tasks.views.remove, { viewId: adminView })).rejects.toThrow(/not found/i);

    await as(t, "member").mutation(api.tasks.views.remove, { viewId: mine });
    expect((await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views).toEqual([]);
  });

  it("workspace views: admins create and change them; members see them read-only; other orgs see nothing", async () => {
    const t = createT();
    await setup(t);
    await expect(create(t, "member", "workspace")).rejects.toThrow(/admins/i);
    const ws = await create(t, "admin", "workspace", "Design team");

    const memberList = await as(t, "member").query(api.tasks.views.list, { surface: "tasks" });
    expect(memberList.views).toMatchObject([{ name: "Design team", scope: "workspace", canEdit: false }]);
    expect(memberList.canManageWorkspace).toBe(false);
    const adminList = await as(t, "admin").query(api.tasks.views.list, { surface: "tasks" });
    expect(adminList.views).toMatchObject([{ name: "Design team", canEdit: true }]);
    expect(adminList.canManageWorkspace).toBe(true);
    expect((await as(t, "otherOrg").query(api.tasks.views.list, { surface: "tasks" })).views).toEqual([]);

    await expect(as(t, "member").mutation(api.tasks.views.update, { viewId: ws, name: "x" })).rejects.toThrow(/admins/i);
    await expect(as(t, "member").mutation(api.tasks.views.remove, { viewId: ws })).rejects.toThrow(/admins/i);
    await expect(as(t, "otherOrg").mutation(api.tasks.views.update, { viewId: ws, name: "x" })).rejects.toThrow(/not found/i);
    await expect(as(t, "otherOrg").mutation(api.tasks.views.remove, { viewId: ws })).rejects.toThrow(/not found/i);

    await as(t, "admin").mutation(api.tasks.views.update, { viewId: ws, name: "Design" });
    await as(t, "admin").mutation(api.tasks.views.remove, { viewId: ws });
    expect((await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views).toEqual([]);
  });

  it("lists workspace views first, then personal; views are per surface", async () => {
    const t = createT();
    await setup(t);
    await create(t, "admin", "personal", "Mine");
    await create(t, "admin", "workspace", "Shared");
    await as(t, "admin").mutation(api.tasks.views.create, { surface: "myTasks", name: "Elsewhere", scope: "personal", spec: SPEC });
    const list = await as(t, "admin").query(api.tasks.views.list, { surface: "tasks" });
    expect(list.views.map((v) => [v.name, v.scope])).toEqual([["Shared", "workspace"], ["Mine", "personal"]]);
  });

  it("reorder moves a view inside its scope only", async () => {
    const t = createT();
    await setup(t);
    const a = await create(t, "member", "personal", "A");
    const b = await create(t, "member", "personal", "B");
    const c = await create(t, "member", "personal", "C");
    const order = async () => names((await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views);
    expect(await order()).toEqual(["A", "B", "C"]);

    await as(t, "member").mutation(api.tasks.views.reorder, { viewId: c, afterId: null });
    expect(await order()).toEqual(["C", "A", "B"]);
    await as(t, "member").mutation(api.tasks.views.reorder, { viewId: c, afterId: a });
    expect(await order()).toEqual(["A", "C", "B"]);
    await as(t, "member").mutation(api.tasks.views.reorder, { viewId: a, afterId: b });
    expect(await order()).toEqual(["C", "B", "A"]);

    const ws = await create(t, "admin", "workspace", "WS");
    await expect(as(t, "admin").mutation(api.tasks.views.reorder, { viewId: ws, afterId: a })).rejects.toThrow(/not found|own group/i);
  });

  it("caps the views per scope", async () => {
    const t = createT();
    await setup(t);
    for (let i = 0; i < MAX_VIEWS_PER_SCOPE; i++) await create(t, "member", "personal", `V${i}`);
    await expect(create(t, "member", "personal", "One too many")).rejects.toThrow(/at most/i);
    // Another user's quota is separate.
    await create(t, "member2", "personal", "Fine");
  });

  it("rejects unauthenticated callers", async () => {
    const t = createT();
    await setup(t);
    await expect(t.query(api.tasks.views.list, { surface: "tasks" })).rejects.toThrow(/not authenticated/i);
    await expect(t.mutation(api.tasks.views.create, { surface: "tasks", name: "x", scope: "personal", spec: SPEC })).rejects.toThrow(/not authenticated/i);
  });
});

// ─── Spec validation ─────────────────────────────────────────────────────────

describe("view spec validation", () => {
  it("rejects bad names and filters on create and update", async () => {
    const t = createT();
    await setup(t);
    await expect(create(t, "member", "personal", "   ")).rejects.toThrow(/required/i);
    await expect(create(t, "member", "personal", "x".repeat(61))).rejects.toThrow(/60 characters/i);

    const bad: Array<[TaskViewSpec["filters"][number], RegExp]> = [
      [{ property: "status", operator: "before", values: ["2026-01-01"] }, /only applies to dates/],
      [{ property: "dueDate", operator: "before", values: ["tomorrow"] }, /YYYY-MM-DD/],
      [{ property: "priority", operator: "is", values: ["7"] }, /Unknown priority/],
      [{ property: "statusCategory", operator: "is", values: ["doing"] }, /Unknown status category/],
      [{ property: "assignee", operator: "is", values: [] }, /needs a value/],
      [{ property: "label", operator: "isEmpty", values: ["x"] }, /takes no values/],
      [{ property: "newComments", operator: "is", values: ["true", "false"] }, /one value/],
      [{ property: "billable", operator: "is", values: ["yes"] }, /"true" or "false"/],
    ];
    for (const [filter, message] of bad) {
      await expect(create(t, "member", "personal", "V", { ...SPEC, filters: [filter] })).rejects.toThrow(message);
    }
    const tooMany = Array.from({ length: 21 }, () => ({ property: "priority" as const, operator: "is" as const, values: ["1"] }));
    await expect(create(t, "member", "personal", "V", { ...SPEC, filters: tooMany })).rejects.toThrow(/At most 20 filters/);

    const ok = await create(t, "member", "personal", "  Waiting   on clients ");
    await expect(
      as(t, "member").mutation(api.tasks.views.update, { viewId: ok, spec: { ...SPEC, filters: [bad[0][0]] } }),
    ).rejects.toThrow(/only applies to dates/);
    const [view] = (await as(t, "member").query(api.tasks.views.list, { surface: "tasks" })).views;
    expect(view.name).toBe("Waiting on clients");
  });

  it("normalises visible properties (dedupe, drop the derived status icon)", () => {
    const result = normalizeViewSpec({ ...SPEC, visibleProperties: ["title", "status", "statusIcon", "status", "due"] });
    expect(result).toEqual({ spec: { ...SPEC, visibleProperties: ["title", "status", "due"] } });
    expect(normalizeViewSpec({ ...SPEC, filters: [{ property: "dueDate", operator: "isEmpty", values: [] }] })).toHaveProperty("spec");
  });
});

// ─── Defaults ("Set default for everyone") ───────────────────────────────────

describe("viewDefaults", () => {
  it("admins set and reset a system view's display defaults; listView and views.list read them", async () => {
    const t = createT();
    await setup(t);
    const active = SYSTEM_VIEWS.tasks.active.spec;
    const custom: TaskViewSpec = {
      ...active,
      layout: "board",
      groupBy: "assignee",
      orderBy: "dueDate",
      // Filters on a system default are ignored: the system view keeps its own.
      filters: [{ property: "priority", operator: "is", values: ["1"] }],
    };

    await expect(
      as(t, "member").mutation(api.tasks.views.setDefault, { surface: "tasks", systemViewKey: "active", spec: custom }),
    ).rejects.toThrow(/admins/i);
    await expect(
      as(t, "admin").mutation(api.tasks.views.setDefault, { surface: "tasks", systemViewKey: "nope", spec: custom }),
    ).rejects.toThrow(/Unknown view/);

    await as(t, "admin").mutation(api.tasks.views.setDefault, { surface: "tasks", systemViewKey: "active", spec: custom });
    const expected = { ...custom, filters: active.filters };

    for (const caller of ["admin", "member"] as const) {
      const list = await as(t, caller).query(api.tasks.views.list, { surface: "tasks" });
      expect(list.defaults.active).toEqual(expected);
      expect(list.defaults.backlog).toEqual(SYSTEM_VIEWS.tasks.backlog.spec);
      expect(list.customizedDefaults).toEqual(["active"]);
      const view = await as(t, caller).query(api.tasks.queries.listView, { surface: "tasks", viewKey: "active" });
      expect(view.spec).toEqual(expected);
    }
    // The default view (no viewKey) resolves the same way.
    expect((await as(t, "member").query(api.tasks.queries.listView, { surface: "tasks" })).spec).toEqual(expected);
    // Another org is unaffected.
    expect((await as(t, "otherOrg").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "active" })).spec).toEqual(active);

    // Setting again updates in place.
    await as(t, "admin").mutation(api.tasks.views.setDefault, { surface: "tasks", systemViewKey: "active", spec: { ...custom, layout: "list" } });
    expect((await as(t, "admin").query(api.tasks.views.list, { surface: "tasks" })).defaults.active.layout).toBe("list");
    expect(await t.run((ctx) => ctx.db.query("viewDefaults").take(10))).toHaveLength(1);

    await expect(
      as(t, "member").mutation(api.tasks.views.resetDefault, { surface: "tasks", systemViewKey: "active" }),
    ).rejects.toThrow(/admins/i);
    await as(t, "admin").mutation(api.tasks.views.resetDefault, { surface: "tasks", systemViewKey: "active" });
    expect((await as(t, "member").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "active" })).spec).toEqual(active);
    expect((await as(t, "admin").query(api.tasks.views.list, { surface: "tasks" })).customizedDefaults).toEqual([]);
  });

  it("a default's showSubtasks reaches the loader", async () => {
    const t = createT();
    const users = await setup(t);
    const parent = await as(t, "admin").mutation(api.tasks.create, { title: "Parent", assigneeIds: [users.admin] });
    await as(t, "admin").mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Child", assigneeIds: [users.admin] });
    const titles = async () =>
      (await as(t, "admin").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all" })).rows.map((r) => r.title).sort();
    expect(await titles()).toEqual(["Parent"]);
    await as(t, "admin").mutation(api.tasks.views.setDefault, {
      surface: "tasks", systemViewKey: "all", spec: { ...SYSTEM_VIEWS.tasks.all.spec, showSubtasks: true },
    });
    expect(await titles()).toEqual(["Child", "Parent"]);
  });
});

// ─── Shared pure filter helper ───────────────────────────────────────────────

describe("filters.matchesFilter (shared client/server)", () => {
  const task: FilterSubject = {
    statusId: "s1", statusCategory: "started", priority: 2, assigneeIds: ["u1"], labelIds: [],
    projectId: "p1", clientId: null, workCategoryId: undefined, createdBy: "u2",
    startDate: null, dueDate: "2026-10-20", billable: true,
  };

  it("matches ids, `me` and `none`", () => {
    expect(matchesFilter(task, { property: "assignee", operator: "is", values: ["me"] }, "u1")).toBe(true);
    expect(matchesFilter(task, { property: "assignee", operator: "is", values: ["me"] }, "u9")).toBe(false);
    expect(matchesFilter(task, { property: "label", operator: "is", values: [NONE_FILTER_VALUE] }, "u1")).toBe(true);
    expect(matchesFilter(task, { property: "label", operator: "isNot", values: [NONE_FILTER_VALUE] }, "u1")).toBe(false);
    expect(matchesFilter(task, { property: "client", operator: "is", values: [NONE_FILTER_VALUE, "c1"] }, "u1")).toBe(true);
    expect(matchesFilter(task, { property: "project", operator: "is", values: [NONE_FILTER_VALUE] }, "u1")).toBe(false);
    expect(matchesFilter(task, { property: "priority", operator: "is", values: ["1", "2"] }, "u1")).toBe(true);
    expect(matchesFilter({ ...task, priority: undefined }, { property: "priority", operator: "is", values: ["0"] }, "u1")).toBe(true);
  });

  it("matches dates and the per-user new-comments facet", () => {
    expect(matchesFilter(task, { property: "dueDate", operator: "before", values: ["2026-10-21"] }, "u1")).toBe(true);
    expect(matchesFilter(task, { property: "startDate", operator: "isEmpty", values: [] }, "u1")).toBe(true);
    expect(matchesFilter(task, { property: "newComments", operator: "is", values: ["true"] }, "u1", 2)).toBe(true);
    expect(matchesFilter(task, { property: "newComments", operator: "is", values: ["true"] }, "u1", 0)).toBe(false);
    expect(matchesFilter(task, { property: "newComments", operator: "is", values: ["false"] }, "u1", 0)).toBe(true);
  });
});

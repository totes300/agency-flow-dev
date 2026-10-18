// @vitest-environment edge-runtime
//
// Tasks refactor slice 2 (docs/prd-tasks-refactor.md §5.4, §4.3, §8): the read
// path in convex/tasks/read.ts + queries.ts, workspaceRefs, taskUserState, and
// the old list queries as adapters.
//   T7   every loader is capped and reports `truncated` at cap + 1
//   §5.4 index selection per surface (pure plan + behaviour under load)
//   T1   access matrix over every new/changed public query: admin /
//        member-assigned / member-via-parent / member-unassigned / other org
//   T5   getByIdentifier resolves aliases
//   §4.3 taskUserState fan-out on comment / change, reset on open, recompute parity
//   adapter shape parity for the old queries the UI and agent tools read

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { DEFAULT_STATUS_SEED, SYSTEM_VIEWS, type TaskCategory } from "../tasks/model";
import {
  OPEN_ROW_CAP,
  loadAssignedTo,
  loadByCategories,
  loadCreatedBy,
  loadProjectTasks,
  loadRecentlyClosed,
  loadSubtasksOf,
  planListLoad,
} from "../tasks/read";
import { recomputeUserStates } from "../tasks/userState";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_read";
const OTHER = "org_read_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

/**
 * Callers. On the fixture's sub-task S: `assigned` (Alice) has an edge on S,
 * `viaParent` (Carol) has an edge on S's parent P only (§11.5), `unassigned`
 * (Bob) has neither, `otherOrg` is an admin of another org.
 */
type Caller = "admin" | "assigned" | "viaParent" | "unassigned" | "otherOrg";
const CALLERS: Caller[] = ["admin", "assigned", "viaParent", "unassigned", "otherOrg"];

const IDENTITY: Record<Caller, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  assigned: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
  viaParent: { subject: "clerk_carol", orgId: ORG, orgRole: "org:member" },
  unassigned: { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" },
  otherOrg: { subject: "clerk_other", orgId: OTHER, orgRole: "org:admin" },
};

const as = (t: T, caller: Caller) => t.withIdentity(IDENTITY[caller]);

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  bob: Id<"users">;
  carol: Id<"users">;
  other: Id<"users">;
  status: Record<string, Id<"statuses">>;
  arlo: Id<"projects">;
  prag: Id<"projects">;
  otherProject: Id<"projects">;
  design: Id<"workCategories">;
  /** Top-level, ARLO, assignee Carol. */
  P: Id<"tasks">;
  /** Sub-task of P, assignee Alice. */
  S: Id<"tasks">;
  /** Top-level, ARLO, assignee Alice. */
  A: Id<"tasks">;
  /** Top-level, PRAG, assignee Admin only. */
  U: Id<"tasks">;
  /** A task of the other org. */
  X: Id<"tasks">;
};

async function setup(t: T): Promise<Fixture> {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const carol = await mkUser("Carol", "clerk_carol");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [carol, "clerk_carol", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        brandName: orgId === ORG ? "Konverted Studio" : "Elsewhere",
        createdAt: now, updatedAt: now, createdBy,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, type: s.legacyType, sortOrder: i,
          category: s.category, position: `a${i}`, isDefault: s.isDefault,
          createdAt: now, updatedAt: now, createdBy,
        });
        if (orgId === ORG) status[s.name] = id;
      }
    }
    const mkClient = async (orgId: string, name: string, createdBy: Id<"users">) =>
      await ctx.db.insert("clients", { orgId, name, currency: "EUR", createdAt: now, updatedAt: now, createdBy });
    const mkProject = async (orgId: string, name: string, code: string, clientId: Id<"clients">, createdBy: Id<"users">) =>
      await ctx.db.insert("projects", {
        orgId, clientId, name, code, billingType: "retainer", monthlyFee: 5000, includedMinutesPerMonth: 600,
        createdAt: now, updatedAt: now, createdBy,
      });
    const arlo = await mkProject(ORG, "Arlow site", "ARLO", await mkClient(ORG, "Arlow", admin), admin);
    const prag = await mkProject(ORG, "Pragmatico app", "PRAG", await mkClient(ORG, "Pragmatico", admin), admin);
    const otherProject = await mkProject(OTHER, "Elsewhere", "ELSE", await mkClient(OTHER, "Else", other), other);
    const design = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    for (const userId of [admin, alice, bob, carol]) {
      await ctx.db.insert("userRates", { orgId: ORG, userId, currency: "EUR", costRate: 40, createdAt: now, updatedAt: now });
    }
    return { admin, alice, bob, carol, other, status, arlo, prag, otherProject, design };
  });

  const admin = as(t, "admin");
  const P = await admin.mutation(api.tasks.create, {
    title: "Parent P", projectId: base.arlo, assigneeIds: [base.carol], workCategoryId: base.design,
  });
  const S = await admin.mutation(api.tasks.createSubtask, { parentTaskId: P, title: "Sub S", assigneeIds: [base.alice] });
  const A = await admin.mutation(api.tasks.create, {
    title: "Alpha A", projectId: base.arlo, assigneeIds: [base.alice], statusId: base.status["In progress"],
  });
  const U = await admin.mutation(api.tasks.create, { title: "Unrelated U", projectId: base.prag, assigneeIds: [base.admin] });
  const X = await as(t, "otherOrg").mutation(api.tasks.create, { title: "Other org X", projectId: base.otherProject });
  return { ...base, P, S, A, U, X };
}

const ids = (rows: ReadonlyArray<{ _id: Id<"tasks"> }>) => rows.map((r) => r._id).sort();
const sorted = <V extends string>(xs: readonly V[]) => [...xs].sort();

/** Inserts `count` bare tasks of one category straight into the table (load fixtures only). */
async function bulkInsert(
  t: T,
  f: Fixture,
  count: number,
  fields: { category: TaskCategory; projectId?: Id<"projects">; completedAt?: (i: number) => number },
) {
  const statusId = {
    backlog: f.status.Inbox,
    unstarted: f.status["Next up"],
    started: f.status["In progress"],
    completed: f.status.Done,
    canceled: f.status.Canceled,
  }[fields.category];
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("tasks", {
        orgId: ORG, title: `Bulk ${fields.category} ${i}`, statusId, statusType: "backlog",
        statusCategory: fields.category, assigneeIds: [], billable: true,
        projectId: fields.projectId, sortKey: `z${String(i).padStart(5, "0")}`,
        completedAt: fields.completedAt?.(i),
        createdAt: now, updatedAt: now, createdBy: f.admin,
      });
    }
  });
}

// ─── T7: caps ────────────────────────────────────────────────────────────────

describe("T7: every loader is capped and reports truncation", () => {
  it("cap rows → not truncated; cap + 1 rows → truncated, cap returned", async () => {
    const t = createT();
    const f = await setup(t);
    await bulkInsert(t, f, 3, { category: "backlog", projectId: f.prag });
    await bulkInsert(t, f, 3, { category: "completed", completedAt: (i) => 1_000 + i });

    await t.run(async (ctx) => {
      // backlog: P? no — P is backlog (default) too; count what is there.
      const backlog = (await loadByCategories(ctx, ORG, ["backlog"], 1000)).tasks.length;
      const atCap = await loadByCategories(ctx, ORG, ["backlog"], backlog);
      expect(atCap).toMatchObject({ truncated: false });
      expect(atCap.tasks).toHaveLength(backlog);
      const over = await loadByCategories(ctx, ORG, ["backlog"], backlog - 1);
      expect(over.truncated).toBe(true);
      expect(over.tasks).toHaveLength(backlog - 1);

      // The shared cap spans categories.
      const multi = await loadByCategories(ctx, ORG, ["backlog", "started"], backlog);
      expect(multi.truncated).toBe(true);

      const closed = await loadRecentlyClosed(ctx, ORG, 2);
      expect(closed.truncated).toBe(true);
      expect(closed.tasks.map((x) => x.completedAt)).toEqual([1_002, 1_001]);
      expect((await loadRecentlyClosed(ctx, ORG, 3)).truncated).toBe(false);

      const project = await loadProjectTasks(ctx, ORG, f.prag, ["backlog"], 3);
      expect(project.truncated).toBe(true); // U + 3 bulk
      expect((await loadProjectTasks(ctx, ORG, f.prag, ["backlog"], 4)).truncated).toBe(false);

      expect((await loadAssignedTo(ctx, ORG, f.alice, 1)).truncated).toBe(true); // A + S
      expect((await loadAssignedTo(ctx, ORG, f.alice, 2)).truncated).toBe(false);

      const created = (await loadCreatedBy(ctx, ORG, f.admin, 1000)).tasks.length;
      expect((await loadCreatedBy(ctx, ORG, f.admin, created - 1)).truncated).toBe(true);
      expect((await loadCreatedBy(ctx, ORG, f.admin, created)).truncated).toBe(false);

      expect((await loadSubtasksOf(ctx, ORG, f.P, 0)).truncated).toBe(true);
      expect((await loadSubtasksOf(ctx, ORG, f.P, 1)).truncated).toBe(false);
    });
  });

  it(`listView: ${OPEN_ROW_CAP} + 1 open rows → truncated with ${OPEN_ROW_CAP} rows`, async () => {
    const t = createT();
    const f = await setup(t);
    await bulkInsert(t, f, OPEN_ROW_CAP + 1, { category: "unstarted" });
    const active = await as(t, "admin").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "active" });
    expect(active.truncated).toBe(true);
    expect(active.rows).toHaveLength(OPEN_ROW_CAP);
  });
});

// ─── §5.4: index selection ───────────────────────────────────────────────────

describe("§5.4 index selection", () => {
  const admin = { userId: "u_admin" as Id<"users">, isAdmin: true };
  const member = { userId: "u_member" as Id<"users">, isAdmin: false };

  it("plans the most selective index per surface", () => {
    const tasksActive = SYSTEM_VIEWS.tasks.active.spec.filters;
    expect(planListLoad({ auth: admin, filters: tasksActive })).toEqual({
      kind: "category", open: ["unstarted", "started"], closed: [],
    });
    expect(planListLoad({ auth: admin, filters: SYSTEM_VIEWS.tasks.all.spec.filters })).toEqual({
      kind: "category", open: ["backlog", "unstarted", "started"], closed: ["completed", "canceled"],
    });
    expect(planListLoad({ auth: admin, filters: tasksActive, projectId: "p1" as Id<"projects"> })).toEqual({
      kind: "project", projectId: "p1", categories: ["unstarted", "started"],
    });
    expect(planListLoad({ auth: admin, filters: SYSTEM_VIEWS.myTasks.assigned.spec.filters })).toEqual({
      kind: "assignee", userId: "u_admin",
    });
    expect(planListLoad({ auth: admin, filters: SYSTEM_VIEWS.myTasks.created.spec.filters })).toEqual({
      kind: "createdBy", userId: "u_admin",
    });
    expect(
      planListLoad({ auth: admin, filters: [{ property: "project", operator: "is", values: ["p2"] }] }),
    ).toMatchObject({ kind: "project", projectId: "p2" });
    // A member's visibility IS their edge set, whatever the surface.
    for (const filters of [tasksActive, SYSTEM_VIEWS.myTasks.created.spec.filters]) {
      expect(planListLoad({ auth: member, filters })).toEqual({ kind: "assignee", userId: "u_member" });
    }
    expect(planListLoad({ auth: member, filters: [], projectId: "p1" as Id<"projects"> })).toEqual({
      kind: "assignee", userId: "u_member",
    });
  });

  it("selective views stay complete when another index range is over the cap", async () => {
    const t = createT();
    const f = await setup(t);
    // > cap backlog rows in ARLO; none of them assigned or created by Alice.
    await bulkInsert(t, f, OPEN_ROW_CAP + 1, { category: "backlog", projectId: f.arlo });
    const adminQ = as(t, "admin");
    const view = (args: Parameters<typeof adminQ.query<typeof api.tasks.queries.listView>>[1]) =>
      adminQ.query(api.tasks.queries.listView, args);

    // Category index: Active never reads backlog.
    const active = await view({ surface: "tasks", viewKey: "active" });
    expect(active.truncated).toBe(false);
    expect(ids(active.rows)).toEqual(sorted([f.A]));
    // Edge index: admin's "Assigned".
    const assigned = await view({ surface: "myTasks", viewKey: "assigned" });
    expect(assigned.truncated).toBe(false);
    expect(ids(assigned.rows)).toEqual([f.U]);
    // Project index: PRAG is unaffected by ARLO's backlog.
    const prag = await view({ surface: "project", viewKey: "all", projectId: f.prag });
    expect(prag.truncated).toBe(false);
    expect(ids(prag.rows)).toEqual([f.U]);
    // ...while the ARLO backlog itself is truncated.
    const arlo = await view({ surface: "project", viewKey: "backlog", projectId: f.arlo });
    expect(arlo.truncated).toBe(true);
    // A member reads their edges only.
    const alice = await as(t, "assigned").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all" });
    expect(alice.truncated).toBe(false);
    expect(ids(alice.rows)).toEqual([f.A]);
  });

  it("closed rows: newest closed first, capped by closedLimit with hasMoreClosed", async () => {
    const t = createT();
    const f = await setup(t);
    await bulkInsert(t, f, 5, { category: "completed", completedAt: (i) => 10_000 + i });
    const adminQ = as(t, "admin");
    const page = await adminQ.query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all", closedLimit: 2 });
    const closed = page.rows.filter((r) => r.statusCategory === "completed");
    expect(closed.map((r) => r.completedAt)).toEqual([10_004, 10_003]);
    expect(page.hasMoreClosed).toBe(true);
    expect(page.truncated).toBe(false);
    const all = await adminQ.query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all", closedLimit: 10 });
    expect(all.rows.filter((r) => r.statusCategory === "completed")).toHaveLength(5);
    expect(all.hasMoreClosed).toBe(false);
  });

  it("spec filters are applied server-side; unknown views and foreign projects are rejected", async () => {
    const t = createT();
    const f = await setup(t);
    const adminQ = as(t, "admin");
    const spec = {
      ...SYSTEM_VIEWS.tasks.all.spec,
      showSubtasks: true,
      filters: [{ property: "client" as const, operator: "is" as const, values: [(await t.run(async (ctx) => (await ctx.db.get(f.arlo))!.clientId))] }],
    };
    const byClient = await adminQ.query(api.tasks.queries.listView, { surface: "tasks", spec });
    expect(ids(byClient.rows)).toEqual(sorted([f.P, f.S, f.A]));
    await expect(adminQ.query(api.tasks.queries.listView, { surface: "tasks", viewKey: "nope" })).rejects.toThrow(
      /Unknown view/,
    );
    await expect(
      adminQ.query(api.tasks.queries.listView, { surface: "project", viewKey: "all", projectId: f.otherProject }),
    ).rejects.toThrow(/Project not found/);
  });
});

// ─── T1: access matrix ───────────────────────────────────────────────────────

describe("T1: access matrix over the new read queries", () => {
  it("listView rows per caller (sub-tasks via an assigned parent included)", async () => {
    const t = createT();
    const f = await setup(t);
    const withSubs = { ...SYSTEM_VIEWS.tasks.all.spec, showSubtasks: true };
    const expected: Record<Caller, Id<"tasks">[]> = {
      admin: [f.P, f.S, f.A, f.U],
      assigned: [f.S, f.A],
      viaParent: [f.P, f.S],
      unassigned: [],
      otherOrg: [f.X],
    };
    for (const caller of CALLERS) {
      const res = await as(t, caller).query(api.tasks.queries.listView, { surface: "tasks", spec: withSubs });
      expect(ids(res.rows), caller).toEqual(sorted(expected[caller]));
    }
    // Default system views hide sub-tasks.
    const alice = await as(t, "assigned").query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all" });
    expect(ids(alice.rows)).toEqual([f.A]);
  });

  it("getDetail / getByIdentifier / subtasks per caller", async () => {
    const t = createT();
    const f = await setup(t);
    const sIdentifier = (await t.run(async (ctx) => (await ctx.db.get(f.S))!.identifier))!;
    const canReadS: Record<Caller, boolean> = {
      admin: true, assigned: true, viaParent: true, unassigned: false, otherOrg: false,
    };
    // Reading P's sub-tasks needs access to P: an edge on S alone does not grant it.
    const canReadP: Record<Caller, boolean> = {
      admin: true, assigned: false, viaParent: true, unassigned: false, otherOrg: false,
    };
    for (const caller of CALLERS) {
      const q = as(t, caller);
      const detail = await q.query(api.tasks.queries.getDetail, { taskId: f.S });
      expect(detail !== null, `getDetail ${caller}`).toBe(canReadS[caller]);
      const byId = await q.query(api.tasks.queries.getByIdentifier, { identifier: sIdentifier });
      expect(byId?._id ?? null, `getByIdentifier ${caller}`).toBe(canReadS[caller] ? f.S : null);
      const subs = await q.query(api.tasks.queries.subtasks, { parentTaskId: f.P });
      expect(subs === null ? null : ids(subs.rows), `subtasks ${caller}`).toEqual(canReadP[caller] ? [f.S] : null);
    }
    const viaParent = await as(t, "viaParent").query(api.tasks.queries.getDetail, { taskId: f.S });
    expect(viaParent?.permissions).toMatchObject({ isAssignee: false, viaParent: true, canDelete: false });
    expect(viaParent?.permissions.editable).toMatchObject({ title: true, status: true, project: false, billable: false });
    expect(viaParent?.parent).toMatchObject({ _id: f.P, title: "Parent P" });
  });

  it("pickerCandidates per caller", async () => {
    const t = createT();
    const f = await setup(t);
    // Without search or project: the caller's own (assigned) tasks.
    const expected: Record<Caller, Id<"tasks">[]> = {
      admin: [f.U],
      assigned: [f.S, f.A],
      viaParent: [f.P, f.S],
      unassigned: [],
      otherOrg: [],
    };
    for (const caller of CALLERS) {
      const rows = await as(t, caller).query(api.tasks.queries.pickerCandidates, { includeSubtasks: true });
      expect(ids(rows), caller).toEqual(sorted(expected[caller]));
    }
    // Search is access-filtered too.
    const search = (caller: Caller) =>
      as(t, caller).query(api.tasks.queries.pickerCandidates, { search: "Sub", includeSubtasks: true });
    expect(ids(await search("viaParent"))).toEqual([f.S]);
    expect(await search("unassigned")).toEqual([]);
    expect(await search("otherOrg")).toEqual([]);
    // Project candidates (admin) and the default top-level rule.
    const arlo = await as(t, "admin").query(api.tasks.queries.pickerCandidates, { projectId: f.arlo });
    expect(ids(arlo)).toEqual(sorted([f.P, f.A]));
  });

  it("markViewed: readers only", async () => {
    const t = createT();
    const f = await setup(t);
    for (const caller of CALLERS) {
      const run = as(t, caller).mutation(api.tasks.userState.markViewed, { taskId: f.S });
      if (["admin", "assigned", "viaParent"].includes(caller)) await run;
      else await expect(run, caller).rejects.toThrow(/Task not found/);
    }
  });

  it("workspaceRefs: own org only, display fields only", async () => {
    const t = createT();
    const f = await setup(t);
    for (const caller of ["admin", "assigned", "unassigned"] as const) {
      const refs = await as(t, caller).query(api.workspaceRefs.get, {});
      expect(refs.projects.map((p) => p._id).sort()).toEqual(sorted([f.arlo, f.prag]));
      expect(refs.members.map((m) => m.name).sort()).toEqual(["Admin", "Alice", "Bob", "Carol"]);
      // No billing data reaches members (or anyone) through this query.
      for (const p of refs.projects) expect(Object.keys(p).sort()).toEqual(["_id", "archived", "clientId", "code", "name"]);
      for (const c of refs.clients) expect(Object.keys(c).sort()).toEqual(["_id", "archived", "name", "prefix", "usePrefix"]);
      expect(refs.statuses.map((s) => s.name)).toEqual(DEFAULT_STATUS_SEED.map((s) => s.name));
      expect(refs.statuses.find((s) => s.name === "Done")?.icon).toEqual({ kind: "check" });
    }
    const other = await as(t, "otherOrg").query(api.workspaceRefs.get, {});
    expect(other.projects.map((p) => p._id)).toEqual([f.otherProject]);
    expect(other.members.map((m) => m.name)).toEqual(["Other"]);
  });
});

describe("T1: the switched old queries read through access.ts", () => {
  it("task-scoped reads on a sub-task: assigned and via-parent allowed, others denied", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.comments.create, {
      taskId: f.S,
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
    });
    const allowed = new Set<Caller>(["admin", "assigned", "viaParent"]);
    for (const caller of CALLERS) {
      const q = as(t, caller);
      const ok = allowed.has(caller);
      if (ok) {
        expect((await q.query(api.tasks.getDetail, { id: f.S }))._id).toBe(f.S);
      } else {
        await expect(q.query(api.tasks.getDetail, { id: f.S }), caller).rejects.toThrow(/Task not found/);
      }
      expect((await q.query(api.comments.byTask, { taskId: f.S })).length > 0, `comments ${caller}`).toBe(ok);
      expect((await q.query(api.comments.latestPreview, { taskId: f.S })).length > 0).toBe(ok);
      expect((await q.query(api.comments.unreadCount, { taskId: f.S })).total > 0).toBe(ok);
      expect((await q.query(api.activityLog.byTask, { taskId: f.S })).length > 0, `activity ${caller}`).toBe(ok);
      expect((await q.query(api.activityLog.latestForTask, { taskId: f.S })).length > 0).toBe(ok);
      expect(await q.query(api.tasks.getWorkCategoryId, { taskId: f.S })).toBe(ok ? f.design : null);
      expect((await q.query(api.tasks.deleteImpact, { id: f.S })) !== null, `deleteImpact ${caller}`).toBe(ok);
      expect(Object.keys(await q.query(api.tasks.activityIndicators, { taskIds: [f.S] }))).toEqual(ok ? [f.S] : []);
      await q.query(api.attachments.byTask, { taskId: f.S }); // returns [] either way; must not throw
      await q.query(api.commentReactions.byTask, { taskId: f.S });
      await q.query(api.typingIndicators.getTyping, { taskId: f.S });
      const comment = q.mutation(api.comments.create, {
        taskId: f.S,
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: caller }] }] },
      });
      if (ok) await comment;
      else await expect(comment, `comments.create ${caller}`).rejects.toThrow(/Task not found/);
    }
  });

  it("parent-scoped reads: getSubtasks / subtaskPreview follow access to the parent", async () => {
    const t = createT();
    const f = await setup(t);
    for (const caller of CALLERS) {
      const q = as(t, caller);
      const ok = caller === "admin" || caller === "viaParent";
      if (ok) expect((await q.query(api.tasks.getSubtasks, { parentTaskId: f.P })).map((s) => s._id)).toEqual([f.S]);
      else await expect(q.query(api.tasks.getSubtasks, { parentTaskId: f.P }), caller).rejects.toThrow(/Task not found/);
      expect((await q.query(api.tasks.subtaskPreview, { taskId: f.P })).map((s) => s._id)).toEqual(ok ? [f.S] : []);
    }
  });

  it("list adapters scope members to their own (and via-parent) tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const listIds = async (caller: Caller) =>
      ids(
        (await as(t, caller).query(api.tasks.list, { tab: "all" })).groups.flatMap((g) => g.tasks),
      );
    expect(await listIds("admin")).toEqual(sorted([f.P, f.A, f.U]));
    expect(await listIds("assigned")).toEqual([f.A]);
    expect(await listIds("viaParent")).toEqual([f.P]);
    expect(await listIds("unassigned")).toEqual([]);
    expect(await listIds("otherOrg")).toEqual([f.X]);

    const byProject = async (caller: Caller) =>
      ids(await as(t, caller).query(api.tasks.listByProject, { projectId: f.arlo }));
    expect(await byProject("admin")).toEqual(sorted([f.P, f.S, f.A]));
    expect(await byProject("assigned")).toEqual(sorted([f.S, f.A]));
    expect(await byProject("viaParent")).toEqual(sorted([f.P, f.S]));
    expect(await byProject("unassigned")).toEqual([]);
    expect(await byProject("otherOrg")).toEqual([]);

    expect((await as(t, "assigned").query(api.tasks.counts, {})).all).toBe(1);
    expect((await as(t, "admin").query(api.tasks.counts, {})).all).toBe(3);
    expect((await as(t, "unassigned").query(api.tasks.counts, {})).all).toBe(0);
  });
});

// ─── T5: identifiers ─────────────────────────────────────────────────────────

describe("getByIdentifier resolves aliases (T5)", () => {
  it("an old identifier resolves to the moved task and says so", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const before = (await t.run(async (ctx) => (await ctx.db.get(f.U))!.identifier))!;
    expect(before).toMatch(/^PRAG-\d+$/);
    await admin.mutation(api.tasks.update, { id: f.U, projectId: f.arlo });
    const after = (await t.run(async (ctx) => (await ctx.db.get(f.U))!.identifier))!;
    expect(after).toMatch(/^ARLO-\d+$/);

    const viaAlias = await admin.query(api.tasks.queries.getByIdentifier, { identifier: before.toLowerCase() });
    expect(viaAlias).toMatchObject({ _id: f.U, identifier: after, resolvedFromAlias: true });
    const live = await admin.query(api.tasks.queries.getByIdentifier, { identifier: ` ${after} ` });
    expect(live).toMatchObject({ _id: f.U, resolvedFromAlias: false });
    expect(await admin.query(api.tasks.queries.getByIdentifier, { identifier: "ARLO-999" })).toBeNull();
    expect(await admin.query(api.tasks.queries.getByIdentifier, { identifier: "not an id" })).toBeNull();
    // Other org cannot resolve it, and members without access get null.
    expect(await as(t, "otherOrg").query(api.tasks.queries.getByIdentifier, { identifier: before })).toBeNull();
    expect(await as(t, "unassigned").query(api.tasks.queries.getByIdentifier, { identifier: after })).toBeNull();
  });
});

// ─── §4.3 taskUserState ──────────────────────────────────────────────────────

describe("taskUserState: fan-out on write, reset on open", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());
  const tick = () => vi.setSystemTime(Date.now() + 1_000);

  const text = (s: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: s }] }] });

  async function stateOf(t: T, taskId: Id<"tasks">, userId: Id<"users">) {
    return await t.run(async (ctx) =>
      await ctx.db
        .query("taskUserState")
        .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId).eq("userId", userId))
        .first(),
    );
  }

  it("comments, changes, mutes, deletes and opens keep every row consistent", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const alice = as(t, "assigned");
    const carol = as(t, "viaParent");
    // T: assignees Alice + Carol, created by Admin.
    tick();
    const T1 = await admin.mutation(api.tasks.create, { title: "Shared", assigneeIds: [f.alice, f.carol] });

    // Carol mutes the task; Admin comments.
    tick();
    await carol.mutation(api.notifications.muteTask, { taskId: T1 });
    tick();
    const c1 = await admin.mutation(api.comments.create, { taskId: T1, content: text("one") });
    expect(await stateOf(t, T1, f.alice)).toMatchObject({ unreadComments: 1, subscribed: true });
    expect(await stateOf(t, T1, f.carol)).toMatchObject({ unreadComments: 0, muted: true });
    expect(await stateOf(t, T1, f.admin)).toMatchObject({ unreadComments: 0, subscribed: true });
    expect(await stateOf(t, T1, f.bob)).toBeNull();

    // Alice replies → the creator/author Admin gets one unread.
    tick();
    await alice.mutation(api.comments.create, { taskId: T1, content: text("two") });
    expect(await stateOf(t, T1, f.admin)).toMatchObject({ unreadComments: 1 });
    expect(await stateOf(t, T1, f.alice)).toMatchObject({ unreadComments: 1 });

    // A status change by Admin lights Alice's dot, not Admin's.
    tick();
    await admin.mutation(api.tasks.update, { id: T1, statusId: f.status["In progress"] });
    expect(await stateOf(t, T1, f.alice)).toMatchObject({ hasUnseenChanges: true });
    expect(await stateOf(t, T1, f.admin)).toMatchObject({ hasUnseenChanges: false });

    // listView joins the caller's state; the newComments facet filters on it.
    const aliceView = await alice.query(api.tasks.queries.listView, { surface: "tasks", viewKey: "all" });
    expect(aliceView.perUser[T1]).toEqual({ unreadComments: 1, hasUnseenChanges: true, inMyToday: false });
    expect(aliceView.perUser[f.A]).toBeUndefined();
    const unreadOnly = await alice.query(api.tasks.queries.listView, {
      surface: "tasks",
      spec: { ...SYSTEM_VIEWS.tasks.all.spec, filters: [{ property: "newComments", operator: "is", values: ["true"] }] },
    });
    expect(ids(unreadOnly.rows)).toEqual([T1]);
    // The old activity indicators read the same state.
    expect((await alice.query(api.tasks.activityIndicators, { taskIds: [T1] }))[T1]).toMatchObject({
      unreadCommentCount: 1, hasUnseenComments: true, hasUnseenNonComment: true, hasUnseen: true,
    });

    // Admin deletes their comment → Alice's unread is recounted to 0.
    tick();
    await admin.mutation(api.comments.remove, { id: c1 });
    expect(await stateOf(t, T1, f.alice)).toMatchObject({ unreadComments: 0, hasUnseenChanges: true });

    // Opening resets (new mutation and the old receipt path alike).
    tick();
    await alice.mutation(api.tasks.userState.markViewed, { taskId: T1 });
    expect(await stateOf(t, T1, f.alice)).toMatchObject({ unreadComments: 0, hasUnseenChanges: false });
    tick();
    await admin.mutation(api.taskViewReceipts.markViewed, { taskId: T1 });
    expect(await stateOf(t, T1, f.admin)).toMatchObject({ unreadComments: 0, hasUnseenChanges: false });

    // An admin who opens a task they do not participate in is not subscribed.
    tick();
    await admin.mutation(api.tasks.userState.markViewed, { taskId: f.A });
    expect(await stateOf(t, f.A, f.admin)).toMatchObject({ subscribed: true }); // creator
    tick();
    const bobTask = await as(t, "unassigned").mutation(api.tasks.create, { title: "Bob's" });
    tick();
    await admin.mutation(api.tasks.userState.markViewed, { taskId: bobTask });
    expect(await stateOf(t, bobTask, f.admin)).toMatchObject({ subscribed: false });

    // Recompute from the source tables agrees with what the hooks wrote
    // (checked while Carol is muted: recompute cannot see mute history, so
    // after an unmute it would count the muted period's comments).
    for (const taskId of [T1, f.A, bobTask]) {
      const drift = await t.run(async (ctx) =>
        recomputeUserStates(ctx, (await ctx.db.get(taskId)) as Doc<"tasks">, {
          viewedAt: new Map(),
          mutedUserIds: new Set(),
        }),
      );
      expect(drift, `recompute ${taskId}`).toEqual({ inserted: 0, updated: 0 });
    }

    // Unmute restores fan-out.
    tick();
    await carol.mutation(api.notifications.unmuteTask, { taskId: T1 });
    tick();
    await admin.mutation(api.comments.create, { taskId: T1, content: text("three") });
    expect(await stateOf(t, T1, f.carol)).toMatchObject({ unreadComments: 1, muted: false });

    // Deleting the task drops its state rows.
    await admin.mutation(api.tasks.remove, { id: T1 });
    expect(await stateOf(t, T1, f.alice)).toBeNull();
  });

  it("the reseed backfills state from legacy receipts and is idempotent", async () => {
    const t = createT();
    const f = await setup(t);
    tick();
    await as(t, "admin").mutation(api.comments.create, { taskId: f.A, content: text("old") });
    // Simulate pre-slice-2 data: drop the state rows, keep a stale view receipt.
    await t.run(async (ctx) => {
      for (const s of await ctx.db.query("taskUserState").collect()) await ctx.db.delete(s._id);
      await ctx.db.insert("taskViewReceipts", { orgId: ORG, taskId: f.A, userId: f.alice, lastViewedAt: 1 });
    });
    const first = await t.mutation(internal.devSeedTasks.seed, { orgId: ORG });
    expect(first.userStatesInserted).toBeGreaterThan(0);
    expect(await stateOf(t, f.A, f.alice)).toMatchObject({ unreadComments: 1, subscribed: true, lastViewedAt: 1 });
    const second = await t.mutation(internal.devSeedTasks.seed, { orgId: ORG });
    expect(second).toMatchObject({ userStatesInserted: 0, userStatesUpdated: 0 });
  });
});

// ─── Adapter shape parity ────────────────────────────────────────────────────

describe("old queries keep their return shapes", () => {
  const keys = (o: object) => Object.keys(o).sort();

  it("tasks.list / counts / getDetail / getSubtasks / subtaskPreview / listByProject / activityIndicators", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");

    const list = await admin.query(api.tasks.list, { tab: "all", groupBy: "status" });
    expect(keys(list)).toEqual(["groups", "hitScanLimit", "totalCount"]);
    expect(keys(list.groups[0])).toEqual(["color", "count", "hasMore", "key", "label", "statusType", "tasks"]);
    const row = list.groups.flatMap((g) => g.tasks).find((x) => x._id === f.A)!;
    for (const k of ["status", "project", "client", "category", "assignees", "statusType", "assigneeIds", "manualSortKey"]) {
      expect(row).toHaveProperty(k);
    }
    expect(row.project).toMatchObject({ _id: f.arlo, code: "ARLO" });
    expect(row.assignees.map((a) => a._id)).toEqual([f.alice]);
    // Tabs still filter by the legacy type.
    const review = await admin.query(api.tasks.list, { tab: "in_progress" });
    expect(review.groups.flatMap((g) => g.tasks).map((x) => x._id)).toEqual([f.A]);

    expect(keys(await admin.query(api.tasks.counts, {}))).toEqual(
      ["all", "archived", "backlog", "blocked", "done", "in_progress", "review"],
    );

    // Optional fields that are undefined are dropped on the wire, so the
    // detail's keys are a subset of the old shape that includes the required ones.
    const detailKeys = keys(await admin.query(api.tasks.getDetail, { id: f.S }));
    const OLD_DETAIL_KEYS = [
      "_id", "assigneeIds", "assignees", "billable", "category", "client", "clientName", "createdAt",
      "createdBy", "createdByUser", "description", "dueDate", "estimate", "parentTaskId", "parentTaskTitle",
      "project", "projectId", "projectName", "status", "statusType", "title", "totalMinutes", "updatedAt",
      "workCategoryId",
    ];
    expect(OLD_DETAIL_KEYS).toEqual(expect.arrayContaining(detailKeys));
    expect(detailKeys).toEqual(expect.arrayContaining([
      "_id", "assigneeIds", "assignees", "billable", "category", "client", "createdAt", "createdBy",
      "createdByUser", "parentTaskId", "parentTaskTitle", "project", "status", "statusType", "title",
      "totalMinutes", "updatedAt",
    ]));

    const subs = await admin.query(api.tasks.getSubtasks, { parentTaskId: f.P });
    // `dueDate` is undefined here and dropped on the wire.
    expect(keys(subs[0])).toEqual(
      ["_id", "assignees", "billable", "category", "sortOrder", "status", "statusType", "title", "totalMinutes"],
    );
    expect(keys((await admin.query(api.tasks.subtaskPreview, { taskId: f.P }))[0])).toEqual(
      ["_id", "assignee", "statusType", "title"],
    );
    for (const r of await admin.query(api.tasks.listByProject, { projectId: f.arlo })) {
      expect(["_id", "billable", "statusType", "title", "workCategoryId"]).toEqual(expect.arrayContaining(keys(r)));
      expect(keys(r)).toEqual(expect.arrayContaining(["_id", "billable", "statusType", "title"]));
    }
    const indicators = await admin.query(api.tasks.activityIndicators, { taskIds: [f.P] });
    expect(keys(indicators[f.P])).toEqual([
      "commentCount", "hasAttachments", "hasDescription", "hasUnseen", "hasUnseenComments",
      "hasUnseenDescription", "hasUnseenNonComment", "hasUnseenSubtasks", "lastActivity",
      "subtaskDone", "subtaskTotal", "unreadCommentCount", "unseenActivityCount",
    ]);
    expect(indicators[f.P]).toMatchObject({ subtaskTotal: 1, subtaskDone: 0 });
    expect(indicators[f.P].lastActivity).toMatchObject({ userName: "Admin", type: "subtask_created" });
  });

  it("planner.taskPanel", async () => {
    const t = createT();
    const f = await setup(t);
    const panel = await as(t, "admin").query(api.planner.taskPanel, {});
    expect(keys(panel[0])).toEqual([
      "_id", "categoryColor", "categoryId", "categoryName", "clientId", "clientName", "createdAt", "dueDate",
      "estimate", "plannedDays", "projectId", "projectName", "segmentCount", "statusType", "title",
    ]);
    expect(ids(panel)).toEqual(sorted([f.P, f.A, f.U]));
  });
});

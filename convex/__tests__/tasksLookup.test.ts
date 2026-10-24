// @vitest-environment edge-runtime
//
// Tasks refactor §7 (docs/prd-tasks-refactor.md): the task lookup layer in
// convex/tasks/lookup.ts (kept for the MCP server, docs/prd-mcp.md).
//   T1   access matrix over findTasks / getTaskDetail / countTasksByStatus:
//        admin / member-assigned / member-via-parent / member-unassigned / other org
//   T5   identifiers resolve case-insensitively and through aliases
//   T7   capped reads report `truncated` (never an exact count past a cap)

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED, type TaskCategory } from "../tasks/model";
import { addIdentifierAlias, archiveTask, createTask, type CreateTaskInput } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import { COUNT_CAP_PER_CATEGORY } from "../tasks/lookup";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_agent";
const OTHER = "org_agent_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

/**
 * Callers. On the fixture's sub-task S: `assigned` (Alice) has an edge on S,
 * `viaParent` (Carol) has an edge on S's parent P only (§11.5), `unassigned`
 * (Bob) has none, `otherOrg` is an admin of another org.
 */
type Caller = "admin" | "assigned" | "viaParent" | "unassigned" | "otherOrg";

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
  carol: Id<"users">;
  status: Record<string, Id<"statuses">>;
  arlo: Id<"projects">;
  prag: Id<"projects">;
  otherProject: Id<"projects">;
  design: Id<"workCategories">;
  urgentLabel: Id<"labels">;
  /** Top-level, ARLO, assignee Carol, described + labelled. */
  P: Id<"tasks">;
  /** Sub-task of P, assignee Alice. */
  S: Id<"tasks">;
  /** Top-level, ARLO, assignee Alice, started, due 2026-06-15, high priority. */
  A: Id<"tasks">;
  /** Top-level, PRAG, assignee Admin only. */
  U: Id<"tasks">;
  /** Completed, ARLO, assignee Alice. */
  D: Id<"tasks">;
  /** Archived, assignee Alice ("Alpha" title like A). */
  Z: Id<"tasks">;
  /** A task of the other org. */
  X: Id<"tasks">;
  identifier: Record<"P" | "S" | "A" | "U" | "D" | "Z" | "X", string>;
};

const DESCRIPTION = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Rebuild the hero section" }] }],
});

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const carol = await mkUser("Carol", "clerk_carol");
    const other = await mkUser("Other", "clerk_other");
    const roles = [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [carol, "clerk_carol", "member", ORG],
      [other, "clerk_other", "admin", OTHER],
    ] as const;
    for (const [userId, clerkUserId, role, orgId] of roles) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        createdAt: now, updatedAt: now, createdBy,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
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
    const urgentLabel = await ctx.db.insert("labels", { orgId: ORG, name: "Launch", color: "red", position: "a0" });

    const adminAuth: AuthContext = {
      userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))!,
    };
    const otherAuth: AuthContext = {
      userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))!,
    };
    const mk = (auth: AuthContext, input: CreateTaskInput) => createTask(ctx, auth, input, { notify: false });

    const P = await mk(adminAuth, {
      title: "Parent P", projectId: arlo, assigneeIds: [carol], workCategoryId: design,
      description: DESCRIPTION, labelIds: [urgentLabel], estimateMinutes: 90,
    });
    const S = await mk(adminAuth, { title: "Sub S", parentTaskId: P, assigneeIds: [alice] });
    const A = await mk(adminAuth, {
      title: "Alpha A", projectId: arlo, assigneeIds: [alice], statusId: status["In progress"],
      dueDate: "2026-06-15", priority: 2,
    });
    const U = await mk(adminAuth, { title: "Unrelated U", projectId: prag, assigneeIds: [admin] });
    const D = await mk(adminAuth, { title: "Done D", projectId: arlo, assigneeIds: [alice], statusId: status.Done });
    const Z = await mk(adminAuth, { title: "Alpha archived Z", projectId: arlo, assigneeIds: [alice] });
    await archiveTask(ctx, await loadTaskForWrite(ctx, Z, adminAuth));
    const X = await mk(otherAuth, { title: "Other org X", projectId: otherProject });

    const identifier = {} as Fixture["identifier"];
    for (const [key, id] of Object.entries({ P, S, A, U, D, Z, X })) {
      identifier[key as keyof Fixture["identifier"]] = (await ctx.db.get(id))!.identifier!;
    }
    return {
      admin, alice, carol, status, arlo, prag, otherProject, design, urgentLabel,
      P, S, A, U, D, Z, X, identifier,
    };
  });
}

const sortedIds = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id).sort();
const sorted = (xs: readonly string[]) => [...xs].sort();

/** Inserts `count` bare tasks of one category straight into the table (load fixtures only). */
async function bulkInsert(t: T, f: Fixture, count: number, category: TaskCategory, statusName: string) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      const number = 10_000 + i;
      await ctx.db.insert("tasks", {
        orgId: ORG, title: `Bulk ${category} ${i}`, hasDescription: false,
        identifier: `BULK-${number}`, numberScope: { kind: "org" }, number,
        statusId: f.status[statusName], statusCategory: category, priority: 0,
        assigneeIds: [], labelIds: [], billable: true, sortKey: `z${String(i).padStart(5, "0")}`,
        trackedMinutes: 0, commentCount: 0, subtaskCount: 0, subtaskDoneCount: 0, lastActivityAt: now,
        createdAt: now, updatedAt: now, createdBy: f.admin,
      });
    }
  });
}

// ─── findTasks ───────────────────────────────────────────────────────────────

describe("findTasks (T1, §7)", () => {
  it("returns only what each caller can read; open, non-archived by default", async () => {
    const t = createT();
    const f = await setup(t);
    const find = (caller: Caller, args = {}) => as(t, caller).query(api.tasks.lookup.findTasks, args);

    expect(sortedIds((await find("admin")).tasks)).toEqual(sorted([f.P, f.S, f.A, f.U]));
    expect(sortedIds((await find("assigned")).tasks)).toEqual(sorted([f.A, f.S]));
    expect(sortedIds((await find("viaParent")).tasks)).toEqual(sorted([f.P, f.S]));
    expect((await find("unassigned")).tasks).toEqual([]);
    expect(sortedIds((await find("otherOrg")).tasks)).toEqual([f.X]);

    // Closed tasks need includeClosed or a closed category; archived never.
    expect(sortedIds((await find("assigned", { includeClosed: true })).tasks)).toEqual(sorted([f.A, f.S, f.D]));
    expect(sortedIds((await find("admin", { category: "completed" })).tasks)).toEqual([f.D]);
    expect(sortedIds((await find("admin", { statusId: f.status.Done })).tasks)).toEqual([f.D]);
  });

  it("returns flat rows with names resolved and identifiers", async () => {
    const t = createT();
    const f = await setup(t);
    const { tasks, truncated } = await as(t, "admin").query(api.tasks.lookup.findTasks, {});
    expect(truncated).toBe(false);
    const a = tasks.find((r) => r.id === f.A)!;
    expect(a).toEqual({
      id: f.A,
      identifier: f.identifier.A,
      title: "Alpha A",
      status: "In progress",
      statusCategory: "started",
      priority: "High",
      project: "Arlow site",
      client: "Arlow",
      workCategory: null,
      assignees: ["Alice"],
      dueDate: "2026-06-15",
      billable: true,
      parent: null,
    });
    expect(f.identifier.A).toMatch(/^ARLO-\d+$/);
    const s = tasks.find((r) => r.id === f.S)!;
    expect(s.parent).toBe(f.identifier.P);
    expect(tasks.find((r) => r.id === f.P)!.workCategory).toBe("Design");
  });

  it("applies the flat filters (ids, due range, search)", async () => {
    const t = createT();
    const f = await setup(t);
    const find = (caller: Caller, args: Record<string, unknown>) =>
      as(t, caller).query(api.tasks.lookup.findTasks, args);

    expect(sortedIds((await find("admin", { assigneeId: f.alice })).tasks)).toEqual(sorted([f.A, f.S]));
    expect(sortedIds((await find("admin", { projectId: f.prag })).tasks)).toEqual([f.U]);
    expect(sortedIds((await find("admin", { category: "started" })).tasks)).toEqual([f.A]);
    expect(sortedIds((await find("admin", { workCategoryId: f.design })).tasks)).toEqual(sorted([f.P, f.S]));
    // Inclusive range; undated tasks never match a bound.
    expect(sortedIds((await find("admin", { dueAfter: "2026-06-15", dueBefore: "2026-06-15" })).tasks)).toEqual([f.A]);
    expect((await find("admin", { dueAfter: "2026-06-16" })).tasks).toEqual([]);
    // A member's filter never widens their visibility.
    expect((await find("unassigned", { assigneeId: f.alice })).tasks).toEqual([]);

    // Search: archived Z never surfaces; access applies to hits.
    expect(sortedIds((await find("admin", { search: "Alpha" })).tasks)).toEqual([f.A]);
    expect(sortedIds((await find("assigned", { search: "Alpha" })).tasks)).toEqual([f.A]);
    expect((await find("unassigned", { search: "Alpha" })).tasks).toEqual([]);
    expect((await find("otherOrg", { search: "Alpha" })).tasks).toEqual([]);
  });

  it("malformed and foreign ids are model-actionable errors", async () => {
    const t = createT();
    const f = await setup(t);
    const find = (args: Record<string, unknown>) => as(t, "admin").query(api.tasks.lookup.findTasks, args);
    await expect(find({ projectId: "not-an-id" })).rejects.toThrow(/listProjects/);
    await expect(find({ projectId: f.otherProject })).rejects.toThrow(/No project/);
    await expect(find({ statusId: "nope" })).rejects.toThrow(/listStatuses/);
    await expect(find({ assigneeId: "nope" })).rejects.toThrow(/listTeamMembers/);
    // An id of the wrong table is malformed for this one.
    await expect(find({ clientId: f.arlo })).rejects.toThrow(/listClients/);
  });

  it("reports truncation at the limit and at a load cap (T7)", async () => {
    const t = createT();
    const f = await setup(t);
    const limited = await as(t, "admin").query(api.tasks.lookup.findTasks, { limit: 1 });
    expect(limited.tasks).toHaveLength(1);
    expect(limited.truncated).toBe(true);

    await bulkInsert(t, f, COUNT_CAP_PER_CATEGORY + 1, "unstarted", "Next up");
    const capped = await as(t, "admin").query(api.tasks.lookup.findTasks, { category: "unstarted", limit: 100 });
    expect(capped.tasks).toHaveLength(100);
    expect(capped.truncated).toBe(true);
  });
});

// ─── getTaskDetail ───────────────────────────────────────────────────────────

describe("getTaskDetail (T1, T5)", () => {
  it("resolves identifiers case-insensitively, aliases and ids", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      await addIdentifierAlias(ctx, ORG, "OLD-7", f.A);
    });
    const get = (task: string, caller: Caller = "admin") =>
      as(t, caller).query(api.tasks.lookup.getTaskDetail, { task });

    expect((await get(f.identifier.A))?.id).toBe(f.A);
    expect((await get(` ${f.identifier.A.toLowerCase()} `))?.id).toBe(f.A);
    expect((await get("old-7"))?.id).toBe(f.A);
    expect((await get(f.A))?.id).toBe(f.A);
    expect(await get("ARLO-999")).toBeNull();
    expect(await get("garbage")).toBeNull();
  });

  it("returns null for unreadable and other-org tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const get = (task: string, caller: Caller) => as(t, caller).query(api.tasks.lookup.getTaskDetail, { task });

    expect((await get(f.identifier.A, "assigned"))?.id).toBe(f.A);
    expect(await get(f.identifier.A, "unassigned")).toBeNull();
    expect(await get(f.identifier.A, "viaParent")).toBeNull();
    expect((await get(f.identifier.S, "viaParent"))?.id).toBe(f.S); // §11.5
    expect(await get(f.identifier.A, "otherOrg")).toBeNull();
    expect(await get(f.A, "otherOrg")).toBeNull();
    expect(await get(f.X, "admin")).toBeNull();
    expect((await get(f.identifier.X, "otherOrg"))?.id).toBe(f.X);
  });

  it("carries the full detail with sub-tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const detail = await as(t, "viaParent").query(api.tasks.lookup.getTaskDetail, { task: f.identifier.P });
    expect(detail).toMatchObject({
      id: f.P,
      identifier: f.identifier.P,
      title: "Parent P",
      description: "Rebuild the hero section",
      status: "Inbox",
      statusCategory: "backlog",
      priority: "No priority",
      project: "Arlow site",
      client: "Arlow",
      workCategory: "Design",
      assignees: ["Carol"],
      labels: ["Launch"],
      estimateMinutes: 90,
      trackedMinutes: 0,
      archived: false,
      parent: null,
      subtasksTruncated: false,
    });
    expect(detail?.subtasks).toEqual([
      {
        id: f.S,
        identifier: f.identifier.S,
        title: "Sub S",
        status: "Inbox",
        statusCategory: "backlog",
        trackedMinutes: 0,
        assignees: ["Alice"],
      },
    ]);
    const sub = await as(t, "assigned").query(api.tasks.lookup.getTaskDetail, { task: f.identifier.S });
    expect(sub?.parent).toEqual({ identifier: f.identifier.P, title: "Parent P" });
  });
});

// ─── countTasksByStatus ──────────────────────────────────────────────────────

describe("countTasksByStatus (T1, T7)", () => {
  const byCategory = (counts: { byCategory: Array<{ category: string; count: number }> }) =>
    Object.fromEntries(counts.byCategory.map((c) => [c.category, c.count]));

  it("counts what each caller can see, archived excluded", async () => {
    const t = createT();
    await setup(t);
    const count = (caller: Caller) => as(t, caller).query(api.tasks.lookup.countTasksByStatus, {});

    const admin = await count("admin");
    expect(admin.scope).toBe("organization");
    expect(admin.truncated).toBe(false);
    expect(admin.total).toBe(5); // P, S, U backlog · A started · D completed
    expect(byCategory(admin)).toEqual({ backlog: 3, unstarted: 0, started: 1, completed: 1, canceled: 0 });
    expect(admin.byStatus.find((s) => s.status === "Inbox")?.count).toBe(3);
    expect(admin.byStatus.find((s) => s.status === "Stuck")?.count).toBe(0);

    const alice = await count("assigned");
    expect(alice.scope).toBe("assigned to you");
    expect(byCategory(alice)).toEqual({ backlog: 1, unstarted: 0, started: 1, completed: 1, canceled: 0 });
    expect(byCategory(await count("viaParent"))).toMatchObject({ backlog: 2 });
    expect((await count("unassigned")).total).toBe(0);
    const other = await count("otherOrg");
    expect(other.total).toBe(1);
    expect(byCategory(other)).toMatchObject({ backlog: 1 });
  });

  it("a capped category is flagged, never an exact count past the cap", async () => {
    const t = createT();
    const f = await setup(t);
    await bulkInsert(t, f, COUNT_CAP_PER_CATEGORY + 1, "unstarted", "Next up");
    const counts = await as(t, "admin").query(api.tasks.lookup.countTasksByStatus, {});
    const unstarted = counts.byCategory.find((c) => c.category === "unstarted")!;
    expect(unstarted).toMatchObject({ count: COUNT_CAP_PER_CATEGORY, truncated: true });
    expect(counts.byCategory.find((c) => c.category === "backlog")?.truncated).toBe(false);
    expect(counts.truncated).toBe(true);
  });
});

// ─── resolveTask ─────────────────────────────────────────────────────────────

describe("resolveTask", () => {
  it("resolves identifiers case-insensitively and applies access", async () => {
    const t = createT();
    const f = await setup(t);
    expect(await as(t, "admin").query(api.tasks.lookup.resolveTask, { task: f.identifier.A.toLowerCase() })).toEqual({
      id: f.A, identifier: f.identifier.A, title: "Alpha A", archived: false,
    });
    expect(await as(t, "unassigned").query(api.tasks.lookup.resolveTask, { task: f.identifier.A })).toBeNull();
    expect(await as(t, "otherOrg").query(api.tasks.lookup.resolveTask, { task: f.A })).toBeNull();
  });
});

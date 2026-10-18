// @vitest-environment edge-runtime
//
// Tasks refactor slice 1 (docs/prd-tasks-refactor.md §5.2, §8): the write
// path in convex/tasks/write.ts behind every rewired public mutation.
//   T3  statusCategory == the status's category, across transitions
//   T4  completedAt set iff closed; stamped on entering, kept inside, cleared on leaving
//   T5  identifiers: create / move / project-code rename / aliases, unique per org
//   T6  assigneeIds/labelIds caches == edges; counters == recomputation (randomized ops)
//   T8  one-level sub-tasks share the parent's project/client; archive/restore cascade
//   T1  access matrix over the rewired mutations (admin / assigned / unassigned / other org)
// T2 (single writer) is the static test in tasksWriteBoundary.test.ts.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  DEFAULT_STATUS_SEED,
  categoryOfStatus,
  isClosedCategory,
  isValidIdentifierKey,
  type TaskCategory,
} from "../tasks/model";
import { recomputeTaskCounters } from "../tasks/derived";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_write";
const OTHER = "org_write_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "assigned" | "unassigned" | "otherOrg";

const IDENTITY: Record<Caller, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  assigned: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
  unassigned: { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" },
  otherOrg: { subject: "clerk_other", orgId: OTHER, orgRole: "org:admin" },
};

const as = (t: T, caller: Caller) => t.withIdentity(IDENTITY[caller]);

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  bob: Id<"users">;
  other: Id<"users">;
  status: Record<string, Id<"statuses">>; // by name
  arlo: Id<"projects">;
  prag: Id<"projects">;
  legacy: Id<"projects">; // code "PRJ-007": not a valid identifier key
  arloClient: Id<"clients">;
  pragClient: Id<"clients">;
  design: Id<"workCategories">;
  bug: Id<"labels">;
  feature: Id<"labels">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
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

    const mkClient = async (name: string, prefix: string) =>
      await ctx.db.insert("clients", {
        orgId: ORG, name, currency: "EUR", prefix, createdAt: now, updatedAt: now, createdBy: admin,
      });
    const arloClient = await mkClient("Arlow", "ARLO");
    const pragClient = await mkClient("Pragmatico", "PRAG");
    const mkProject = async (name: string, code: string, clientId: Id<"clients">) =>
      await ctx.db.insert("projects", {
        orgId: ORG, clientId, name, code, billingType: "t_and_m",
        createdAt: now, updatedAt: now, createdBy: admin,
      });
    const arlo = await mkProject("Arlow site", "ARLO", arloClient);
    const prag = await mkProject("Pragmatico app", "PRAG", pragClient);
    const legacy = await mkProject("Legacy", "PRJ-007", arloClient);

    const design = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const bug = await ctx.db.insert("labels", { orgId: ORG, name: "Bug", color: "red", position: "a0" });
    const feature = await ctx.db.insert("labels", { orgId: ORG, name: "Feature", color: "purple", position: "a1" });
    for (const userId of [admin, alice, bob]) {
      await ctx.db.insert("userRates", { orgId: ORG, userId, currency: "EUR", costRate: 40, createdAt: now, updatedAt: now });
    }

    return { admin, alice, bob, other, status, arlo, prag, legacy, arloClient, pragClient, design, bug, feature };
  });
}

// ─── Readers ────────────────────────────────────────────────────────────────

async function getTask(t: T, id: Id<"tasks">): Promise<Doc<"tasks">> {
  return await t.run(async (ctx) => (await ctx.db.get(id))!);
}

async function edgesOf(t: T, id: Id<"tasks">) {
  return await t.run(async (ctx) => ({
    assignees: (
      await ctx.db.query("taskAssignees").withIndex("by_taskId_userId", (q) => q.eq("taskId", id)).collect()
    ).map((e) => e.userId),
    labels: (
      await ctx.db.query("taskLabels").withIndex("by_taskId_labelId", (q) => q.eq("taskId", id)).collect()
    ).map((e) => e.labelId),
  }));
}

async function aliasesOf(t: T, id: Id<"tasks">): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("taskIdentifierAliases").withIndex("by_taskId", (q) => q.eq("taskId", id)).collect())
      .map((a) => a.identifier)
      .sort(),
  );
}

async function activityTypes(t: T, id: Id<"tasks">): Promise<string[]> {
  return await t.run(async (ctx) =>
    (await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", id)).collect()).map((e) => e.type),
  );
}

const sorted = <V extends string>(xs: readonly V[]) => [...xs].sort();

/** T3 + T4 + T6 on one task, checked against the source tables. */
async function expectTaskInvariants(t: T, id: Id<"tasks">) {
  const task = await getTask(t, id);
  const { status, counters } = await t.run(async (ctx) => ({
    status: (await ctx.db.get(task.statusId))!,
    counters: await recomputeTaskCounters(ctx, task),
  }));
  expect(task.statusCategory).toBe(categoryOfStatus(status));
  expect(task.statusType).toBe(status.type);
  expect(task.completedAt !== undefined).toBe(isClosedCategory(task.statusCategory!));
  const edges = await edgesOf(t, id);
  expect(sorted(edges.assignees)).toEqual(sorted(task.assigneeIds));
  expect(sorted(edges.labels)).toEqual(sorted(task.labelIds ?? []));
  expect({
    trackedMinutes: task.trackedMinutes,
    commentCount: task.commentCount,
    lastCommentAt: task.lastCommentAt,
    subtaskCount: task.subtaskCount,
    subtaskDoneCount: task.subtaskDoneCount,
  }).toEqual(counters);
}

/** Deterministic PRNG (mulberry32) for the randomized sequences. */
function rng(seed: number) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <V>(xs: readonly V[]): V => xs[Math.floor(next() * xs.length)],
    subset: <V>(xs: readonly V[]): V[] => xs.filter(() => next() < 0.5),
  };
}

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

// ─── Create paths ───────────────────────────────────────────────────────────

describe("create paths (all five go through write.ts)", () => {
  it("tasks.create numbers per project and per org, fills the model and the legacy fields", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");

    const a1 = await admin.mutation(api.tasks.create, {
      title: "  First  ", projectId: f.arlo, assigneeIds: [f.alice], labelIds: [f.bug], estimate: 90, priority: 2,
    });
    const a2 = await admin.mutation(api.tasks.create, { title: "Second", projectId: f.arlo });
    const org1 = await admin.mutation(api.tasks.create, { title: "Org-level" });

    const first = await getTask(t, a1);
    expect(first).toMatchObject({
      title: "First",
      identifier: "ARLO-1",
      number: 1,
      numberScope: { kind: "project", projectId: f.arlo },
      clientId: f.arloClient,
      statusId: f.status.Inbox,
      statusType: "backlog",
      statusCategory: "backlog",
      priority: 2,
      estimate: 90,
      estimateMinutes: 90,
      assigneeIds: [f.alice],
      labelIds: [f.bug],
      trackedMinutes: 0,
      commentCount: 0,
      subtaskCount: 0,
      subtaskDoneCount: 0,
      lastActivity: { kind: "task_created", actorId: f.admin },
    });
    expect(first.sortKey).toBe(first.manualSortKey);
    expect(first.completedAt).toBeUndefined();
    expect((await getTask(t, a2)).identifier).toBe("ARLO-2");
    expect((await getTask(t, a2)).sortKey! > first.sortKey!).toBe(true);
    expect((await getTask(t, org1)).identifier).toBe("KONV-1");
    expect(await activityTypes(t, a1)).toEqual(["task_created"]);

    const counters = await t.run(async (ctx) => ({
      arlo: (await ctx.db.get(f.arlo))!.nextTaskNumber,
      settings: await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique(),
    }));
    expect(counters.arlo).toBe(3);
    expect(counters.settings).toMatchObject({ taskKey: "KONV", nextTaskNumber: 2 });
    for (const id of [a1, a2, org1]) await expectTaskInvariants(t, id);
  });

  it("a member is always assigned to what they create (§5.3)", async () => {
    const t = createT();
    const f = await setup(t);
    const solo = await as(t, "assigned").mutation(api.tasks.create, { title: "Mine" });
    const shared = await as(t, "assigned").mutation(api.tasks.create, { title: "Ours", assigneeIds: [f.bob] });
    expect((await getTask(t, solo)).assigneeIds).toEqual([f.alice]);
    expect(sorted((await edgesOf(t, shared)).assignees)).toEqual(sorted([f.alice, f.bob]));
  });

  it("a project whose code is not a valid key numbers tasks without an identifier", async () => {
    const t = createT();
    const f = await setup(t);
    const id = await as(t, "admin").mutation(api.tasks.create, { title: "Legacy", projectId: f.legacy });
    const task = await getTask(t, id);
    expect(task.number).toBe(1);
    expect(task.identifier).toBeUndefined();
  });

  it("createSubtask inherits project, client, assignees and category; one level only (T8)", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, {
      title: "Parent", projectId: f.arlo, assigneeIds: [f.alice], workCategoryId: f.design,
    });
    const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Child" });
    expect(await getTask(t, sub)).toMatchObject({
      parentTaskId: parent,
      projectId: f.arlo,
      clientId: f.arloClient,
      identifier: "ARLO-2",
      assigneeIds: [f.alice],
      workCategoryId: f.design,
      sortOrder: 0,
    });
    expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 1, subtaskDoneCount: 0 });
    expect(await activityTypes(t, parent)).toContain("subtask_created");
    await expect(admin.mutation(api.tasks.createSubtask, { parentTaskId: sub, title: "Grandchild" })).rejects.toThrow(
      "max 1 level",
    );
    await expectTaskInvariants(t, parent);
    await expectTaskInvariants(t, sub);
  });

  it("duplicate copies properties, gets a new identifier and sits right after the original", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const original = await admin.mutation(api.tasks.create, {
      title: "Original", projectId: f.arlo, assigneeIds: [f.alice, f.bob], labelIds: [f.bug, f.feature], priority: 1,
    });
    const next = await admin.mutation(api.tasks.create, { title: "Next", projectId: f.arlo });
    const copy = await admin.mutation(api.tasks.duplicate, { id: original });
    const [o, n, c] = [await getTask(t, original), await getTask(t, next), await getTask(t, copy)];
    expect(c).toMatchObject({ title: "Original (copy)", identifier: "ARLO-3", priority: 1, projectId: f.arlo });
    expect(sorted(c.assigneeIds)).toEqual(sorted([f.alice, f.bob]));
    expect(sorted(c.labelIds!)).toEqual(sorted([f.bug, f.feature]));
    expect(c.sortKey! > o.sortKey! && c.sortKey! < n.sortKey!).toBe(true);
    await expectTaskInvariants(t, copy);
  });

  it("planner.createTaskWithSegment and planner.createTodayTask use the same path", async () => {
    const t = createT();
    const f = await setup(t);
    const drawn = await as(t, "admin").mutation(api.planner.createTaskWithSegment, {
      title: "Drawn", projectId: f.prag, userId: f.alice, startDate: "2026-10-19", endDate: "2026-10-20",
    });
    expect(await getTask(t, drawn.taskId)).toMatchObject({
      identifier: "PRAG-1", statusCategory: "backlog", assigneeIds: [],
    });
    const today = await as(t, "assigned").mutation(api.planner.createTodayTask, { title: "Today" });
    expect(await getTask(t, today.taskId)).toMatchObject({
      identifier: "KONV-1",
      statusId: f.status["In progress"],
      statusCategory: "started",
      assigneeIds: [f.alice],
    });
    await expectTaskInvariants(t, drawn.taskId);
    await expectTaskInvariants(t, today.taskId);
  });
});

// ─── T3 / T4 ────────────────────────────────────────────────────────────────

describe("T3/T4: status category and completedAt across transitions", () => {
  it("holds over a randomized transition sequence (update + bulk)", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const id = await admin.mutation(api.tasks.create, { title: "Walker", projectId: f.arlo });
    // A pre-slice-0 status without a category: resolved by name/legacy type.
    const waiting = await t.run(async (ctx) =>
      await ctx.db.insert("statuses", {
        orgId: ORG, name: "Waiting", color: "gray", type: "review", sortOrder: 99,
        createdAt: Date.now(), updatedAt: Date.now(), createdBy: f.admin,
      }),
    );
    const statusIds = [...Object.values(f.status), waiting];
    const r = rng(7);
    for (let step = 0; step < 40; step++) {
      const prev = await getTask(t, id);
      const nextStatus = r.pick(statusIds);
      const before = Date.now();
      if (r.next() < 0.5) {
        await admin.mutation(api.tasks.update, { id, statusId: nextStatus });
      } else {
        await admin.mutation(api.tasks.bulkUpdate, { taskIds: [id], action: { type: "status", statusId: nextStatus } });
      }
      const task = await getTask(t, id);
      await expectTaskInvariants(t, id);
      const next = task.statusCategory as TaskCategory;
      if (!isClosedCategory(next)) {
        expect(task.completedAt).toBeUndefined();
      } else if (prev.statusCategory === next) {
        expect(task.completedAt).toBe(prev.completedAt); // kept inside the category
      } else {
        expect(task.completedAt).toBeGreaterThanOrEqual(before); // stamped on entering
      }
    }
  });

  it("a sub-task's category change updates the parent's done count (closed = completed + canceled)", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, { title: "Parent" });
    const a = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "A" });
    const b = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "B" });
    await admin.mutation(api.tasks.update, { id: a, statusId: f.status.Done });
    await admin.mutation(api.tasks.update, { id: b, statusId: f.status.Canceled });
    expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 2 });
    expect((await activityTypes(t, parent)).filter((x) => x === "subtask_completed")).toHaveLength(1);
    await admin.mutation(api.tasks.update, { id: a, statusId: f.status["In progress"] });
    expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1 });
    await expectTaskInvariants(t, parent);
  });
});

// ─── T5 ─────────────────────────────────────────────────────────────────────

async function allIdentifiers(t: T) {
  return await t.run(async (ctx) => {
    const tasks = await ctx.db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect();
    const aliases = await ctx.db
      .query("taskIdentifierAliases")
      .withIndex("by_orgId_identifier", (q) => q.eq("orgId", ORG))
      .collect();
    return {
      live: tasks.flatMap((x) => (x.identifier ? [x.identifier] : [])),
      aliases: aliases.map((a) => a.identifier),
    };
  });
}

async function expectIdentifiersUnique(t: T) {
  const { live, aliases } = await allIdentifiers(t);
  expect(new Set(live).size).toBe(live.length);
  expect(new Set(aliases).size).toBe(aliases.length);
  expect(aliases.filter((a) => live.includes(a))).toEqual([]);
}

describe("T5: identifiers", () => {
  it("a project move renumbers the task and its sub-tasks and aliases the old identifiers", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, { title: "Mover", projectId: f.arlo });
    const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Rider" });

    await admin.mutation(api.tasks.update, { id: parent, projectId: f.prag });
    expect(await getTask(t, parent)).toMatchObject({ identifier: "PRAG-1", clientId: f.pragClient, projectId: f.prag });
    expect(await getTask(t, sub)).toMatchObject({ identifier: "PRAG-2", clientId: f.pragClient, projectId: f.prag });
    expect(await aliasesOf(t, parent)).toEqual(["ARLO-1"]);
    expect(await aliasesOf(t, sub)).toEqual(["ARLO-2"]);
    expect(await activityTypes(t, parent)).toEqual(
      expect.arrayContaining(["project_changed", "identifier_changed"]),
    );

    await admin.mutation(api.tasks.update, { id: parent, projectId: null });
    expect(await getTask(t, parent)).toMatchObject({ identifier: "KONV-1", numberScope: { kind: "org" } });
    expect((await getTask(t, parent)).clientId).toBeUndefined();
    expect(await aliasesOf(t, parent)).toEqual(["ARLO-1", "PRAG-1"]);
    await expectIdentifiersUnique(t);
  });

  it("a sub-task cannot leave its parent's project; logged time pins the project", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, { title: "Parent", projectId: f.arlo });
    const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Child" });
    await expect(admin.mutation(api.tasks.update, { id: sub, projectId: f.prag })).rejects.toThrow(
      "parent's project",
    );
    await admin.mutation(api.timeEntries.create, {
      taskId: sub, durationMinutes: 30, startedAt: Date.now(), isBillable: false,
    });
    await expect(admin.mutation(api.tasks.update, { id: parent, projectId: f.prag })).rejects.toThrow(
      "time entries",
    );
  });

  it("a project-code rename rewrites identifiers (§11.1); renaming back drops shadowed aliases", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const one = await admin.mutation(api.tasks.create, { title: "One", projectId: f.prag });
    const two = await admin.mutation(api.tasks.create, { title: "Two", projectId: f.prag });

    await admin.mutation(api.projects.update, { id: f.prag, code: " prg " });
    expect((await t.run(async (ctx) => await ctx.db.get(f.prag)))!.code).toBe("PRG");
    expect((await getTask(t, one)).identifier).toBe("PRG-1");
    expect((await getTask(t, two)).identifier).toBe("PRG-2");
    expect(await aliasesOf(t, one)).toEqual(["PRAG-1"]);
    expect(await activityTypes(t, two)).toContain("identifier_changed");

    await admin.mutation(api.projects.update, { id: f.prag, code: "PRAG" });
    expect((await getTask(t, one)).identifier).toBe("PRAG-1");
    expect(await aliasesOf(t, one)).toEqual(["PRG-1"]);
    await expectIdentifiersUnique(t);

    // A new project reusing the freed code skips numbers still held by aliases.
    const reuse = await admin.mutation(api.projects.create, {
      clientId: f.pragClient, name: "Reuse", billingType: "t_and_m", code: "PRG",
    });
    const fresh = await admin.mutation(api.tasks.create, { title: "Fresh", projectId: reuse });
    expect((await getTask(t, fresh)).identifier).toBe("PRG-3");
    await expectIdentifiersUnique(t);
  });

  it("project codes are valid identifier keys, unique against projects and the org key", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    await admin.mutation(api.tasks.create, { title: "Sets the org key" }); // KONV
    const base = { clientId: f.arloClient, billingType: "t_and_m" as const };

    const suggested = await admin.mutation(api.projects.create, { ...base, name: "Website relaunch" });
    const code = (await t.run(async (ctx) => await ctx.db.get(suggested)))!.code;
    expect(isValidIdentifierKey(code)).toBe(true);
    expect(["ARLO", "PRAG", "KONV"]).not.toContain(code);
    expect(isValidIdentifierKey(await admin.query(api.projects.nextCode, {}))).toBe(true);

    await expect(admin.mutation(api.projects.create, { ...base, name: "Bad", code: "PRJ-001" })).rejects.toThrow(
      "not valid",
    );
    await expect(admin.mutation(api.projects.create, { ...base, name: "Dup", code: "arlo" })).rejects.toThrow(
      "already in use",
    );
    await expect(admin.mutation(api.projects.create, { ...base, name: "Org", code: "KONV" })).rejects.toThrow(
      "already in use",
    );
    await expect(admin.mutation(api.projects.update, { id: f.arlo, code: "AR-LO" })).rejects.toThrow("not valid");
    // Re-sending a legacy code unchanged is not a rename.
    await admin.mutation(api.projects.update, { id: f.legacy, code: "PRJ-007", name: "Legacy renamed" });
  });
});

// ─── T6 ─────────────────────────────────────────────────────────────────────

describe("T6: caches equal edges, counters equal recomputation", () => {
  it("holds after a randomized sequence of writes", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const r = rng(42);
    const users = [f.admin, f.alice, f.bob];
    const labels = [f.bug, f.feature];
    const tasks: Id<"tasks">[] = [];
    for (let i = 0; i < 3; i++) {
      tasks.push(await admin.mutation(api.tasks.create, { title: `Root ${i}`, projectId: f.arlo }));
    }
    const comments: Id<"comments">[] = [];
    const entries: Id<"timeEntries">[] = [];
    const ops = [
      "assignees", "labels", "comment", "uncomment", "subtask", "status", "archive", "restore",
      "log", "edit", "unlog", "addAssignee", "removeAssignee",
    ] as const;

    for (let step = 0; step < 60; step++) {
      const id = r.pick(tasks);
      const task = await getTask(t, id);
      switch (r.pick(ops)) {
        case "assignees":
          await admin.mutation(api.tasks.update, { id, assigneeIds: r.subset(users) });
          break;
        case "labels":
          await admin.mutation(api.tasks.update, { id, labelIds: r.subset(labels) });
          break;
        case "addAssignee":
          await admin.mutation(api.tasks.bulkUpdate, { taskIds: [id], action: { type: "addAssignee", userId: r.pick(users) } });
          break;
        case "removeAssignee":
          await admin.mutation(api.tasks.bulkUpdate, { taskIds: [id], action: { type: "removeAssignee", userId: r.pick(users) } });
          break;
        case "comment":
          comments.push(await admin.mutation(api.comments.create, { taskId: id, content: doc(`c${step}`) }));
          break;
        case "uncomment":
          if (comments.length > 0) {
            await admin.mutation(api.comments.remove, { id: comments.splice(Math.floor(r.next() * comments.length), 1)[0] });
          }
          break;
        case "subtask":
          if (!task.parentTaskId && !task.archivedAt) {
            tasks.push(await admin.mutation(api.tasks.createSubtask, { parentTaskId: id, title: `Sub ${step}` }));
          }
          break;
        case "status":
          await admin.mutation(api.tasks.update, { id, statusId: r.pick(Object.values(f.status)) });
          break;
        case "archive":
          await admin.mutation(api.tasks.archive, { id });
          break;
        case "restore":
          if (task.archivedAt) await admin.mutation(api.tasks.restore, { id });
          break;
        case "log":
          if (!task.archivedAt) {
            entries.push(await admin.mutation(api.timeEntries.create, {
              taskId: id, durationMinutes: 5 + Math.floor(r.next() * 60), startedAt: Date.now(), isBillable: false,
            }));
          }
          break;
        case "edit":
          if (entries.length > 0) {
            const target = r.pick(tasks.filter((x) => x !== id));
            const targetDoc = await getTask(t, target);
            await admin.mutation(api.timeEntries.update, {
              id: r.pick(entries),
              durationMinutes: 10 + Math.floor(r.next() * 30),
              ...(targetDoc.archivedAt ? {} : { taskId: target }),
            });
          }
          break;
        case "unlog":
          if (entries.length > 0) {
            await admin.mutation(api.timeEntries.remove, { id: entries.splice(Math.floor(r.next() * entries.length), 1)[0] });
          }
          break;
      }
    }

    for (const id of tasks) await expectTaskInvariants(t, id);
  });
});

// ─── T8 ─────────────────────────────────────────────────────────────────────

describe("T8: archive/restore cascade and delete", () => {
  it("restore brings back exactly the sub-tasks the archive cascaded to", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, { title: "Parent", projectId: f.arlo });
    const early = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Archived first" });
    const later = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Cascaded" });
    await admin.mutation(api.tasks.archive, { id: early });
    expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 1 });

    await admin.mutation(api.tasks.archive, { id: parent });
    expect((await getTask(t, later)).archivedAt).toBe((await getTask(t, parent)).archivedAt);
    expect((await getTask(t, early)).archivedAt).toBeLessThanOrEqual((await getTask(t, parent)).archivedAt!);

    await admin.mutation(api.tasks.restore, { id: parent });
    expect((await getTask(t, parent)).archivedAt).toBeUndefined();
    expect((await getTask(t, later)).archivedAt).toBeUndefined();
    if ((await getTask(t, early)).archivedAt !== undefined) {
      expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 1 });
    }
    expect(await activityTypes(t, later)).toEqual(expect.arrayContaining(["task_archived", "task_restored"]));
    await expectTaskInvariants(t, parent);
  });

  it("remove deletes the tree with its edges and aliases", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, {
      title: "Doomed", projectId: f.arlo, assigneeIds: [f.alice], labelIds: [f.bug],
    });
    const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Child" });
    await admin.mutation(api.tasks.update, { id: parent, projectId: f.prag }); // creates aliases
    await admin.mutation(api.tasks.remove, { id: parent });

    const left = await t.run(async (ctx) => ({
      tasks: await ctx.db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).collect(),
      assignees: await ctx.db.query("taskAssignees").collect(),
      labels: await ctx.db.query("taskLabels").collect(),
      aliases: await ctx.db.query("taskIdentifierAliases").collect(),
    }));
    expect(left.tasks.map((x) => x._id)).not.toContain(sub);
    expect(left.tasks).toHaveLength(0);
    expect(left.assignees).toHaveLength(0);
    expect(left.labels).toHaveLength(0);
    expect(left.aliases).toHaveLength(0);
  });

  it("deleting a sub-task updates the parent's counters", async () => {
    const t = createT();
    await setup(t);
    const admin = as(t, "admin");
    const parent = await admin.mutation(api.tasks.create, { title: "Parent" });
    const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: parent, title: "Child" });
    await admin.mutation(api.tasks.remove, { id: sub });
    expect(await getTask(t, parent)).toMatchObject({ subtaskCount: 0, subtaskDoneCount: 0 });
    expect(await activityTypes(t, parent)).toContain("subtask_deleted");
  });
});

// ─── T1: access matrix over the rewired mutations ──────────────────────────

type Outcome = "ok" | string;

async function outcome(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return "ok";
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    return typeof data === "string" ? data : (error as Error).message;
  }
}

/** A task (ARLO) assigned to Alice with one sub-task, plus an archived copy. */
async function accessFixture(t: T) {
  const f = await setup(t);
  const admin = as(t, "admin");
  const task = await admin.mutation(api.tasks.create, { title: "Shared", projectId: f.arlo, assigneeIds: [f.alice] });
  const sub = await admin.mutation(api.tasks.createSubtask, { parentTaskId: task, title: "Sub" });
  const archived = await admin.mutation(api.tasks.create, { title: "Old", projectId: f.arlo, assigneeIds: [f.alice] });
  await admin.mutation(api.tasks.archive, { id: archived });
  return { f, task, sub, archived };
}

const CALLERS: Caller[] = ["admin", "assigned", "unassigned", "otherOrg"];
const DENIED = { unassigned: "Task not found", otherOrg: "Task not found" } as const;

describe("T1: access matrix for every rewired public mutation", () => {
  const cases: Array<{
    name: string;
    expected: Record<Caller, Outcome>;
    run: (t: T, caller: Caller, x: Awaited<ReturnType<typeof accessFixture>>) => Promise<unknown>;
  }> = [
    {
      name: "tasks.update (title)",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, title: `Renamed by ${c}` }),
    },
    {
      name: "tasks.update (billable) — admin-only field",
      expected: { admin: "ok", assigned: "Only admins can change the task's billable", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, billable: false }),
    },
    {
      name: "tasks.update (project) — admin-only field",
      expected: { admin: "ok", assigned: "Only admins can change the task's project", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, projectId: x.f.prag }),
    },
    {
      name: "tasks.update (workCategory) — admin-only field",
      expected: { admin: "ok", assigned: "Only admins can change the task's workCategory", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, workCategoryId: x.f.design }),
    },
    {
      name: "tasks.update (remove the last assignee)",
      expected: { admin: "ok", assigned: "A task must keep at least one assignee", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, assigneeIds: [] }),
    },
    {
      name: "tasks.update (add an assignee)",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.update, { id: x.task, assigneeIds: [x.f.alice, x.f.bob] }),
    },
    {
      name: "tasks.updateDescription",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.updateDescription, { id: x.task, description: JSON.stringify(doc(c)) }),
    },
    {
      name: "tasks.createSubtask",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.createSubtask, { parentTaskId: x.task, title: "New sub" }),
    },
    {
      name: "tasks.reorderSubtasks",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.reorderSubtasks, { parentTaskId: x.task, orderedIds: [x.sub] }),
    },
    {
      name: "tasks.archive",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.archive, { id: x.task }),
    },
    {
      name: "tasks.restore",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.restore, { id: x.archived }),
    },
    {
      name: "tasks.remove",
      expected: { admin: "ok", assigned: "Only admins can delete tasks", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.remove, { id: x.task }),
    },
    {
      name: "tasks.duplicate",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.duplicate, { id: x.task }),
    },
    {
      name: "tasks.reorderTask",
      expected: { admin: "ok", assigned: "ok", ...DENIED },
      run: (t, c, x) => as(t, c).mutation(api.tasks.reorderTask, { taskId: x.task }),
    },
    {
      name: "tasks.create in this org's project",
      expected: { admin: "ok", assigned: "ok", unassigned: "ok", otherOrg: "Project not found" },
      run: (t, c, x) => as(t, c).mutation(api.tasks.create, { title: "New", projectId: x.f.arlo }),
    },
    {
      name: "planner.createTaskWithSegment in this org's project (own row)",
      expected: { admin: "ok", assigned: "ok", unassigned: "ok", otherOrg: "Project not found" },
      run: async (t, c, x) => {
        const self = { admin: x.f.admin, assigned: x.f.alice, unassigned: x.f.bob, otherOrg: x.f.other }[c];
        return await as(t, c).mutation(api.planner.createTaskWithSegment, {
          title: "Drawn", projectId: x.f.arlo, userId: self, startDate: "2026-10-19", endDate: "2026-10-19",
        });
      },
    },
    {
      name: "planner.createTodayTask in this org's project",
      expected: { admin: "ok", assigned: "ok", unassigned: "ok", otherOrg: "Project not found" },
      run: (t, c, x) => as(t, c).mutation(api.planner.createTodayTask, { title: "Today", projectId: x.f.arlo }),
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      for (const caller of CALLERS) {
        const t = createT();
        const x = await accessFixture(t);
        expect({ caller, outcome: await outcome(() => testCase.run(t, caller, x)) }).toEqual({
          caller,
          outcome: testCase.expected[caller],
        });
      }
    });
  }

  it("tasks.bulkUpdate skips tasks the caller cannot reach and applies member-allowed actions", async () => {
    for (const caller of CALLERS) {
      const t = createT();
      const x = await accessFixture(t);
      const result = await as(t, caller).mutation(api.tasks.bulkUpdate, {
        taskIds: [x.task],
        action: { type: "status", statusId: x.f.status.Done },
      });
      const reachable = caller === "admin" || caller === "assigned";
      expect({ caller, updated: result.updated, skipped: result.skipped.map((s) => s.reason) }).toEqual({
        caller,
        updated: reachable ? 1 : 0,
        skipped: reachable ? [] : ["Task not found"],
      });
    }
  });

  it("tasks.bulkUpdate keeps admin-only actions admin-only", async () => {
    const t = createT();
    const x = await accessFixture(t);
    const member = as(t, "assigned");
    const project = await member.mutation(api.tasks.bulkUpdate, {
      taskIds: [x.task], action: { type: "project", projectId: x.f.prag },
    });
    const remove = await member.mutation(api.tasks.bulkUpdate, { taskIds: [x.task], action: { type: "delete" } });
    const unassignOther = await member.mutation(api.tasks.bulkUpdate, {
      taskIds: [x.task], action: { type: "removeAssignee", userId: x.f.alice },
    });
    expect(project.skipped.map((s) => s.reason)).toEqual(["Only admins can change the project"]);
    expect(remove.skipped.map((s) => s.reason)).toEqual(["Only admins can delete tasks"]);
    expect(unassignOther.skipped.map((s) => s.reason)).toEqual(["A task must keep at least one assignee"]);
    expect((await getTask(t, x.task)).projectId).toBe(x.f.arlo);
  });
});

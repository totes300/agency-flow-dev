// @vitest-environment edge-runtime
//
// Tasks refactor slice 0: the foundations reseed (convex/devSeedTasks.ts)
// reshapes a legacy org into the §4 model. Asserts the invariants the later
// slices rely on: one default status per category, unique identifiers per
// org, caches == edges (T6), statusCategory == status.category (T3),
// completedAt iff closed (T4) — and that a second run changes nothing.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { DEMO_TASKS, DEFAULT_LABEL_SEED, seedTaskFoundations } from "../devSeedTasks";
import {
  DEFAULT_STATUS_SEED,
  TASK_CATEGORIES,
  isClosedCategory,
  isValidIdentifierKey,
  parseIdentifier,
} from "../tasks/model";
import { DEFAULT_STATUSES } from "../lib/constants";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_seed";
const OTHER_ORG_ID = "org_seed_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Legacy = {
  admin: Id<"users">;
  members: Id<"users">[];
  projects: Id<"projects">[];
  trackedTask: Id<"tasks">;
  doneTask: Id<"tasks">;
  parentTask: Id<"tasks">;
  otherOrgTask: Id<"tasks">;
};

/** A pre-refactor org: legacy statuses, PRJ-NNN codes, old-shape tasks only. */
async function seedLegacyOrg(t: T): Promise<Legacy> {
  return await t.run(async (ctx) => {
    const base = Date.UTC(2026, 5, 1);
    const mkUser = async (name: string) =>
      await ctx.db.insert("users", { name, externalId: `clerk_${name}`, createdAt: base, updatedAt: base });
    const admin = await mkUser("admin");
    const m1 = await mkUser("m1");
    const m2 = await mkUser("m2");
    for (const [i, [userId, role]] of ([[admin, "admin"], [m1, "member"], [m2, "member"]] as const).entries()) {
      await ctx.db.insert("orgMembers", {
        orgId: ORG_ID, clerkUserId: `clerk_${i}`, userId, role, joinedAt: base + i,
      });
    }
    await ctx.db.insert("orgSettings", {
      orgId: ORG_ID, defaultCurrency: "USD", timezone: "Europe/Budapest", roundingMinutes: 15,
      brandName: "Konverted", createdAt: base, updatedAt: base, createdBy: admin,
    });

    const statusIds = new Map<string, Id<"statuses">>();
    for (const s of DEFAULT_STATUSES) {
      statusIds.set(
        s.name,
        await ctx.db.insert("statuses", {
          orgId: ORG_ID, name: s.name, color: s.color, type: s.type, sortOrder: s.sortOrder,
          createdAt: base, updatedAt: base, createdBy: admin,
        }),
      );
    }
    // An org-custom status that is not one of the defaults.
    statusIds.set(
      "QA",
      await ctx.db.insert("statuses", {
        orgId: ORG_ID, name: "QA", color: "teal", type: "review", sortOrder: 7,
        createdAt: base, updatedAt: base, createdBy: admin,
      }),
    );

    const arlow = await ctx.db.insert("clients", {
      orgId: ORG_ID, name: "Arlow", currency: "USD", createdAt: base, updatedAt: base, createdBy: admin,
    });
    const prag = await ctx.db.insert("clients", {
      orgId: ORG_ID, name: "Pragmatico", currency: "USD", prefix: "prag",
      createdAt: base, updatedAt: base, createdBy: admin,
    });
    const mkProject = async (clientId: Id<"clients">, name: string, code: string, at: number) =>
      await ctx.db.insert("projects", {
        orgId: ORG_ID, clientId, name, code, billingType: "t_and_m",
        createdAt: at, updatedAt: at, createdBy: admin,
      });
    const p1 = await mkProject(arlow, "Arlow monthly retainer", "PRJ-001", base);
    const p2 = await mkProject(prag, "Pragmatico site", "PRJ-002", base + 1);
    const p3 = await mkProject(arlow, "Arlow app", "PRJ-003", base + 2);

    let n = 0;
    const mkTask = async (fields: {
      title: string;
      status: string;
      projectId?: Id<"projects">;
      assigneeIds: Id<"users">[];
      parentTaskId?: Id<"tasks">;
      sortOrder?: number;
      archivedAt?: number;
      estimate?: number;
      description?: string;
    }) => {
      const statusId = statusIds.get(fields.status)!;
      const status = (await ctx.db.get(statusId))!;
      const at = base + 1000 * ++n;
      return await ctx.db.insert("tasks", {
        orgId: ORG_ID,
        title: fields.title,
        description: fields.description,
        statusId,
        statusType: status.type,
        projectId: fields.projectId,
        assigneeIds: fields.assigneeIds,
        billable: true,
        estimate: fields.estimate,
        parentTaskId: fields.parentTaskId,
        sortOrder: fields.sortOrder,
        manualSortKey: fields.parentTaskId ? undefined : `a${n}`,
        archivedAt: fields.archivedAt,
        createdAt: at,
        updatedAt: at + 500,
        createdBy: admin,
      });
    };

    const trackedTask = await mkTask({
      title: "Landing page", status: "In progress", projectId: p1, assigneeIds: [m1], estimate: 120,
      description: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Scope" }] }] }),
    });
    const doneTask = await mkTask({ title: "Kickoff", status: "Done", projectId: p1, assigneeIds: [admin] });
    const parentTask = await mkTask({ title: "Site build", status: "Next up", projectId: p2, assigneeIds: [m2] });
    await mkTask({ title: "Sub B", status: "Inbox", projectId: p2, assigneeIds: [m2], parentTaskId: parentTask, sortOrder: 1 });
    await mkTask({ title: "Sub A", status: "Done", projectId: p2, assigneeIds: [m2], parentTaskId: parentTask, sortOrder: 0 });
    await mkTask({ title: "QA pass", status: "QA", projectId: p3, assigneeIds: [m1] });
    await mkTask({ title: "Stuck thing", status: "Stuck", projectId: p3, assigneeIds: [m1, m2] });
    await mkTask({ title: "Internal wiki", status: "Inbox", assigneeIds: [admin] });
    await mkTask({ title: "Old archived", status: "Admin review", projectId: p1, assigneeIds: [m1], archivedAt: base });
    await mkTask({ title: "Unassigned idea", status: "Inbox", projectId: p1, assigneeIds: [] });
    for (let i = 0; i < 6; i++) {
      await mkTask({ title: `Retainer task ${i}`, status: "In progress", projectId: p1, assigneeIds: [i % 2 ? m1 : m2] });
    }

    for (const [i, minutes] of [30, 45].entries()) {
      await ctx.db.insert("timeEntries", {
        orgId: ORG_ID, projectId: p1, taskId: trackedTask, userId: m1, date: "2026-06-02",
        startedAt: base + i, durationMinutes: minutes, isBillable: true, method: "manual",
        costRate: 0, billableRate: 0, rateCurrency: "USD", createdAt: base, updatedAt: base, createdBy: m1,
      });
    }
    for (const [i, userId] of [m1, admin].entries()) {
      await ctx.db.insert("comments", {
        taskId: trackedTask, orgId: ORG_ID, userId, content: { type: "doc" },
        createdAt: base + 50_000 + i, updatedAt: base + 50_000 + i,
      });
    }

    // Another org that must stay untouched.
    const other = await mkUser("other");
    await ctx.db.insert("orgSettings", {
      orgId: OTHER_ORG_ID, defaultCurrency: "USD", timezone: "UTC", roundingMinutes: 1,
      createdAt: base, updatedAt: base, createdBy: other,
    });
    const otherStatus = await ctx.db.insert("statuses", {
      orgId: OTHER_ORG_ID, name: "Todo", color: "gray", type: "backlog", sortOrder: 0,
      createdAt: base, updatedAt: base, createdBy: other,
    });
    const otherOrgTask = await ctx.db.insert("tasks", {
      orgId: OTHER_ORG_ID, title: "Theirs", statusId: otherStatus, statusType: "backlog",
      assigneeIds: [other], billable: true, createdAt: base, updatedAt: base, createdBy: other,
    });

    return { admin, members: [admin, m1, m2], projects: [p1, p2, p3], trackedTask, doneTask, parentTask, otherOrgTask };
  });
}

type Snapshot = {
  statuses: Doc<"statuses">[];
  tasks: Doc<"tasks">[];
  projects: Doc<"projects">[];
  settings: Doc<"orgSettings">;
  labels: Doc<"labels">[];
  assigneeEdges: Doc<"taskAssignees">[];
  labelEdges: Doc<"taskLabels">[];
};

async function snapshot(t: T, orgId = ORG_ID): Promise<Snapshot> {
  return await t.run(async (ctx) => ({
    statuses: await ctx.db.query("statuses").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    tasks: await ctx.db.query("tasks").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    projects: await ctx.db.query("projects").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect(),
    settings: (await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).unique())!,
    labels: await ctx.db.query("labels").withIndex("by_orgId_position", (q) => q.eq("orgId", orgId)).collect(),
    assigneeEdges: (await ctx.db.query("taskAssignees").collect()).filter((e) => e.orgId === orgId),
    labelEdges: (await ctx.db.query("taskLabels").collect()).filter((e) => e.orgId === orgId),
  }));
}

/** The invariants every seeded org must satisfy. */
function expectInvariants(s: Snapshot) {
  // Statuses: category + position everywhere, ≥1 active and exactly one default per category.
  for (const status of s.statuses) {
    expect(status.category, status.name).toBeDefined();
    expect(status.position, status.name).toBeDefined();
  }
  for (const category of TASK_CATEGORIES) {
    const active = s.statuses.filter((x) => x.category === category && !x.archivedAt);
    expect(active.length, category).toBeGreaterThan(0);
    expect(active.filter((x) => x.isDefault).length, category).toBe(1);
    const positions = active.map((x) => x.position!);
    expect(new Set(positions).size, category).toBe(positions.length);
  }

  // Keys: org key + project codes are valid and pairwise distinct.
  const keys = [s.settings.taskKey!, ...s.projects.map((p) => p.code)];
  for (const key of keys) expect(isValidIdentifierKey(key), key).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);

  const statusById = new Map(s.statuses.map((x) => [x._id, x]));
  const projectById = new Map(s.projects.map((p) => [p._id, p]));
  const identifiers = new Set<string>();
  const numbersByScope = new Map<string, number[]>();

  for (const task of s.tasks) {
    const label = task.title;
    // Identifier: unique per org, key matches the scope, number matches.
    expect(task.identifier, label).toBeDefined();
    expect(identifiers.has(task.identifier!), `duplicate ${task.identifier}`).toBe(false);
    identifiers.add(task.identifier!);
    const parsed = parseIdentifier(task.identifier!)!;
    expect(parsed.number, label).toBe(task.number);
    if (task.projectId) {
      expect(task.numberScope, label).toEqual({ kind: "project", projectId: task.projectId });
      expect(parsed.key, label).toBe(projectById.get(task.projectId)!.code);
      expect(task.clientId, label).toBe(projectById.get(task.projectId)!.clientId);
    } else {
      expect(task.numberScope, label).toEqual({ kind: "org" });
      expect(parsed.key, label).toBe(s.settings.taskKey);
      expect(task.clientId, label).toBeUndefined();
    }
    const scopeKey = task.projectId ?? "org";
    numbersByScope.set(scopeKey, [...(numbersByScope.get(scopeKey) ?? []), task.number!]);

    // T3 + T4.
    const status = statusById.get(task.statusId)!;
    expect(task.statusCategory, label).toBe(status.category);
    expect(task.completedAt !== undefined, label).toBe(isClosedCategory(status.category!));
    // Legacy field still mirrors the status for the old UI.
    expect(task.statusType, label).toBe(status.type);

    // T6: caches == edges.
    const userEdges = s.assigneeEdges.filter((e) => e.taskId === task._id).map((e) => e.userId);
    expect([...userEdges].sort(), label).toEqual([...task.assigneeIds].sort());
    expect(new Set(userEdges).size, label).toBe(userEdges.length);
    const labelEdges = s.labelEdges.filter((e) => e.taskId === task._id).map((e) => e.labelId);
    expect([...labelEdges].sort(), label).toEqual([...(task.labelIds ?? [])].sort());
    expect(task.labelIds, label).toBeDefined();

    expect(task.priority, label).toBeGreaterThanOrEqual(0);
    expect(task.priority, label).toBeLessThanOrEqual(4);
    expect(task.sortKey, label).toBeDefined();
    expect(task.hasDescription, label).toBeDefined();
    expect(task.trackedMinutes, label).toBeDefined();
    expect(task.commentCount, label).toBeDefined();
    expect(task.subtaskCount, label).toBeDefined();
    expect(task.lastActivityAt, label).toBeDefined();
  }

  // Numbers are unique per scope (gaps from deleted tasks are never reused);
  // counters point past the highest.
  for (const [scopeKey, numbers] of numbersByScope) {
    expect(new Set(numbers).size, scopeKey).toBe(numbers.length);
    const next =
      scopeKey === "org"
        ? s.settings.nextTaskNumber
        : projectById.get(scopeKey as Id<"projects">)!.nextTaskNumber;
    expect(next, scopeKey).toBe(Math.max(...numbers) + 1);
  }
  for (const p of s.projects) {
    if (!numbersByScope.has(p._id)) expect(p.nextTaskNumber).toBe(1);
  }

  // No edges point at tasks outside the org.
  const taskIds = new Set(s.tasks.map((x) => x._id));
  for (const e of [...s.assigneeEdges, ...s.labelEdges]) expect(taskIds.has(e.taskId)).toBe(true);
}

describe("devSeedTasks: legacy org", () => {
  it("reshapes the org and satisfies every invariant", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    const result = await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });

    expect(result.orgId).toBe(ORG_ID);
    expect(result.orgKey).toBe("KONV");
    expect(result.statusesCreated).toBe(1); // only Canceled was missing
    expect(result.demoTasksCreated).toBe(DEMO_TASKS.length);
    expect(result.labelsCreated).toBe(DEFAULT_LABEL_SEED.length);

    const s = await snapshot(t);
    expectInvariants(s);
    // A first run numbers every scope 1..n in creation order.
    const p1Numbers = s.tasks
      .filter((x) => x.projectId === legacy.projects[0])
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((x) => x.number);
    expect(p1Numbers).toEqual(p1Numbers.map((_, i) => i + 1));

    // Statuses: defaults mapped by name, custom QA by legacy type.
    const byName = new Map(s.statuses.map((x) => [x.name, x]));
    for (const seed of DEFAULT_STATUS_SEED) {
      expect(byName.get(seed.name)?.category, seed.name).toBe(seed.category);
      expect(byName.get(seed.name)?.isDefault ?? false, seed.name).toBe(seed.isDefault);
    }
    expect(byName.get("QA")).toMatchObject({ category: "started", isDefault: false });
    // Position order within Started follows the legacy sortOrder.
    const started = s.statuses
      .filter((x) => x.category === "started")
      .sort((a, b) => (a.position! < b.position! ? -1 : 1))
      .map((x) => x.name);
    expect(started).toEqual(["In progress", "Admin review", "Client review", "Stuck", "QA"]);

    // Project codes: client prefix first, then derived, then de-duplicated.
    expect(result.projectsRecoded.map((r) => `${r.from}→${r.to}`)).toEqual([
      "PRJ-001→ARLO",
      "PRJ-002→PRAG",
      "PRJ-003→ARLO2",
    ]);

    const task = (id: Id<"tasks">) => s.tasks.find((x) => x._id === id)!;
    expect(task(legacy.trackedTask)).toMatchObject({
      identifier: "ARLO-1",
      trackedMinutes: 75,
      commentCount: 2,
      estimateMinutes: 120,
      hasDescription: true,
      lastActivity: { kind: "comment", actorId: legacy.admin },
    });
    expect(task(legacy.doneTask).completedAt).toBe(task(legacy.doneTask).updatedAt);
    expect(task(legacy.parentTask)).toMatchObject({ identifier: "PRAG-1", subtaskCount: 2, subtaskDoneCount: 1 });

    // Sub-tasks keep their sortOrder sequence in the new global sortKey.
    const subs = s.tasks
      .filter((x) => x.parentTaskId === legacy.parentTask)
      .sort((a, b) => (a.sortKey! < b.sortKey! ? -1 : 1))
      .map((x) => x.title);
    expect(subs).toEqual(["Sub A", "Sub B"]);

    // Org-level tasks use the org key; demo tasks cover canceled + multi-assignee.
    const orgTasks = s.tasks.filter((x) => !x.projectId).map((x) => x.identifier).sort();
    expect(orgTasks).toEqual(["KONV-1", "KONV-2", "KONV-3", "KONV-4"]);
    const statusName = (id: Id<"statuses">) => s.statuses.find((x) => x._id === id)!.name;
    const retro = s.tasks.find((x) => x.title === "Plan the Q4 internal retro")!;
    expect(statusName(retro.statusId)).toBe("In progress"); // the Started default
    const canceled = s.tasks.find((x) => x.title === "Evaluate a new invoicing tool")!;
    expect(canceled.statusCategory).toBe("canceled");
    expect(canceled.statusType).toBe("done");

    // Demo coverage: several multi-assignee tasks, labels in use, varied priorities.
    expect(s.tasks.filter((x) => x.assigneeIds.length >= 2).length).toBeGreaterThanOrEqual(3);
    expect(result.secondAssigneesAdded).toBeGreaterThan(0);
    expect(s.tasks.filter((x) => (x.labelIds ?? []).length > 0).length).toBeGreaterThan(2);
    expect(s.tasks.some((x) => (x.labelIds ?? []).length >= 2)).toBe(true);
    expect(new Set(s.tasks.map((x) => x.priority)).size).toBeGreaterThanOrEqual(4);

    // Legacy fields keep the old UI working.
    for (const x of s.tasks.filter((x) => !x.parentTaskId)) expect(x.manualSortKey, x.title).toBeDefined();
    for (const x of s.statuses) expect(x.type, x.name).toBeDefined();
  });

  it("is idempotent", async () => {
    const t = createT();
    await seedLegacyOrg(t);
    await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    const first = await snapshot(t);

    const second = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    expect(second).toMatchObject({
      statusesCreated: 0,
      statusesUpdated: 0,
      projectsRecoded: [],
      labelsCreated: 0,
      demoTasksCreated: 0,
      tasksUpdated: 0,
      secondAssigneesAdded: 0,
      edgesInserted: 0,
      edgesDeleted: 0,
      aliasesCreated: 0,
      danglingProjectsCleared: 0,
    });
    const after = await snapshot(t);
    expectInvariants(after);
    expect(after).toEqual(first);
  });

  it("repairs drifted caches and edges, and aliases a changed identifier", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    await t.run(async (ctx) => {
      const [p1] = legacy.projects;
      await ctx.db.patch(p1, { code: "ARL" }); // a code rename
      const stray = await ctx.db
        .query("taskAssignees")
        .withIndex("by_taskId_userId", (q) => q.eq("taskId", legacy.trackedTask))
        .first();
      // A duplicate edge (T6 drift).
      await ctx.db.insert("taskAssignees", {
        orgId: stray!.orgId,
        taskId: stray!.taskId,
        userId: stray!.userId,
        assignedAt: stray!.assignedAt,
        assignedBy: stray!.assignedBy,
      });
    });
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    expect(result.edgesDeleted).toBe(1);
    expect(result.aliasesCreated).toBeGreaterThan(0);

    const s = await snapshot(t);
    expectInvariants(s);
    const tracked = s.tasks.find((x) => x._id === legacy.trackedTask)!;
    expect(tracked.identifier).toBe("ARL-1");
    const alias = await t.run(async (ctx) =>
      ctx.db
        .query("taskIdentifierAliases")
        .withIndex("by_orgId_identifier", (q) => q.eq("orgId", ORG_ID).eq("identifier", "ARLO-1"))
        .unique(),
    );
    expect(alias?.taskId).toBe(legacy.trackedTask);
  });

  it("never touches another org", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    const before = await t.run(async (ctx) => ctx.db.get(legacy.otherOrgTask));
    await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    const after = await snapshot(t, OTHER_ORG_ID);
    expect(after.tasks).toEqual([before]);
    expect(after.assigneeEdges).toEqual([]);
    expect(after.labels).toEqual([]);
    expect(after.statuses.every((x) => x.category === undefined)).toBe(true);
  });

  it("requires an explicit org when several exist", async () => {
    const t = createT();
    await seedLegacyOrg(t);
    // The legacy fixture holds two orgs, so auto-detection must refuse.
    await expect(t.run(async (ctx) => seedTaskFoundations(ctx, {}))).rejects.toThrow("Multiple orgs");
  });
});

describe("devSeedTasks: repairs", () => {
  it("turns tasks of a hard-deleted project into org tasks and drops orphaned edges", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    const [, , p3] = legacy.projects;
    await t.run(async (ctx) => {
      // projects.remove deletes the project but keeps its tasks; tasks.remove
      // deletes a task but (until slice 1) not its edges.
      await ctx.db.delete(p3);
      await ctx.db.delete(legacy.doneTask);
    });
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    expect(result.danglingProjectsCleared).toBe(2);
    expect(result.edgesDeleted).toBeGreaterThanOrEqual(1);

    const s = await snapshot(t);
    expectInvariants(s);
    const qa = s.tasks.find((x) => x.title === "QA pass")!;
    expect(qa.projectId).toBeUndefined();
    expect(qa.identifier).toMatch(/^KONV-\d+$/);
    expect(s.assigneeEdges.some((e) => e.taskId === legacy.doneTask)).toBe(false);
  });
});

describe("devSeedTasks: fresh org", () => {
  it("creates the §4.1 default statuses and numbers demo tasks with the org key", async () => {
    const t = createT();
    await t.run(async (ctx) => {
      const now = Date.now();
      const admin = await ctx.db.insert("users", { name: "A", externalId: "clerk_a", createdAt: now, updatedAt: now });
      const member = await ctx.db.insert("users", { name: "B", externalId: "clerk_b", createdAt: now, updatedAt: now });
      await ctx.db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: "clerk_a", userId: admin, role: "admin", joinedAt: 1 });
      await ctx.db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: "clerk_b", userId: member, role: "member", joinedAt: 2 });
      await ctx.db.insert("orgSettings", {
        orgId: ORG_ID, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 1,
        createdAt: now, updatedAt: now, createdBy: admin,
      });
    });
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgKey: "KON" }));
    expect(result.statusesCreated).toBe(DEFAULT_STATUS_SEED.length);

    const s = await snapshot(t);
    expectInvariants(s);
    const ordered = TASK_CATEGORIES.flatMap((category) =>
      s.statuses
        .filter((x) => x.category === category)
        .sort((a, b) => (a.position! < b.position! ? -1 : 1))
        .map((x) => `${x.name}${x.isDefault ? "*" : ""}`),
    );
    expect(ordered).toEqual([
      "Inbox*",
      "Next up*",
      "In progress*",
      "Admin review",
      "Client review",
      "Stuck",
      "Done*",
      "Canceled*",
    ]);
    expect(s.tasks.map((x) => x.identifier).sort()).toEqual(["KON-1", "KON-2", "KON-3"]);
    expect(s.settings).toMatchObject({ taskKey: "KON", nextTaskNumber: 4 });
    const retro = s.tasks.find((x) => x.title === "Plan the Q4 internal retro")!;
    expect(retro.assigneeIds).toHaveLength(2);
  });
});

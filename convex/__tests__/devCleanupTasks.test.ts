// @vitest-environment edge-runtime
//
// Tasks refactor slice 7b: `devCleanupTasks:stripLegacy` turns an org that
// still holds pre-refactor rows (legacy status types, `PRJ-042` codes,
// `statusType` / `manualSortKey` / `sortOrder` / `estimate` on tasks, rows
// without identifiers or counters, `taskMutes` / `taskViewReceipts`, legacy
// settings and user fields) into rows the NARROWED schema accepts. The legacy
// rows are inserted with schema validation off (they are invalid for the
// narrowed schema); every row is then checked against `convex/schema.ts`.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable, type GenericDatabaseWriter, type GenericDataModel } from "convex/server";
import { v, type Value } from "convex/values";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  LEGACY_SETTINGS_FIELDS,
  LEGACY_STATUS_FIELDS,
  LEGACY_TASK_FIELDS,
  LEGACY_USER_FIELDS,
  type StripLegacyResult,
} from "../devCleanupTasks";
import { createTask } from "../tasks/write";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { expectInvariants, expectRowsMatchSchema, snapshotOrg } from "./helpers/orgSnapshot";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_cleanup";
const OTHER_ORG_ID = "org_cleanup_other";

/** The current tables + the two retired ones, validation off (legacy rows are invalid on purpose). */
const legacyTolerantSchema = defineSchema(
  {
    ...schema.tables,
    taskMutes: defineTable({ orgId: v.string(), taskId: v.id("tasks"), userId: v.id("users"), createdAt: v.number() })
      .index("by_orgId", ["orgId"]),
    taskViewReceipts: defineTable({ orgId: v.string(), taskId: v.id("tasks"), userId: v.id("users"), lastViewedAt: v.number() })
      .index("by_orgId", ["orgId"]),
  },
  { schemaValidation: false },
);

const createT = () => convexTest(legacyTolerantSchema, modules);
type T = ReturnType<typeof createT>;

const LEGACY_STATUSES = [
  { name: "Inbox", type: "backlog", color: "gray" },
  { name: "Next up", type: "in_progress", color: "blue" },
  { name: "In progress", type: "in_progress", color: "amber" },
  { name: "Admin review", type: "review", color: "purple" },
  { name: "Client review", type: "review", color: "coral" },
  { name: "Stuck", type: "blocked", color: "red" },
  { name: "Done", type: "done", color: "green" },
] as const;

type Legacy = {
  admin: Id<"users">;
  m1: Id<"users">;
  projects: Id<"projects">[];
  trackedTask: Id<"tasks">;
  doneTask: Id<"tasks">;
  parentTask: Id<"tasks">;
  modernTask: Id<"tasks">;
  otherOrgTask: Id<"tasks">;
};

/** A pre-refactor org, in the shapes the dev deployment may still hold. */
async function seedLegacyOrg(t: T): Promise<Legacy> {
  return await t.run(async (ctx) => {
    const raw = ctx.db as unknown as GenericDatabaseWriter<GenericDataModel>;
    // Legacy rows carry optional fields as `undefined` (dropped on insert).
    const db = { insert: (table: string, doc: Record<string, unknown>) => raw.insert(table, doc as Record<string, Value>) };
    const base = Date.UTC(2026, 5, 1);
    const mkUser = async (name: string, legacy: Record<string, unknown> = {}) =>
      (await db.insert("users", { name, externalId: `clerk_${name}`, createdAt: base, updatedAt: base, ...legacy })) as Id<"users">;
    const admin = await mkUser("admin", { taskDetailView: "modal", todayVisibleStatuses: ["backlog"] });
    const m1 = await mkUser("m1", { todayVisibleStatuses: [] });
    for (const [i, [userId, role]] of ([[admin, "admin"], [m1, "member"]] as const).entries()) {
      await db.insert("orgMembers", { orgId: ORG_ID, clerkUserId: `clerk_${i}`, userId, role, joinedAt: base + i });
    }

    const statusIds = new Map<string, Id<"statuses">>();
    for (const [i, s] of LEGACY_STATUSES.entries()) {
      statusIds.set(
        s.name,
        (await db.insert("statuses", {
          orgId: ORG_ID, name: s.name, color: s.color, type: s.type, sortOrder: i, icon: "circle",
          createdAt: base, updatedAt: base, createdBy: admin,
        })) as Id<"statuses">,
      );
    }
    statusIds.set(
      "QA",
      (await db.insert("statuses", {
        orgId: ORG_ID, name: "QA", color: "teal", type: "review", sortOrder: 7,
        createdAt: base, updatedAt: base, createdBy: admin,
      })) as Id<"statuses">,
    );
    await db.insert("orgSettings", {
      orgId: ORG_ID, defaultCurrency: "USD", timezone: "Europe/Budapest", roundingMinutes: 15,
      brandName: "Konverted", createdAt: base, updatedAt: base, createdBy: admin,
      defaultStatusId: statusIds.get("Inbox"),
      completionDefaultAdminStatusId: statusIds.get("Done"),
      completionDefaultMemberStatusId: statusIds.get("Admin review"),
      defaultMyTasksStatusIds: [statusIds.get("In progress")],
    });

    const arlow = (await db.insert("clients", {
      orgId: ORG_ID, name: "Arlow", currency: "USD", createdAt: base, updatedAt: base, createdBy: admin,
    })) as Id<"clients">;
    const prag = (await db.insert("clients", {
      orgId: ORG_ID, name: "Pragmatico", currency: "USD", prefix: "prag", createdAt: base, updatedAt: base, createdBy: admin,
    })) as Id<"clients">;
    const mkProject = async (clientId: Id<"clients">, name: string, code: string, at: number) =>
      (await db.insert("projects", {
        orgId: ORG_ID, clientId, name, code, billingType: "t_and_m", createdAt: at, updatedAt: at, createdBy: admin,
      })) as Id<"projects">;
    const p1 = await mkProject(arlow, "Arlow monthly retainer", "PRJ-001", base);
    const p2 = await mkProject(prag, "Pragmatico site", "PRJ-002", base + 1);

    let n = 0;
    const mkTask = async (fields: {
      title: string;
      status: string;
      projectId?: Id<"projects">;
      assigneeIds: Id<"users">[];
      parentTaskId?: Id<"tasks">;
      sortOrder?: number;
      estimate?: number;
      description?: string;
    }) => {
      const statusId = statusIds.get(fields.status)!;
      const type = LEGACY_STATUSES.find((s) => s.name === fields.status)?.type ?? "review";
      const at = base + 1000 * ++n;
      return (await db.insert("tasks", {
        orgId: ORG_ID,
        title: fields.title,
        description: fields.description,
        statusId,
        statusType: type,
        projectId: fields.projectId,
        assigneeIds: fields.assigneeIds,
        billable: true,
        estimate: fields.estimate,
        parentTaskId: fields.parentTaskId,
        sortOrder: fields.sortOrder,
        manualSortKey: fields.parentTaskId ? undefined : `a${n}`,
        createdAt: at,
        updatedAt: at + 500,
        createdBy: admin,
      })) as Id<"tasks">;
    };
    const trackedTask = await mkTask({
      title: "Landing page", status: "In progress", projectId: p1, assigneeIds: [m1], estimate: 120,
      description: JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Scope" }] }] }),
    });
    const doneTask = await mkTask({ title: "Kickoff", status: "Done", projectId: p1, assigneeIds: [admin] });
    const parentTask = await mkTask({ title: "Site build", status: "Next up", projectId: p2, assigneeIds: [m1] });
    await mkTask({ title: "Sub B", status: "Inbox", projectId: p2, assigneeIds: [m1], parentTaskId: parentTask, sortOrder: 1 });
    await mkTask({ title: "Sub A", status: "Done", projectId: p2, assigneeIds: [m1], parentTaskId: parentTask, sortOrder: 0 });
    await mkTask({ title: "QA pass", status: "QA", projectId: p1, assigneeIds: [m1, admin] });
    for (let i = 0; i < 6; i++) {
      await mkTask({ title: `Retainer task ${i}`, status: "Stuck", projectId: p1, assigneeIds: [m1] });
    }

    for (const [i, minutes] of [30, 45].entries()) {
      await db.insert("timeEntries", {
        orgId: ORG_ID, projectId: p1, taskId: trackedTask, userId: m1, date: "2026-06-02",
        startedAt: base + i, durationMinutes: minutes, isBillable: true, method: "manual",
        costRate: 0, billableRate: 0, rateCurrency: "USD", createdAt: base, updatedAt: base, createdBy: m1,
      });
    }
    await db.insert("comments", {
      taskId: trackedTask, orgId: ORG_ID, userId: admin, content: { type: "doc" }, createdAt: base + 50_000, updatedAt: base + 50_000,
    });
    await db.insert("taskMutes", { orgId: ORG_ID, taskId: trackedTask, userId: m1, createdAt: base });
    for (const userId of [admin, m1]) {
      await db.insert("taskViewReceipts", { orgId: ORG_ID, taskId: doneTask, userId, lastViewedAt: base });
    }

    // Another org that must stay untouched (it is cleaned by its own run).
    const other = await mkUser("other");
    await db.insert("orgSettings", {
      orgId: OTHER_ORG_ID, defaultCurrency: "USD", timezone: "UTC", roundingMinutes: 1,
      createdAt: base, updatedAt: base, createdBy: other,
    });
    const otherStatus = (await db.insert("statuses", {
      orgId: OTHER_ORG_ID, name: "Todo", color: "gray", type: "backlog", sortOrder: 0,
      createdAt: base, updatedAt: base, createdBy: other,
    })) as Id<"statuses">;
    const otherOrgTask = (await db.insert("tasks", {
      orgId: OTHER_ORG_ID, title: "Theirs", statusId: otherStatus, statusType: "backlog",
      assigneeIds: [other], billable: true, createdAt: base, updatedAt: base, createdBy: other,
    })) as Id<"tasks">;
    await db.insert("taskMutes", { orgId: OTHER_ORG_ID, taskId: otherOrgTask, userId: other, createdAt: base });

    return { admin, m1, projects: [p1, p2], trackedTask, doneTask, parentTask, modernTask: trackedTask, otherOrgTask };
  });
}

/** Runs the cleanup in small batches until nothing is left; returns every run's result. */
async function cleanUntilDone(t: T, batchSize = 4): Promise<StripLegacyResult[]> {
  const runs: StripLegacyResult[] = [];
  for (let i = 0; i < 20; i++) {
    const result = await t.mutation(internal.devCleanupTasks.stripLegacy, { orgId: ORG_ID, batchSize });
    runs.push(result);
    if (result.remaining === 0) return runs;
  }
  throw new Error("stripLegacy did not converge");
}

async function rawRows(t: T, table: string, orgId = ORG_ID): Promise<Record<string, unknown>[]> {
  return await t.run(async (ctx) => {
    const db = ctx.db as unknown as GenericDatabaseWriter<GenericDataModel>;
    return (await db.query(table).collect()).filter((r) => r.orgId === orgId) as Record<string, unknown>[];
  });
}

describe("devCleanupTasks.stripLegacy", () => {
  it("turns a legacy org into rows the narrowed schema accepts, in bounded runs", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    const runs = await cleanUntilDone(t);

    // Bounded: 12 tasks in batches of 4 take several runs, each reporting what is left.
    expect(runs.length).toBeGreaterThan(1);
    expect(runs[0].remaining).toBeGreaterThan(0);
    expect(runs.reduce((sum, r) => sum + r.tasksFixed, 0)).toBe(12);
    expect(runs.at(-1)).toMatchObject({ remaining: 0, tasksBlocked: 0 });
    expect(runs[0]).toMatchObject({ statusesCreated: 1, projectsRecoded: 2, orgSettingsFixed: 1, usersFixed: 2 });
    expect(runs.reduce((sum, r) => sum + r.taskMutesMigrated, 0)).toBe(1);
    expect(runs.reduce((sum, r) => sum + r.taskViewReceiptsDeleted, 0)).toBe(2);

    // Every row of the org passes the validators of convex/schema.ts and
    // carries no pre-refactor field.
    const statuses = await rawRows(t, "statuses");
    const tasks = await rawRows(t, "tasks");
    const settings = await rawRows(t, "orgSettings");
    const users = await t.run(async (ctx) => [(await ctx.db.get(legacy.admin))!, (await ctx.db.get(legacy.m1))!]);
    expectRowsMatchSchema("statuses", statuses);
    expectRowsMatchSchema("tasks", tasks);
    expectRowsMatchSchema("orgSettings", settings);
    expectRowsMatchSchema("users", users);
    expectRowsMatchSchema("projects", await rawRows(t, "projects"));
    for (const row of statuses) for (const f of LEGACY_STATUS_FIELDS) expect(row[f], `status.${f}`).toBeUndefined();
    for (const row of tasks) for (const f of LEGACY_TASK_FIELDS) expect(row[f], `task.${f}`).toBeUndefined();
    for (const row of settings) for (const f of LEGACY_SETTINGS_FIELDS) expect(row[f], `settings.${f}`).toBeUndefined();
    for (const row of users) for (const f of LEGACY_USER_FIELDS) expect((row as Record<string, unknown>)[f]).toBeUndefined();
    expect(await rawRows(t, "taskMutes")).toEqual([]);
    expect(await rawRows(t, "taskViewReceipts")).toEqual([]);

    // The §4 invariants hold (T3–T6, identifiers, one default per category).
    const s = await t.run(async (ctx) => snapshotOrg(ctx.db, ORG_ID));
    expectInvariants(s);

    // Statuses: defaults mapped by name, the custom QA by its legacy type,
    // order inside Started follows the legacy sortOrder, Canceled created.
    const byName = new Map(s.statuses.map((x) => [x.name, x]));
    for (const seed of DEFAULT_STATUS_SEED) {
      expect(byName.get(seed.name)?.category, seed.name).toBe(seed.category);
      expect(byName.get(seed.name)?.isDefault, seed.name).toBe(seed.isDefault);
    }
    expect(byName.get("QA")).toMatchObject({ category: "started", isDefault: false });
    const started = s.statuses
      .filter((x) => x.category === "started")
      .sort((a, b) => (a.position! < b.position! ? -1 : 1))
      .map((x) => x.name);
    expect(started).toEqual(["In progress", "Admin review", "Client review", "Stuck", "QA"]);

    // Tasks: legacy values carried over, counters recomputed.
    const task = (id: Id<"tasks">) => s.tasks.find((x) => x._id === id)!;
    expect(task(legacy.trackedTask)).toMatchObject({
      statusCategory: "started",
      estimateMinutes: 120,
      hasDescription: true,
      trackedMinutes: 75,
      commentCount: 1,
      priority: 0,
      sortKey: "a1",
    });
    expect(task(legacy.trackedTask).identifier).toMatch(/^ARLO-\d+$/);
    expect(task(legacy.doneTask).completedAt).toBe(task(legacy.doneTask).updatedAt);
    expect(task(legacy.parentTask)).toMatchObject({ subtaskCount: 2, subtaskDoneCount: 1 });
    expect(task(legacy.parentTask).identifier).toMatch(/^PRAG-\d+$/);
    // Sub-tasks keep their legacy sortOrder in the global sortKey.
    const subs = s.tasks
      .filter((x) => x.parentTaskId === legacy.parentTask)
      .sort((a, b) => (a.sortKey! < b.sortKey! ? -1 : 1))
      .map((x) => x.title);
    expect(subs).toEqual(["Sub A", "Sub B"]);

    // The mute moved onto the per-user state.
    const state = await t.run(async (ctx) =>
      ctx.db
        .query("taskUserState")
        .withIndex("by_taskId_userId", (q) => q.eq("taskId", legacy.trackedTask).eq("userId", legacy.m1))
        .unique(),
    );
    expect(state?.muted).toBe(true);
  });

  it("is idempotent: a run after the cleanup changes nothing", async () => {
    const t = createT();
    await seedLegacyOrg(t);
    await cleanUntilDone(t);
    const before = await t.run(async (ctx) => snapshotOrg(ctx.db, ORG_ID));
    const again = await t.mutation(internal.devCleanupTasks.stripLegacy, { orgId: ORG_ID });
    expect(again).toMatchObject({
      statusesFixed: 0, statusesCreated: 0, orgSettingsFixed: 0, projectsRecoded: 0, tasksFixed: 0,
      tasksBlocked: 0, usersFixed: 0, taskMutesMigrated: 0, taskViewReceiptsDeleted: 0, remaining: 0,
    });
    expect(await t.run(async (ctx) => snapshotOrg(ctx.db, ORG_ID))).toEqual(before);
  });

  it("leaves rows written by the new write path as they are", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    await cleanUntilDone(t);
    const created = await t.run(async (ctx) => {
      const user = (await ctx.db.get(legacy.admin))!;
      return await createTask(
        ctx,
        { orgId: ORG_ID, userId: legacy.admin, orgRole: "admin", isAdmin: true, user },
        { title: "Fresh", projectId: legacy.projects[0], assigneeIds: [legacy.m1] },
        { notify: false },
      );
    });
    const before = await t.run(async (ctx) => ctx.db.get(created));
    const result = await t.mutation(internal.devCleanupTasks.stripLegacy, { orgId: ORG_ID });
    expect(result.tasksFixed).toBe(0);
    expect(await t.run(async (ctx) => ctx.db.get(created))).toEqual(before);
  });

  it("never touches another org", async () => {
    const t = createT();
    const legacy = await seedLegacyOrg(t);
    const before = await rawRows(t, "tasks", OTHER_ORG_ID);
    await cleanUntilDone(t);
    expect(await rawRows(t, "tasks", OTHER_ORG_ID)).toEqual(before);
    expect((await rawRows(t, "taskMutes", OTHER_ORG_ID)).length).toBe(1);
    expect((await rawRows(t, "statuses", OTHER_ORG_ID))[0]).toMatchObject({ type: "backlog" });
    expect(legacy.otherOrgTask).toBeDefined();
  });

  it("requires an explicit org when several exist", async () => {
    const t = createT();
    await seedLegacyOrg(t);
    await expect(t.mutation(internal.devCleanupTasks.stripLegacy, {})).rejects.toThrow("Multiple orgs");
  });
});

// @vitest-environment edge-runtime
//
// The tasks reseed (convex/devSeedTasks.ts) on the narrowed schema: a fresh
// org gets the §4.1 statuses, labels and demo tasks; an existing org's caches,
// edges, counters and identifiers are re-derived (T3–T6) and a second run
// changes nothing.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEMO_TASKS, DEFAULT_LABEL_SEED, seedTaskFoundations } from "../devSeedTasks";
import { DEFAULT_STATUS_SEED, TASK_CATEGORIES } from "../tasks/model";
import { createTask } from "../tasks/write";
import { expectInvariants, snapshotOrg } from "./helpers/orgSnapshot";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_seed";
const OTHER_ORG_ID = "org_seed_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Org = { admin: Id<"users">; member: Id<"users">; arlo: Id<"projects">; prag: Id<"projects"> };

/** An onboarded org (members, settings, two projects) without statuses or tasks. */
async function seedOrg(t: T, orgId = ORG_ID): Promise<Org> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", { name: `A ${orgId}`, externalId: `clerk_a_${orgId}`, createdAt: now, updatedAt: now });
    const member = await ctx.db.insert("users", { name: `B ${orgId}`, externalId: `clerk_b_${orgId}`, createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId, clerkUserId: `clerk_a_${orgId}`, userId: admin, role: "admin", joinedAt: 1 });
    await ctx.db.insert("orgMembers", { orgId, clerkUserId: `clerk_b_${orgId}`, userId: member, role: "member", joinedAt: 2 });
    await ctx.db.insert("orgSettings", {
      orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 1, brandName: "Konverted",
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const client = await ctx.db.insert("clients", { orgId, name: "Arlow", currency: "EUR", createdAt: now, updatedAt: now, createdBy: admin });
    const mkProject = async (name: string, code: string) =>
      await ctx.db.insert("projects", {
        orgId, clientId: client, name, code, billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: admin,
      });
    return { admin, member, arlo: await mkProject("Arlow site", "ARLO"), prag: await mkProject("Arlow app", "PRAG") };
  });
}

/** A few project tasks through the write path (needs the seeded statuses). */
async function addProjectTasks(t: T, org: Org, orgId = ORG_ID): Promise<Id<"tasks">[]> {
  return await t.run(async (ctx) => {
    const user = (await ctx.db.get(org.admin))!;
    const auth = { orgId, userId: org.admin, orgRole: "admin" as const, isAdmin: true, user };
    const ids: Id<"tasks">[] = [];
    for (const [i, projectId] of [org.arlo, org.arlo, org.prag].entries()) {
      ids.push(await createTask(ctx, auth, { title: `Task ${i}`, projectId, assigneeIds: [org.member] }, { notify: false }));
    }
    ids.push(await createTask(ctx, auth, { title: "Sub", parentTaskId: ids[0] }, { notify: false }));
    return ids;
  });
}

const snapshot = (t: T, orgId = ORG_ID) => t.run(async (ctx) => snapshotOrg(ctx.db, orgId));

describe("devSeedTasks: fresh org", () => {
  it("creates the §4.1 default statuses, labels and demo tasks with the org key", async () => {
    const t = createT();
    await seedOrg(t);
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgKey: "KON" }));
    expect(result.statusesCreated).toBe(DEFAULT_STATUS_SEED.length);
    expect(result.labelsCreated).toBe(DEFAULT_LABEL_SEED.length);
    expect(result.demoTasksCreated).toBe(DEMO_TASKS.length);

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
    const canceled = s.tasks.find((x) => x.title === "Evaluate a new invoicing tool")!;
    expect(canceled.statusCategory).toBe("canceled");
  });

  it("is idempotent", async () => {
    const t = createT();
    const org = await seedOrg(t);
    await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });
    await addProjectTasks(t, org);
    await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });
    const first = await snapshot(t);
    expectInvariants(first);

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
});

describe("devSeedTasks: repairs", () => {
  it("repairs drifted caches and edges, and aliases a changed identifier", async () => {
    const t = createT();
    const org = await seedOrg(t);
    await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });
    const [first] = await addProjectTasks(t, org);
    await t.run(async (ctx) => {
      await ctx.db.patch(org.arlo, { code: "ARL" }); // a code rename outside the write path
      const edge = await ctx.db
        .query("taskAssignees")
        .withIndex("by_taskId_userId", (q) => q.eq("taskId", first))
        .first();
      // A duplicate edge (T6 drift).
      await ctx.db.insert("taskAssignees", {
        orgId: edge!.orgId, taskId: edge!.taskId, userId: edge!.userId, assignedAt: edge!.assignedAt, assignedBy: edge!.assignedBy,
      });
    });
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    expect(result.edgesDeleted).toBe(1);
    expect(result.aliasesCreated).toBeGreaterThan(0);

    const s = await snapshot(t);
    expectInvariants(s);
    expect(s.tasks.find((x) => x._id === first)!.identifier).toBe("ARL-1");
    const alias = await t.run(async (ctx) =>
      ctx.db
        .query("taskIdentifierAliases")
        .withIndex("by_orgId_identifier", (q) => q.eq("orgId", ORG_ID).eq("identifier", "ARLO-1"))
        .unique(),
    );
    expect(alias?.taskId).toBe(first);
  });

  it("turns tasks of a hard-deleted project into org tasks and drops orphaned edges", async () => {
    const t = createT();
    const org = await seedOrg(t);
    await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });
    const [a, , pragTask] = await addProjectTasks(t, org);
    await t.run(async (ctx) => {
      // projects.remove keeps the project's tasks; a raw delete leaves edges behind.
      await ctx.db.delete(org.prag);
      await ctx.db.delete(a);
    });
    const result = await t.run(async (ctx) => seedTaskFoundations(ctx, { orgId: ORG_ID }));
    expect(result.danglingProjectsCleared).toBe(1);
    expect(result.edgesDeleted).toBeGreaterThanOrEqual(1);

    const s = await snapshot(t);
    const moved = s.tasks.find((x) => x._id === pragTask)!;
    expect(moved.projectId).toBeUndefined();
    expect(moved.identifier).toMatch(/^KONV-\d+$/);
    expect(s.assigneeEdges.some((e) => e.taskId === a)).toBe(false);
  });
});

describe("devSeedTasks: scope", () => {
  it("never touches another org", async () => {
    const t = createT();
    await seedOrg(t);
    const other = await seedOrg(t, OTHER_ORG_ID);
    await t.mutation(internal.devSeedTasks.seed, { orgId: OTHER_ORG_ID });
    await addProjectTasks(t, other, OTHER_ORG_ID);
    const before = await snapshot(t, OTHER_ORG_ID);
    await t.mutation(internal.devSeedTasks.seed, { orgId: ORG_ID });
    expect(await snapshot(t, OTHER_ORG_ID)).toEqual(before);
  });

  it("requires an explicit org when several exist", async () => {
    const t = createT();
    await seedOrg(t);
    await seedOrg(t, OTHER_ORG_ID);
    await expect(t.run(async (ctx) => seedTaskFoundations(ctx, {}))).rejects.toThrow("Multiple orgs");
  });
});

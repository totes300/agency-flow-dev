// @vitest-environment edge-runtime

/**
 * `timeEntries.projectId` invariant — docs/prd-billing-refactor.md §5.2.
 *
 * The field is denormalized from the task, so a task that has entries must
 * never change or drop its project; otherwise the project index would list
 * entries under the wrong project.
 */

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { getProjectEntries } from "../lib/projectEntries";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG_ID = "org_entries";
const ADMIN = {
  subject: "user_admin",
  tokenIdentifier: "test|user_admin",
  org_id: ORG_ID,
  org_role: "org:admin",
} as never;

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: "Admin",
      externalId: "user_admin",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("orgMembers", {
      orgId: ORG_ID,
      clerkUserId: "user_admin",
      userId,
      role: "admin",
      joinedAt: now,
    });
    const statusId = await ctx.db.insert("statuses", {
      orgId: ORG_ID,
      name: "Todo",
      type: "backlog",
      color: "#000",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG_ID,
      name: "Acme",
      currency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const project = (code: string) =>
      ctx.db.insert("projects", {
        orgId: ORG_ID,
        clientId,
        name: code,
        code,
        billingType: "t_and_m",
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
      });
    const projectA = await project("PRJ-A");
    const projectB = await project("PRJ-B");
    const taskId = await ctx.db.insert("tasks", {
      orgId: ORG_ID,
      title: "Build",
      statusId,
      statusType: "backlog",
      projectId: projectA,
      assigneeIds: [userId],
      billable: true,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    const entryId = await ctx.db.insert("timeEntries", {
      orgId: ORG_ID,
      projectId: projectA,
      taskId,
      userId,
      date: "2026-03-09",
      startedAt: now,
      durationMinutes: 60,
      isBillable: true,
      method: "manual",
      costRate: 0,
      billableRate: 100,
      rateCurrency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    // Same project id string can't exist in another org, but an entry of a
    // foreign org on the same project must never leak through the index.
    await ctx.db.insert("timeEntries", {
      orgId: "org_other",
      projectId: projectA,
      taskId,
      userId,
      date: "2026-03-09",
      startedAt: now,
      durationMinutes: 30,
      isBillable: true,
      method: "manual",
      costRate: 0,
      billableRate: 100,
      rateCurrency: "EUR",
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    });
    return { projectA, projectB, taskId, entryId };
  });
}

describe("timeEntries.projectId", () => {
  it("getProjectEntries reads one project, scoped to the org", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    const entries = await t.run(async (ctx) => getProjectEntries(ctx, ORG_ID, ids.projectA));
    expect(entries.map((e) => e._id)).toEqual([ids.entryId]);
    const other = await t.run(async (ctx) => getProjectEntries(ctx, ORG_ID, ids.projectB));
    expect(other).toEqual([]);
  });

  it("a task with entries cannot move to another project", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tasks.update, { id: ids.taskId, projectId: ids.projectB }),
    ).rejects.toThrow(/Cannot change the project/);
  });

  it("a task with entries cannot drop its project", async () => {
    const t = convexTest(schema, modules);
    const ids = await seed(t);
    await expect(
      t.withIdentity(ADMIN).mutation(api.tasks.update, { id: ids.taskId, projectId: null }),
    ).rejects.toThrow(/Cannot change the project/);
  });
});

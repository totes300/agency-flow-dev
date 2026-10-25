// @vitest-environment edge-runtime
//
// Deletion audit (docs/prd-agent-first-backlog.md §7): deleting a task writes
// one `task_deleted` activity row, before the records go, with what was
// deleted and who (and `via` for an agent). The row outlives the task; the
// changes feed shows it from its metadata (admins, and the member who deleted
// it — a deleted task's access edges are gone); per-task readers never see it.

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_audit";
const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;
type Caller = "admin" | "alice";
const SUBJECT: Record<Caller, string> = { admin: "clerk_admin", alice: "clerk_alice" };

const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller], issuer: "https://clerk.test", client_id: "client_claude", org_id: ORG });

async function setup(t: T) {
  const f = await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Ada", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    for (const [userId, clerkUserId, role] of [[admin, "clerk_admin", "admin"], [alice, "clerk_alice", "member"]] as const) {
      await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId, userId, role, joinedAt: now });
    }
    await ctx.db.insert("orgSettings", {
      orgId: ORG, brandName: "B", defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy: admin,
    });
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const arlo = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow", code: "ARLO", billingType: "non_billable", createdAt: now, updatedAt: now, createdBy: admin,
    });
    await ctx.db.insert("userRates", { orgId: ORG, userId: admin, currency: "EUR", costRate: 40, createdAt: now, updatedAt: now });
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const task = await createTask(ctx, adminAuth, { title: "Logo v2", projectId: arlo, assigneeIds: [admin, alice] }, { notify: false });
    await createTask(ctx, adminAuth, { title: "Sketches", parentTaskId: task, assigneeIds: [] }, { notify: false });
    return { admin, alice, task, identifier: (await ctx.db.get(task))!.identifier };
  });
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return f;
}

const changes = (t: T, caller: Caller, args: Record<string, unknown> = {}) =>
  as(t, caller).query(api.mcp.fetch.changes, { excludeSelf: false, includeText: true, limit: 50, now: Date.now() + 60_000, ...args });

async function deleteWithTime(t: T, f: Awaited<ReturnType<typeof setup>>) {
  await as(t, "admin").mutation(api.mcp.write.saveTimeEntries, {
    items: [{ task: f.identifier, minutes: 30, date: "2026-10-20" }] as never, clientName: "Claude",
  });
  return await as(t, "admin").mutation(api.mcp.write.remove, { refs: [f.identifier], deleteTimeEntries: true, clientName: "Claude" });
}

describe("task_deleted", () => {
  it("one row per deleted task, with what was deleted and via", async () => {
    const t = createT();
    const f = await setup(t);
    await deleteWithTime(t, f);
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("activityLog").withIndex("by_org_type", (q) => q.eq("orgId", ORG).eq("type", "task_deleted")).collect()),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskId: f.task,
      userId: f.admin,
      metadata: { identifier: f.identifier, title: "Logo v2", projectCode: "ARLO", subtaskCount: 1, deletedTimeEntries: 1 },
      via: { kind: "mcp", clientId: "client_claude", clientName: "Claude" },
    });
    // The task is gone; the row stays.
    expect(await t.run(async (ctx) => await ctx.db.get(f.task))).toBeNull();
  });

  it("caps the stored title", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "admin").mutation(api.mcp.write.saveTasks, { items: [{ ref: f.identifier, title: "L".repeat(480) }] as never, clientName: "Claude" });
    await as(t, "admin").mutation(api.mcp.write.remove, { refs: [f.identifier], clientName: "Claude" });
    const row = await t.run(async (ctx) =>
      await ctx.db.query("activityLog").withIndex("by_org_type", (q) => q.eq("orgId", ORG).eq("type", "task_deleted")).first(),
    );
    expect((row!.metadata as { title: string }).title).toHaveLength(200);
  });

  it("the changes feed shows the deletion to admins; fetch of the key says not found", async () => {
    const t = createT();
    const f = await setup(t);
    await deleteWithTime(t, f);
    const feed = await changes(t, "admin", { types: ["task_deleted"] });
    expect(feed.changes).toHaveLength(1);
    expect(feed.changes[0]).toMatchObject({
      type: "task_deleted",
      task: { identifier: f.identifier, title: "Logo v2", deleted: true },
      actor: "Ada",
      via: "Claude",
    });
    const fetched = await as(t, "admin").query(api.mcp.fetch.records, { refs: [f.identifier], include: [], now: Date.now() });
    expect(fetched.results[0].ok).toBe(false);
  });

  it("members do not see another member's deletion; readers of the gone task do not throw", async () => {
    const t = createT();
    const f = await setup(t);
    await deleteWithTime(t, f);
    expect((await changes(t, "alice")).changes.filter((c) => c.type === "task_deleted")).toHaveLength(0);
    await expect(as(t, "alice").query(api.mcp.fetch.inbox, { includeRead: true, limit: 50, now: Date.now() })).resolves.toBeDefined();
    const session = t.withIdentity({ subject: "clerk_admin", tokenIdentifier: "test|clerk_admin", org_id: ORG, org_role: "org:admin" });
    expect(await session.query(api.activityLog.byTask, { taskId: f.task })).toEqual([]);
  });
});

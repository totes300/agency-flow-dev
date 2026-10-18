// @vitest-environment edge-runtime
//
// Tasks refactor slice 6 (docs/prd-tasks-refactor.md §4.4, §4.3, §5.4, U9):
//   users.updateTaskDetailMode   per-user drawer | page (unset = drawer), own row only
//   tasks.userState.markViewed   resets the caller's unread state AND clears their
//                                inbox notifications for that task only (honest badge,
//                                kept from taskViewReceipts.markViewed); readers only
//   tasks.queries.getByIdentifier case-insensitive, aliases, other org → null

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_STATUS_SEED } from "../tasks/model";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_detail6";
const OTHER = "org_detail6_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "other";
const IDENTITY: Record<Caller, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
  bob: { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" },
  other: { subject: "clerk_other", orgId: OTHER, orgRole: "org:admin" },
};
const as = (t: T, caller: Caller) => t.withIdentity(IDENTITY[caller]);

function doc(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

async function setup(t: T) {
  const base = await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
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
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
        taskKey: orgId === ORG ? "KON" : "OTH", nextTaskNumber: 1,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, type: s.legacyType, sortOrder: i,
          category: s.category, position: `a${i}`, isDefault: s.isDefault,
          createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    return { admin, alice, bob };
  });
  const admin = as(t, "admin");
  const aliceTask = await admin.mutation(api.tasks.create, { title: "Alice's", assigneeIds: [base.alice] });
  const shared = await admin.mutation(api.tasks.create, { title: "Shared", assigneeIds: [base.alice, base.bob] });
  const foreign = await as(t, "other").mutation(api.tasks.create, { title: "Elsewhere" });
  return { ...base, aliceTask, shared, foreign };
}

async function userDoc(t: T, id: Id<"users">) {
  return await t.run(async (ctx) => await ctx.db.get(id));
}

async function notificationsOf(t: T, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    await ctx.db
      .query("notifications")
      .withIndex("by_recipient_org_state", (q) => q.eq("recipientId", userId).eq("orgId", ORG))
      .collect(),
  );
}

async function stateOf(t: T, taskId: Id<"tasks">, userId: Id<"users">) {
  return await t.run(async (ctx) =>
    await ctx.db
      .query("taskUserState")
      .withIndex("by_taskId_userId", (q) => q.eq("taskId", taskId).eq("userId", userId))
      .first(),
  );
}

describe("users.updateTaskDetailMode", () => {
  it("sets the caller's own mode (unset = drawer) and leaves others untouched", async () => {
    const t = createT();
    const f = await setup(t);
    expect((await userDoc(t, f.alice))?.taskDetailMode).toBeUndefined();

    await as(t, "alice").mutation(api.users.updateTaskDetailMode, { mode: "page" });
    expect((await userDoc(t, f.alice))?.taskDetailMode).toBe("page");
    expect((await userDoc(t, f.bob))?.taskDetailMode).toBeUndefined();

    await as(t, "alice").mutation(api.users.updateTaskDetailMode, { mode: "drawer" });
    expect((await userDoc(t, f.alice))?.taskDetailMode).toBe("drawer");
    expect((await as(t, "alice").query(api.users.current, {}))?.taskDetailMode).toBe("drawer");
  });

  it("rejects unauthenticated callers and unknown modes", async () => {
    const t = createT();
    await setup(t);
    await expect(t.mutation(api.users.updateTaskDetailMode, { mode: "page" })).rejects.toThrow();
    await expect(
      // @ts-expect-error — "modal" is the retired taskDetailView value.
      as(t, "alice").mutation(api.users.updateTaskDetailMode, { mode: "modal" }),
    ).rejects.toThrow();
  });
});

describe("tasks.userState.markViewed (task detail open)", () => {
  it("resets unread state and clears the viewer's inbox notifications for that task only", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = as(t, "admin");
    await admin.mutation(api.comments.create, { taskId: f.aliceTask, content: doc("one") });
    await admin.mutation(api.comments.create, { taskId: f.shared, content: doc("two") });

    const before = await notificationsOf(t, f.alice);
    expect(before.filter((n) => n.taskId === f.aliceTask && n.inboxState === "unread").length).toBeGreaterThan(0);
    expect((await stateOf(t, f.aliceTask, f.alice))?.unreadComments).toBe(1);

    await as(t, "alice").mutation(api.tasks.userState.markViewed, { taskId: f.aliceTask });

    const after = await notificationsOf(t, f.alice);
    expect(after.filter((n) => n.taskId === f.aliceTask).every((n) => n.inboxState === "read")).toBe(true);
    expect(after.filter((n) => n.taskId === f.shared).every((n) => n.inboxState === "unread")).toBe(true);
    const state = await stateOf(t, f.aliceTask, f.alice);
    expect(state?.unreadComments).toBe(0);
    expect(state?.hasUnseenChanges).toBe(false);
    expect(state?.lastViewedAt).toBeGreaterThan(0);
    // Bob's notifications on the shared task are untouched.
    expect((await notificationsOf(t, f.bob)).filter((n) => n.taskId === f.shared).every((n) => n.inboxState === "unread")).toBe(true);
  });

  it("refuses callers who cannot read the task", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(as(t, "bob").mutation(api.tasks.userState.markViewed, { taskId: f.aliceTask })).rejects.toThrow();
    await expect(as(t, "other").mutation(api.tasks.userState.markViewed, { taskId: f.aliceTask })).rejects.toThrow();
    await expect(as(t, "alice").mutation(api.tasks.userState.markViewed, { taskId: f.foreign })).rejects.toThrow();
  });
});

describe("tasks.queries.getByIdentifier (full page route)", () => {
  it("resolves case-insensitively; other org and unreadable tasks are null", async () => {
    const t = createT();
    const f = await setup(t);
    const identifier = (await as(t, "admin").query(api.tasks.queries.getDetail, { taskId: f.aliceTask }))?.identifier;
    expect(identifier).toMatch(/^KON-\d+$/);

    const lower = await as(t, "alice").query(api.tasks.queries.getByIdentifier, { identifier: identifier!.toLowerCase() });
    expect(lower?._id).toBe(f.aliceTask);
    expect(lower?.identifier).toBe(identifier);
    expect(lower?.resolvedFromAlias).toBe(false);

    expect(await as(t, "bob").query(api.tasks.queries.getByIdentifier, { identifier: identifier! })).toBeNull();
    expect(await as(t, "other").query(api.tasks.queries.getByIdentifier, { identifier: identifier! })).toBeNull();
    expect(await as(t, "alice").query(api.tasks.queries.getByIdentifier, { identifier: "KON-9999" })).toBeNull();
  });

  it("resolves an old identifier through the alias table to the current one", async () => {
    const t = createT();
    const f = await setup(t);
    const projectId = await t.run(async (ctx) => {
      const now = Date.now();
      const clientId = await ctx.db.insert("clients", {
        orgId: ORG, name: "Arlo", currency: "EUR", prefix: "ARLO", createdAt: now, updatedAt: now, createdBy: f.admin,
      });
      return await ctx.db.insert("projects", {
        orgId: ORG, clientId, name: "Arlo site", code: "ARLO", billingType: "t_and_m",
        createdAt: now, updatedAt: now, createdBy: f.admin,
      });
    });
    const before = (await as(t, "admin").query(api.tasks.queries.getDetail, { taskId: f.aliceTask }))!.identifier!;
    await as(t, "admin").mutation(api.tasks.update, { id: f.aliceTask, projectId });
    const moved = await as(t, "alice").query(api.tasks.queries.getByIdentifier, { identifier: before });
    expect(moved?._id).toBe(f.aliceTask);
    expect(moved?.resolvedFromAlias).toBe(true);
    expect(moved?.identifier).toMatch(/^ARLO-\d+$/);
  });
});

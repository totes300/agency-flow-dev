// @vitest-environment edge-runtime
//
// MCP slice 3 (docs/prd-mcp.md §6, §13): the write tools and the changes
// feed through convex/mcp/*, with OAuth identities.
//   D21  external refs: upsert hits the existing task, a ref owned by another
//        task fails naming it, refs never match across orgs
//   D23  an idempotency-key replay returns the first result and writes nothing
//   I5   one bad item writes nothing
//   D15  activity rows and comments carry "via <client>"
//   D16  assignment and @mention notifications fire exactly as in the app
//   D22  changes: the cursor resumes exactly, exclude_self drops the caller's
//   D29  rows, comment rows carry capped text, unreadable tasks never appear
//   D24  checklist: done, order, next_assignee follows sub-task order
//   D28  a task without project gets the org key and no client
//   §5.3 members cannot write what the app would not let them

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask, updateTask } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import { createCommentForAuth } from "../comments";
import { IDEMPOTENCY_TTL_MS } from "../lib/mcpWrites";
import { CHANGE_TYPES } from "../../lib/mcp/limits";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp3";
const OTHER = "org_mcp3_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "carol" | "other";

const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  alice: ["clerk_alice", ORG],
  bob: ["clerk_bob", ORG],
  carol: ["clerk_carol", ORG],
  other: ["clerk_other", OTHER],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const as = (t: T, caller: Caller, clientId = "client_claude") =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: clientId, org_id: SUBJECT[caller][1] });

const email = (caller: Caller) => `${SUBJECT[caller][0]}@x.test`;

/** The fixture, with every member connected through the OAuth clients this file uses. */
async function setup(t: T) {
  const fixture = await setupData(t);
  await t.run((ctx) => connectMembers(ctx, ["client_claude", "client_codex", "https://claude.ai/oauth/claude-code-client-metadata"]));
  return fixture;
}

async function setupData(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
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
    for (const [orgId, createdBy, brandName] of [[ORG, admin, "Konverted"], [OTHER, other, "Elsewhere"]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, brandName, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    const client = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const arlo = await ctx.db.insert("projects", {
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO", billingType: "retainer", monthlyFee: 5000,
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherClient = await ctx.db.insert("clients", { orgId: OTHER, name: "Else", currency: "EUR", createdAt: now, updatedAt: now, createdBy: other });
    await ctx.db.insert("projects", {
      orgId: OTHER, clientId: otherClient, name: "Else", code: "ELSE", billingType: "retainer", monthlyFee: 1,
      createdAt: now, updatedAt: now, createdBy: other,
    });
    await ctx.db.insert("labels", { orgId: ORG, name: "Launch", color: "red", position: "a0" });

    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    /** Alice's own task (assigned to her); U is admin-only. */
    const A = await createTask(ctx, adminAuth, { title: "Alice task", projectId: arlo, assigneeIds: [alice] }, { notify: false });
    const U = await createTask(ctx, adminAuth, { title: "Admin only", projectId: arlo, assigneeIds: [admin] }, { notify: false });
    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier!;
    return { admin, alice, bob, carol, other, arlo, client, adminAuth, A, U, id: { A: await identifier(A), U: await identifier(U) } };
  });
}

type Item = Record<string, unknown>;
const saveTasks = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}, clientId?: string) =>
  as(t, caller, clientId).mutation(api.mcp.write.saveTasks, { items, clientName: "Claude", ...extra });
const saveComments = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}, clientId?: string) =>
  as(t, caller, clientId).mutation(api.mcp.write.saveComments, { items: items as never, clientName: "Claude", ...extra });
const remove = (t: T, caller: Caller, refs: string[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.remove, { refs, clientName: "Claude", ...extra });

const allTasks = (t: T, orgId = ORG) =>
  t.run(async (ctx) => await ctx.db.query("tasks").withIndex("by_orgId_sortKey", (q) => q.eq("orgId", orgId)).collect());
const taskBy = (t: T, identifier: string) =>
  t.run(async (ctx) => (await ctx.db.query("tasks").withIndex("by_orgId_identifier", (q) => q.eq("orgId", ORG).eq("identifier", identifier)).first())!);
const notificationsOf = (t: T, recipientId: Id<"users">) =>
  t.run(async (ctx) => await ctx.db.query("notifications").withIndex("by_recipient_org_state", (q) => q.eq("recipientId", recipientId)).collect());

/** The caller's clock for the changes feed: past the settle window of everything written so far. */
const later = () => Date.now() + 60_000;
const changes = (t: T, caller: Caller, args: Record<string, unknown> = {}, clientId?: string) =>
  as(t, caller, clientId).query(api.mcp.fetch.changes, { excludeSelf: false, includeText: true, limit: 50, now: later(), ...args });

const TASK_SEARCH = { offset: 0, limit: 25, due: {}, updated: {} };

// ─── save_tasks ──────────────────────────────────────────────────────────────

describe("save_tasks: external refs (D21)", () => {
  it("creates a card for a source ref; a second run updates the same card", async () => {
    const t = createT();
    await setup(t);
    const first = await saveTasks(t, "admin", [{ title: "Reply to Arlo", project: "ARLO", externalRefs: ["Gmail:thread-1"] }]);
    expect(first).toMatchObject({ tool: "save_tasks", replayed: false, items: [{ title: "Reply to Arlo", action: "created" }] });
    const key = first.items[0].identifier;
    expect(key).toMatch(/^ARLO-\d+$/);

    const second = await saveTasks(t, "admin", [{ title: "Reply to Arlo (follow-up)", externalRefs: ["gmail:thread-1", "granola:n1"] }]);
    expect(second.items).toEqual([{ identifier: key, title: "Reply to Arlo (follow-up)", action: "updated" }]);
    expect((await allTasks(t)).filter((task) => task.title.startsWith("Reply to Arlo"))).toHaveLength(1);

    // fetch shows the refs; search finds the card by ref (any status).
    const [record] = (await as(t, "admin").query(api.mcp.fetch.records, { refs: [key], include: [], now: Date.now() })).results;
    expect(record.ok && record.record.type === "task" && record.record.externalRefs).toEqual({ refs: ["gmail:thread-1", "granola:n1"], truncated: false });
    await saveTasks(t, "admin", [{ ref: key, done: true }]);
    const found = await as(t, "admin").query(api.mcp.search.tasks, { ...TASK_SEARCH, externalRef: "gmail:thread-1", now: Date.now() });
    expect(found.rows.map((r) => r.identifier)).toEqual([key]);
  });

  it("a ref owned by another task fails with that task's identifier and is never moved", async () => {
    const t = createT();
    const f = await setup(t);
    const created = await saveTasks(t, "admin", [{ title: "Owner", externalRefs: ["gmail:abc"] }]);
    const owner = created.items[0].identifier;
    await expect(saveTasks(t, "admin", [{ ref: f.id.A, externalRefs: ["gmail:abc"] }])).rejects.toThrow(
      `Item 1 (${f.id.A}): gmail:abc is already on ${owner}. Nothing was saved.`,
    );
    await saveTasks(t, "admin", [{ title: "Second", externalRefs: ["slack:1"] }]);
    await expect(saveTasks(t, "admin", [{ title: "Both", externalRefs: ["gmail:abc", "slack:1"] }])).rejects.toThrow(
      "one item cannot update two tasks",
    );
    // A member never learns the identifier of a task they cannot read.
    await expect(saveTasks(t, "alice", [{ ref: f.id.A, externalRefs: ["gmail:abc"] }])).rejects.toThrow(
      "gmail:abc is already on a task you cannot access",
    );
    const refs = await t.run(async (ctx) => await ctx.db.query("taskExternalRefs").collect());
    expect(refs.find((r) => r.ref === "gmail:abc")?.taskId).toBe((await taskBy(t, owner))._id);
    await expect(saveTasks(t, "admin", [{ title: "Bad", externalRefs: ["not a ref"] }])).rejects.toThrow("Invalid external ref");
  });

  it("refs never match across orgs", async () => {
    const t = createT();
    await setup(t);
    const elsewhere = await saveTasks(t, "other", [{ title: "Other org card", externalRefs: ["gmail:shared"] }]);
    const mine = await saveTasks(t, "admin", [{ title: "My card", externalRefs: ["gmail:shared"] }]);
    expect(mine.items[0]).toMatchObject({ action: "created", title: "My card" });
    expect(mine.items[0].identifier).not.toBe(elsewhere.items[0].identifier);
    const found = await as(t, "other").query(api.mcp.search.tasks, { ...TASK_SEARCH, externalRef: "gmail:shared", now: Date.now() });
    expect(found.rows.map((r) => r.title)).toEqual(["Other org card"]);
  });
});

describe("save_tasks: batches, idempotency, leads", () => {
  it("one bad item writes nothing (I5)", async () => {
    const t = createT();
    await setup(t);
    const before = await allTasks(t);
    const activity = await t.run(async (ctx) => (await ctx.db.query("activityLog").collect()).length);
    await expect(
      saveTasks(t, "admin", [
        { title: "Good one", externalRefs: ["gmail:x"] },
        { title: "Bad status", status: "Nope" },
      ]),
    ).rejects.toThrow('Item 2 (Bad status): No status "Nope". Use a name listed in fetch("workspace"). Nothing was saved.');
    expect(await allTasks(t)).toHaveLength(before.length);
    expect(await t.run(async (ctx) => (await ctx.db.query("activityLog").collect()).length)).toBe(activity);
    expect(await t.run(async (ctx) => await ctx.db.query("taskExternalRefs").collect())).toEqual([]);
  });

  it("a replayed idempotencyKey returns the first result and writes nothing (D23)", async () => {
    const t = createT();
    const f = await setup(t);
    const first = await saveTasks(t, "admin", [{ title: "Once" }], { idempotencyKey: "run-1" });
    const count = (await allTasks(t)).length;
    // The same request again (a retry; the display name may differ): the first result, no write.
    const replay = await saveTasks(t, "admin", [{ title: "Once" }], { idempotencyKey: "run-1", clientName: "Other" });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(await allTasks(t)).toHaveLength(count);
    // The same key for a different request is refused, never answered with the old result.
    await expect(saveTasks(t, "admin", [{ title: "Different input" }], { idempotencyKey: "run-1" })).rejects.toThrow(
      "This idempotencyKey was already used for a different request; use a new key for a new write.",
    );
    expect(await allTasks(t)).toHaveLength(count);
    // Keys are per user: another user's identical key runs.
    const alices = await saveTasks(t, "alice", [{ title: "Alice's" }], { idempotencyKey: "run-1" });
    expect(alices.replayed).toBe(false);
    // Another tool with the same key is refused.
    await expect(saveComments(t, "admin", [{ task: f.id.A, body: "x" }], { idempotencyKey: "run-1" })).rejects.toThrow(
      "already used for a different request",
    );
    // Expired keys run again; the cleanup deletes them.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("mcpIdempotency").collect()) {
        await ctx.db.patch(row._id, { createdAt: row.createdAt - IDEMPOTENCY_TTL_MS - 1 });
      }
    });
    const again = await saveTasks(t, "admin", [{ title: "Once" }], { idempotencyKey: "run-1" });
    expect(again).toMatchObject({ replayed: false, items: [{ title: "Once", action: "created" }] });
    await t.mutation(internal.mcpIdempotency.cleanupExpired, {});
    const keys = await t.run(async (ctx) => await ctx.db.query("mcpIdempotency").collect());
    expect(keys.map((k) => [k.key, k.tool])).toEqual([["run-1", "save_tasks"]]);
  });

  it("a task without project gets the org identifier key and no client (D28)", async () => {
    const t = createT();
    await setup(t);
    const { items } = await saveTasks(t, "admin", [{ title: "Lead: Acme", assignees: [] }]);
    expect(items[0].identifier).toMatch(/^KONV-\d+$/);
    const task = await taskBy(t, items[0].identifier);
    expect(task.projectId).toBeUndefined();
    expect(task.clientId).toBeUndefined();
    expect(task.assigneeIds).toEqual([]);
  });

  it("writes markdown descriptions as the app's rich text with mention nodes", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await saveTasks(t, "admin", [
      { title: "Brief", description: `## Scope\n\n**Hero** for @${email("carol")}`, assignees: [email("carol")] },
    ]);
    const task = await taskBy(t, items[0].identifier);
    expect(JSON.parse(task.description!)).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Scope" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hero", marks: [{ type: "bold" }] },
            { type: "text", text: " for " },
            { type: "mention", attrs: { id: f.carol, label: "Carol" } },
          ],
        },
      ],
    });
    await expect(saveTasks(t, "admin", [{ title: "x", description: "hi @stranger@nowhere.test" }])).rejects.toThrow(
      "@stranger@nowhere.test is not a member of this workspace",
    );
  });
});

describe("save_tasks: access like the app (§5.3)", () => {
  it("members only write tasks they are assigned to, and never billing fields", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(saveTasks(t, "bob", [{ ref: f.id.A, title: "Hijack" }])).rejects.toThrow(`${f.id.A} not found`);
    await expect(saveTasks(t, "alice", [{ ref: f.id.A, project: null }])).rejects.toThrow("Only admins can change the task's project");
    await expect(saveTasks(t, "alice", [{ ref: f.id.U, done: true }])).rejects.toThrow("not found");
    const ok = await saveTasks(t, "alice", [{ ref: f.id.A, title: "Alice renamed", priority: "high" }]);
    expect(ok.items[0]).toMatchObject({ identifier: f.id.A, action: "updated" });
    // A member's new task is assigned to them, as in the app.
    const created = await saveTasks(t, "bob", [{ title: "Bob's own" }]);
    expect((await taskBy(t, created.items[0].identifier)).assigneeIds).toEqual([f.bob]);
  });
});

describe("save_tasks: checklist (D24)", () => {
  async function checklist(t: T) {
    const f = await setup(t);
    const parent = (await saveTasks(t, "admin", [{ title: "Launch checklist", project: "ARLO", assignees: [email("alice")] }])).items[0].identifier;
    const subs = await saveTasks(t, "admin", [
      { parent, title: "Filters", assignees: [email("alice")] },
      { parent, title: "Copy", assignees: [email("bob")] },
      { parent, title: "QA", assignees: [email("carol")] },
    ]);
    return { f, parent, subs: subs.items.map((i) => i.identifier) };
  }

  const subtaskOrder = async (t: T, parent: string) => {
    const [r] = (await as(t, "admin").query(api.mcp.fetch.records, { refs: [parent], include: ["subtasks"], now: Date.now() })).results;
    if (!r.ok || r.record.type !== "task") throw new Error("expected a task");
    return { order: r.record.subtasks!.rows.map((s) => s.title), next: r.record.nextStep };
  };

  it("ticks with done, orders with after / before, and next_assignee follows the order", async () => {
    const t = createT();
    const { parent, subs } = await checklist(t);
    expect((await subtaskOrder(t, parent)).order).toEqual(["Filters", "Copy", "QA"]);

    await saveTasks(t, "admin", [{ ref: subs[2], before: subs[1] }]);
    expect((await subtaskOrder(t, parent)).order).toEqual(["Filters", "QA", "Copy"]);
    await saveTasks(t, "admin", [{ ref: subs[0], after: subs[1] }]);
    expect((await subtaskOrder(t, parent)).order).toEqual(["QA", "Copy", "Filters"]);

    const nextOf = async (who: Caller) =>
      (await as(t, "admin").query(api.mcp.search.tasks, { ...TASK_SEARCH, nextAssignee: email(who), now: Date.now() })).rows.map(
        (r) => r.identifier,
      );
    expect(await nextOf("carol")).toEqual([parent]);
    expect(await nextOf("bob")).toEqual([]);

    const tick = await saveTasks(t, "admin", [{ ref: subs[2], done: true }]);
    expect(tick.items[0].action).toBe("updated");
    expect((await taskBy(t, subs[2])).statusCategory).toBe("completed");
    expect(await nextOf("carol")).toEqual([]);
    expect(await nextOf("bob")).toEqual([parent]);
    expect((await subtaskOrder(t, parent)).next).toEqual({ identifier: subs[1], title: "Copy", assignees: ["Bob"] });
    // Ticking again changes nothing.
    expect((await saveTasks(t, "admin", [{ ref: subs[2], done: true }])).items[0].action).toBe("unchanged");
    await expect(saveTasks(t, "admin", [{ ref: parent, after: subs[0] }])).rejects.toThrow("order sub-tasks only");
  });
});

// ─── Notifications and attribution ───────────────────────────────────────────

describe("notifications (D16) and attribution (D15)", () => {
  it("assignment and @mention via MCP notify exactly like the app", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await saveTasks(t, "admin", [{ title: "For Alice", assignees: [email("alice")] }]);
    const assigned = (await notificationsOf(t, f.alice)).filter((n) => n.type === "assigned");
    expect(assigned.map((n) => n.previewText)).toEqual(["For Alice"]);

    await saveComments(t, "admin", [{ task: items[0].identifier, body: `Ping @${email("alice")} and @${email("carol")}` }]);
    const alice = await notificationsOf(t, f.alice);
    expect(alice.filter((n) => n.type === "mention_comment")).toHaveLength(1);
    // Carol cannot open the task: no notification, like a mention in the app.
    expect(await notificationsOf(t, f.carol)).toEqual([]);
  });

  it("stamps via on activity rows and comments; the app's own writes carry none", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await saveTasks(t, "admin", [{ title: "Via test" }], {}, "client_claude");
    await saveComments(t, "admin", [{ task: items[0].identifier, body: "From Claude" }]);
    const task = await taskBy(t, items[0].identifier);
    const rows = await t.run(async (ctx) =>
      await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
    );
    expect(rows.map((r) => [r.type, r.via])).toEqual([
      ["task_created", { kind: "mcp", clientId: "client_claude", clientName: "Claude" }],
      ["comment_added", { kind: "mcp", clientId: "client_claude", clientName: "Claude" }],
    ]);
    const comment = await t.run(async (ctx) => await ctx.db.query("comments").withIndex("by_task", (q) => q.eq("taskId", task._id)).first());
    expect(comment?.via?.clientName).toBe("Claude");

    // An unnamed client falls back to its CIMD host; a hostile name is cleaned and capped.
    await as(t, "admin", "https://claude.ai/oauth/claude-code-client-metadata").mutation(api.mcp.write.saveTasks, {
      items: [{ ref: items[0].identifier, title: "Renamed" }],
    });
    await saveTasks(t, "admin", [{ ref: items[0].identifier, title: "Renamed again" }], { clientName: `Evil\n${"x".repeat(200)}` });
    const names = await t.run(async (ctx) =>
      (await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect())
        .filter((r) => r.type === "title_changed")
        .map((r) => r.via?.clientName),
    );
    expect(names[0]).toBe("claude.ai");
    expect(names[1]).toBe(`Evil ${"x".repeat(55)}`);

    // App writes (session path) have no via.
    await t.run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.A, f.adminAuth);
      await updateTask(ctx, access, { title: "App rename" });
    });
    const appRow = await t.run(async (ctx) =>
      (await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", f.A)).collect()).at(-1),
    );
    expect(appRow?.via).toBeUndefined();
  });
});

// ─── save_comments and delete ────────────────────────────────────────────────

describe("save_comments", () => {
  it("creates, replies and edits only your own comments", async () => {
    const t = createT();
    const f = await setup(t);
    const created = await saveComments(t, "alice", [{ task: f.id.A, body: "First" }]);
    const commentId = created.items[0].commentId;
    expect(created.items[0]).toMatchObject({ task: f.id.A, action: "created" });
    const reply = await saveComments(t, "admin", [{ task: f.id.A, replyTo: commentId, body: "Reply" }]);
    const replyDoc = await t.run(async (ctx) => await ctx.db.get(reply.items[0].commentId));
    expect(replyDoc?.parentCommentId).toBe(commentId);
    await expect(saveComments(t, "admin", [{ ref: commentId, body: "Not mine" }])).rejects.toThrow("You can only edit your own comments");
    const edit = await saveComments(t, "alice", [{ ref: commentId, body: "First, edited" }]);
    expect(edit.items[0].action).toBe("updated");
    await expect(saveComments(t, "bob", [{ task: f.id.A, body: "Not my task" }])).rejects.toThrow("not found");
  });
});

describe("delete (D6)", () => {
  it("follows the app's rules and is all-or-nothing", async () => {
    const t = createT();
    const f = await setup(t);
    const own = await saveComments(t, "alice", [{ task: f.id.A, body: "Mine" }]);
    const admins = await saveComments(t, "admin", [{ task: f.id.A, body: "Admin's" }]);
    await expect(remove(t, "alice", [admins.items[0].commentId])).rejects.toThrow("You can only delete your own comments");
    await expect(remove(t, "alice", [f.id.A])).rejects.toThrow("Only admins can delete tasks");
    expect((await remove(t, "alice", [own.items[0].commentId])).items).toEqual([
      { input: own.items[0].commentId, type: "comment", label: `comment on ${f.id.A}`, action: "deleted" },
    ]);

    // Logged time blocks a delete unless deleteTimeEntries; a bad ref aborts all.
    await t.run(async (ctx) => {
      await ctx.db.insert("timeEntries", {
        orgId: ORG, projectId: f.arlo, taskId: f.A, userId: f.alice, date: "2026-10-20", startedAt: Date.now(), durationMinutes: 30,
        isBillable: true, method: "manual", costRate: 1, billableRate: 1, rateCurrency: "EUR",
        createdAt: Date.now(), updatedAt: Date.now(), createdBy: f.alice,
      });
    });
    await expect(remove(t, "admin", [f.id.A])).rejects.toThrow("This task has logged time");
    await expect(remove(t, "admin", [f.id.A, email("alice")])).rejects.toThrow("is a member: members are removed in the organization settings");
    expect(await taskBy(t, f.id.A)).toBeTruthy();
    const deleted = await remove(t, "admin", [f.id.A], { deleteTimeEntries: true });
    expect(deleted.items[0]).toMatchObject({ type: "task", action: "deleted" });
    expect(await t.run(async (ctx) => await ctx.db.get(f.A))).toBeNull();
  });

  it("a sub-task deleted with its parent in the same call reports already deleted, and frees its refs", async () => {
    const t = createT();
    await setup(t);
    const parent = (await saveTasks(t, "admin", [{ title: "Parent", externalRefs: ["gmail:p"] }])).items[0].identifier;
    const child = (await saveTasks(t, "admin", [{ parent, title: "Child" }])).items[0].identifier;
    const result = await remove(t, "admin", [parent, child]);
    expect(result.items.map((i) => i.action)).toEqual(["deleted", "already_deleted"]);
    expect(await t.run(async (ctx) => await ctx.db.query("taskExternalRefs").collect())).toEqual([]);
  });
});

// ─── Changes feed ────────────────────────────────────────────────────────────

describe("fetch changes (D22, D29)", () => {
  it("lists every app activity type except the legacy description edit", () => {
    const types = schema.tables.activityLog.validator;
    const all = types.kind === "union" ? types.members.map((m) => (m.kind === "object" ? m.fields.type : null)) : [];
    const literals = all.map((v) => (v && v.kind === "literal" ? v.value : null)).filter((v) => v !== "description_changed");
    expect([...CHANGE_TYPES].sort()).toEqual([...literals].sort());
  });

  it("shows a teammate's tick and comment, hides the bot's own writes, and resumes exactly", async () => {
    const t = createT();
    await setup(t);
    // The bot (admin via Claude) builds a checklist and assigns Alice.
    const parent = (await saveTasks(t, "admin", [{ title: "Checklist", assignees: [email("alice")] }])).items[0].identifier;
    const sub = (await saveTasks(t, "admin", [{ parent, title: "szűrők" }])).items[0].identifier;
    // Alice ticks it and comments, through the same client (a teammate on Claude too).
    await saveTasks(t, "alice", [{ ref: sub, done: true }]);
    await saveComments(t, "alice", [{ task: parent, body: "Filters are done" }]);

    // (The fixture's own tasks, created through the app, are filtered out here.)
    const mine = await changes(t, "admin", { excludeSelf: true });
    const checklistChanges = mine.changes.filter((c) => c.task.identifier === parent || c.task.identifier === sub);
    expect(checklistChanges.map((c) => [c.task.identifier, c.actor, c.type])).toEqual([
      [sub, "Alice", "status_changed"],
      [parent, "Alice", "subtask_completed"],
      [parent, "Alice", "comment_added"],
    ]);
    expect(checklistChanges[1].metadata).toMatchObject({ title: "szűrők" });
    expect(checklistChanges[2].comment).toMatchObject({ text: "Filters are done", truncated: false, deleted: false });
    expect(checklistChanges.every((c) => c.via === "Claude")).toBe(true);

    // Without exclude_self the bot's writes are there too; paging resumes exactly.
    const full = await changes(t, "admin");
    expect(full.changes.length).toBeGreaterThan(mine.changes.length);
    const paged: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await changes(t, "admin", { limit: 2, ...(cursor ? { cursor } : {}) });
      paged.push(...page.changes.map((c) => `${c.at}:${c.type}:${c.task.identifier}`));
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(paged).toEqual(full.changes.map((c) => `${c.at}:${c.type}:${c.task.identifier}`));
    // Nothing new since the last cursor.
    expect((await changes(t, "admin", { cursor })).changes).toEqual([]);
    await saveComments(t, "alice", [{ task: parent, body: "One more" }]);
    expect((await changes(t, "admin", { cursor })).changes.map((c) => c.type)).toEqual(["comment_added"]);
    // types filter.
    expect((await changes(t, "admin", { types: ["subtask_completed"] })).changes).toHaveLength(1);
    await expect(changes(t, "admin", { types: ["nope"] })).rejects.toThrow("Unknown change type nope");
    await expect(changes(t, "admin", { cursor: "garbage" })).rejects.toThrow("Invalid changes cursor");
  });

  it("caps comment text at 500 characters, can leave text out, and never shows unreadable tasks", async () => {
    const t = createT();
    const f = await setup(t);
    const long = `${"word ".repeat(150)}end`;
    await saveComments(t, "admin", [{ task: f.id.A, body: long }]);
    await saveComments(t, "admin", [{ task: f.id.U, body: "Secret admin note" }]);
    await t.run(async (ctx) => {
      // An app write by Alice (no via).
      const access = await loadTaskForWrite(ctx, f.A, { ...f.adminAuth, userId: f.alice, orgRole: "member", isAdmin: false, user: (await ctx.db.get(f.alice))! });
      await createCommentForAuth(ctx, access, { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "App comment" }] }] } });
      await createTask(ctx, f.adminAuth, { title: "Hidden", assigneeIds: [f.admin] }, { notify: false });
    });

    const admin = await changes(t, "admin", { types: ["comment_added"] });
    const capped = admin.changes.find((c) => c.task.identifier === f.id.A && c.via === "Claude")!;
    expect(capped.comment!.truncated).toBe(true);
    expect(capped.comment!.text!.length).toBeLessThanOrEqual(500);
    expect(admin.changes.find((c) => c.via === null)?.comment?.text).toBe("App comment");

    const noText = await changes(t, "admin", { types: ["comment_added"], includeText: false });
    expect(noText.changes.every((c) => c.comment?.text === null && c.comment.deleted === false)).toBe(true);

    // Alice reads A only: U's comment and the hidden task never appear.
    const alice = await changes(t, "alice");
    expect(alice.changes.every((c) => c.task.identifier === f.id.A)).toBe(true);
    expect(JSON.stringify(alice)).not.toContain("Secret admin note");
    expect(JSON.stringify(alice)).not.toContain("Hidden");
  });

  it("never shows another org's changes", async () => {
    const t = createT();
    await setup(t);
    await saveTasks(t, "other", [{ title: "Other org work" }]);
    const ours = await changes(t, "admin");
    expect(JSON.stringify(ours)).not.toContain("Other org work");
  });
});

// ─── Review round 1: external refs as task refs, archive, fidelity ──────────

describe("external refs are task refs everywhere (D-EXTREF)", () => {
  it("a checklist built in one call through external refs, rerun-safe", async () => {
    const t = createT();
    await setup(t);
    const items = [
      { title: "Reply to Arlo", project: "ARLO", externalRefs: ["gmail:T"] },
      { title: "Send mockups", parent: "gmail:T", externalRefs: ["gmail:T#1"] },
      { title: "Book call", parent: "gmail:T", externalRefs: ["gmail:T#2"], before: "gmail:T#1" },
    ];
    const first = await saveTasks(t, "admin", items);
    expect(first.items.map((i) => i.action)).toEqual(["created", "created", "created"]);
    const rerun = await saveTasks(t, "admin", items);
    expect(rerun.items.map((i) => i.action)).toEqual(["unchanged", "unchanged", "unchanged"]);
    expect(rerun.items.map((i) => i.identifier)).toEqual(first.items.map((i) => i.identifier));
    expect((await allTasks(t)).filter((task) => task.title === "Send mockups")).toHaveLength(1);

    const [parent] = (await as(t, "admin").query(api.mcp.fetch.records, { refs: ["gmail:T"], include: ["subtasks"], now: Date.now() })).results;
    if (!parent.ok || parent.record.type !== "task") throw new Error("expected a task");
    expect(parent.record.subtasks!.rows.map((s) => s.title)).toEqual(["Book call", "Send mockups"]);

    // Comment target and search task filter by external ref.
    const comment = await saveComments(t, "admin", [{ task: "gmail:T#1", body: "Sent" }]);
    expect(comment.items[0].task).toBe(first.items[1].identifier);
    const found = await as(t, "admin").query(api.mcp.search.comments, {
      offset: 0, limit: 25, task: "gmail:T#1", updated: {}, now: Date.now(),
    });
    expect(found.rows.map((r) => r.id)).toEqual([comment.items[0].commentId]);
    // Delete by external ref; the ref is freed and unknown refs are not found.
    await remove(t, "admin", ["gmail:T#2"]);
    await expect(remove(t, "admin", ["gmail:T#2"])).rejects.toThrow("gmail:T#2 not found");
  });

  it("other orgs' and unreadable refs are not found; reserved sources are refused", async () => {
    const t = createT();
    await setup(t);
    await saveTasks(t, "other", [{ title: "Theirs", externalRefs: ["gmail:theirs"] }]);
    await expect(saveTasks(t, "admin", [{ ref: "gmail:theirs", title: "x" }])).rejects.toThrow("gmail:theirs not found");
    await saveTasks(t, "admin", [{ title: "Admin's", assignees: [email("admin")], externalRefs: ["gmail:adm"] }]);
    await expect(saveComments(t, "alice", [{ task: "gmail:adm", body: "x" }])).rejects.toThrow("gmail:adm not found");
    await expect(saveTasks(t, "admin", [{ title: "x", externalRefs: ["client:KONV"] }])).rejects.toThrow("Invalid external ref");
    await expect(saveTasks(t, "admin", [{ title: "x", externalRefs: ["project:ARLO"] }])).rejects.toThrow("Invalid external ref");
  });

  it("caps refs per task", async () => {
    const t = createT();
    await setup(t);
    const key = (await saveTasks(t, "admin", [{ title: "Many" }])).items[0].identifier;
    for (let batch = 0; batch < 5; batch++) {
      const refs = Array.from({ length: 20 }, (_, i) => `slack:${batch}-${i}`);
      await saveTasks(t, "admin", [{ ref: key, externalRefs: refs }]);
    }
    await expect(saveTasks(t, "admin", [{ ref: key, externalRefs: ["slack:one-more"] }])).rejects.toThrow("at most 100 external refs");
  });
});

describe("archive and restore (D-ARCHIVE) and archived refs", () => {
  it("archives and restores through the app's paths; members may archive what they can open", async () => {
    const t = createT();
    const f = await setup(t);
    expect((await saveTasks(t, "alice", [{ ref: f.id.A, archived: true }])).items[0].action).toBe("updated");
    expect((await taskBy(t, f.id.A)).archivedAt).toBeDefined();
    expect((await saveTasks(t, "alice", [{ ref: f.id.A, archived: true }])).items[0].action).toBe("unchanged");
    await expect(saveTasks(t, "bob", [{ ref: f.id.A, archived: false }])).rejects.toThrow("not found");
    expect((await saveTasks(t, "alice", [{ ref: f.id.A, archived: false, title: "Back" }])).items[0].action).toBe("updated");
    const task = await taskBy(t, f.id.A);
    expect(task.archivedAt).toBeUndefined();
    expect(task.title).toBe("Back");
    await expect(saveTasks(t, "admin", [{ title: "New", archived: true }])).rejects.toThrow("archived applies to existing tasks");
  });

  it("an external ref that finds an archived card is refused unless the item restores it", async () => {
    const t = createT();
    await setup(t);
    const key = (await saveTasks(t, "admin", [{ title: "Old thread", externalRefs: ["gmail:old"] }])).items[0].identifier;
    await saveTasks(t, "admin", [{ ref: key, archived: true }]);
    await expect(saveTasks(t, "admin", [{ title: "Old thread again", externalRefs: ["gmail:old"] }])).rejects.toThrow(
      `gmail:old is on archived ${key}; set archived: false on it to restore it.`,
    );
    const restored = await saveTasks(t, "admin", [{ title: "Old thread again", externalRefs: ["gmail:old"], archived: false }]);
    expect(restored.items[0]).toMatchObject({ identifier: key, action: "updated", title: "Old thread again" });
  });
});

describe("review round 1 gaps", () => {
  it("an assignee-only update reports updated", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await saveTasks(t, "admin", [{ ref: f.id.A, assignees: [email("alice"), email("bob")] }]);
    expect(result.items[0].action).toBe("updated");
    expect((await taskBy(t, f.id.A)).assigneeIds).toEqual([f.alice, f.bob]);
  });

  it("a member cannot create a sub-task under a parent they cannot read", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(saveTasks(t, "alice", [{ parent: f.id.U, title: "Sneaky" }])).rejects.toThrow(`${f.id.U} not found`);
  });

  it("mentions of non-members and other-org members are refused", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(saveComments(t, "admin", [{ task: f.id.A, body: `hi @${email("other")}` }])).rejects.toThrow(
      `@${email("other")} is not a member of this workspace`,
    );
  });

  it("a fetched description with a mention saves back with the mention intact", async () => {
    const t = createT();
    const f = await setup(t);
    const key = (await saveTasks(t, "admin", [{ title: "Brief", description: `Ask @${email("alice")} about *this*` }])).items[0].identifier;
    const [r] = (await as(t, "admin").query(api.mcp.fetch.records, { refs: [key], include: [], now: Date.now() })).results;
    if (!r.ok || r.record.type !== "task") throw new Error("expected a task");
    expect(r.record.description).toBe(`Ask @${email("alice")} about *this*`);
    const before = (await taskBy(t, key)).description;
    const saved = await saveTasks(t, "admin", [{ ref: key, description: r.record.description! }]);
    expect(saved.items[0].action).toBe("unchanged");
    expect((await taskBy(t, key)).description).toBe(before);
    expect(JSON.parse(before!).content[0].content).toContainEqual({ type: "mention", attrs: { id: f.alice, label: "Alice" } });
  });

  it("a rewrite that drops editor-only formatting says so", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.A, f.adminAuth);
      await updateTask(ctx, access, {
        description: JSON.stringify({
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Key", marks: [{ type: "underline" }] }] }],
        }),
      });
    });
    const result = await saveTasks(t, "admin", [{ ref: f.id.A, description: "Key" }]);
    expect(result.items[0]).toMatchObject({ action: "updated", formattingRemoved: ["underline"] });
  });

  it("delete errors name the ref's own position", async () => {
    const t = createT();
    const f = await setup(t);
    const own = (await saveComments(t, "alice", [{ task: f.id.A, body: "mine" }])).items[0].commentId;
    // The duplicate is skipped; the failing task is still "Item 3", its place in refs.
    await expect(remove(t, "alice", [own, own, f.id.A])).rejects.toThrow(`Item 3 (${f.id.A}): Only admins can delete tasks.`);
    // All-or-nothing: the comment is still there.
    expect(await t.run(async (ctx) => await ctx.db.get(own))).not.toBeNull();
  });
});

// @vitest-environment edge-runtime
//
// MCP slice 7a (docs/prd-mcp.md §6, §13): save_plan, save_daily_notes, the
// daily_note search type, fetch("inbox") and mark_read, with OAuth identities.
//   Planner: members only their own row, lane order untouched, app parity
//   Daily notes: your own note; members see only their own, admins anyone's
//   Inbox: only the caller's items, unread first, the cursor pages exactly
//   mark_read: idempotent, the same documents as the app's actions
//   D23 idempotency replay / mismatch

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { loadTaskForWrite } from "../tasks/access";
import { createCommentForAuth } from "../comments";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp7b";
const OTHER = "org_mcp7b_other";
const NOW = Date.UTC(2026, 9, 24, 12);

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string, "admin" | "member"]> = {
  admin: ["clerk_admin", ORG, "admin"],
  alice: ["clerk_alice", ORG, "member"],
  bob: ["clerk_bob", ORG, "member"],
  other: ["clerk_other", OTHER, "admin"],
};

const as = (t: T, caller: Caller, clientId = "client_claude") =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: clientId, org_id: SUBJECT[caller][1] });

const inApp = (t: T, caller: Caller) =>
  t.withIdentity({
    subject: SUBJECT[caller][0],
    tokenIdentifier: `test|${SUBJECT[caller][0]}`,
    org_id: SUBJECT[caller][1],
    org_role: SUBJECT[caller][2] === "admin" ? "org:admin" : "org:member",
  });

const email = (caller: Caller) => `${SUBJECT[caller][0]}@x.test`;

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

async function setup(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
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
        orgId, brandName: orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
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
      orgId: ORG, clientId: client, name: "Arlow site", code: "ARLO", billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const A = await createTask(ctx, adminAuth, { title: "Alice task", projectId: arlo, assigneeIds: [alice] }, { notify: false });
    const B = await createTask(ctx, adminAuth, { title: "Bob task", projectId: arlo, assigneeIds: [bob] }, { notify: false });
    const otherAuth: AuthContext = { userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))! };
    const X = await createTask(ctx, otherAuth, { title: "Elsewhere" }, { notify: false });
    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier!;
    return { admin, alice, bob, other, arlo, adminAuth, A, B, X, id: { A: await identifier(A), B: await identifier(B) } };
  });
}

type Item = Record<string, unknown>;
const savePlan = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.savePlan, { items: items as never, clientName: "Claude", ...extra });
const saveNote = (t: T, caller: Caller, args: { content: string; date?: string; append?: boolean; idempotencyKey?: string }) =>
  as(t, caller).mutation(api.mcp.write.saveDailyNotes, { ...args, clientName: "Claude" });
const markRead = (t: T, caller: Caller, refs: string[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.markRead, { refs, clientName: "Claude", ...extra });
const inbox = (t: T, caller: Caller, args: { cursor?: string; limit?: number; includeRead?: boolean } = {}) =>
  as(t, caller).query(api.mcp.fetch.inbox, { cursor: args.cursor, includeRead: args.includeRead ?? false, limit: args.limit ?? 25, now: NOW });
const noteSearch = (t: T, caller: Caller, args: Record<string, unknown> = {}) =>
  as(t, caller).query(api.mcp.search.dailyNotes, { offset: 0, limit: 25, date: {}, updated: {}, now: NOW, ...args });

const segments = (t: T) =>
  t.run(async (ctx) => await ctx.db.query("planSegments").withIndex("by_orgId_startDate", (q) => q.eq("orgId", ORG)).collect());

describe("save_plan", () => {
  it("creates bars like the Planner (same document as createSegment) and keeps lane order on a move", async () => {
    const t = createT();
    const f = await setup(t);
    const appId = await inApp(t, "alice").mutation(api.planner.createSegment, {
      taskId: f.A, userId: f.alice, startDate: "2026-10-26", endDate: "2026-10-28",
    });
    const created = await savePlan(t, "alice", [{ task: f.id.A, member: "me", startDate: "2026-10-26", endDate: "2026-10-28" }]);
    expect(created.items[0]).toMatchObject({
      task: { identifier: f.id.A, title: "Alice task" }, member: { id: f.alice, name: "Alice" },
      startDate: "2026-10-26", endDate: "2026-10-28", action: "created",
    });
    const rows = await segments(t);
    const strip = (s: (typeof rows)[number]) => ({ ...s, _id: null, _creationTime: null, createdAt: null, updatedAt: null });
    const app = rows.find((s) => s._id === appId)!;
    const mcp = rows.find((s) => s._id === created.items[0].segmentId)!;
    expect(strip(mcp)).toEqual(strip(app));

    // One-day default; move + resize keep createdAt and laneOrder (stable lane packing).
    const day = await savePlan(t, "alice", [{ task: f.id.A, startDate: "2026-11-02" }]);
    expect(day.items[0]).toMatchObject({ startDate: "2026-11-02", endDate: "2026-11-02", member: { id: f.alice } });
    const moved = await savePlan(t, "alice", [{ ref: mcp._id, startDate: "2026-10-27", endDate: "2026-10-30" }]);
    expect(moved.items[0]).toMatchObject({ action: "updated", startDate: "2026-10-27", endDate: "2026-10-30" });
    const after = (await segments(t)).find((s) => s._id === mcp._id)!;
    expect(after.createdAt).toBe(mcp.createdAt);
    expect(after.laneOrder).toBe(mcp.laneOrder);
    expect((await savePlan(t, "alice", [{ ref: mcp._id, endDate: "2026-10-30" }])).items[0].action).toBe("unchanged");

    // delete unschedules the bar (the destructive tool); the task stays.
    const removed = await as(t, "alice").mutation(api.mcp.write.remove, { refs: [mcp._id], clientName: "Claude" });
    expect(removed.items[0]).toMatchObject({ type: "plan_segment", action: "deleted", label: `planner bar 2026-10-27 – 2026-10-30 · Alice on ${f.id.A}` });
    expect((await segments(t)).some((s) => s._id === mcp._id)).toBe(false);
    expect(await t.run(async (ctx) => await ctx.db.get(f.A))).not.toBeNull();
  });

  it("members plan only their own row and tasks they can open; admins plan anyone's", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(savePlan(t, "alice", [{ task: f.id.A, member: email("bob"), startDate: "2026-10-26" }])).rejects.toThrow(
      "You can only manage your own plan",
    );
    await expect(savePlan(t, "alice", [{ task: f.id.B, startDate: "2026-10-26" }])).rejects.toThrow(`${f.id.B} not found`);
    const bobs = await savePlan(t, "admin", [{ task: f.id.B, member: email("bob"), startDate: "2026-10-26", endDate: "2026-10-27" }]);
    const bar = bobs.items[0].segmentId;
    await expect(savePlan(t, "alice", [{ ref: bar, startDate: "2026-10-29" }])).rejects.toThrow("You can only manage your own plan");
    await expect(as(t, "alice").mutation(api.mcp.write.remove, { refs: [bar] })).rejects.toThrow("You can only manage your own plan");
    await expect(as(t, "other").mutation(api.mcp.write.remove, { refs: [bar] })).rejects.toThrow("not found");
    // Every member reads the shared board: the bar can be fetched.
    const fetched = (await as(t, "alice").query(api.mcp.fetch.records, { refs: [bar], include: [], now: NOW })).results[0];
    expect(fetched.ok && fetched.record).toMatchObject({ type: "plan_segment", member: { name: "Bob" }, mine: false });
    await expect(savePlan(t, "bob", [{ ref: bar, member: email("alice") }])).rejects.toThrow("You can only manage your own plan");
    expect((await savePlan(t, "bob", [{ ref: bar, startDate: "2026-10-27" }])).items[0].action).toBe("updated");
    // Other org: the task and the bar are not found.
    await expect(savePlan(t, "other", [{ ref: bar, startDate: "2026-10-29" }])).rejects.toThrow("not found");
    await expect(savePlan(t, "admin", [{ task: f.X, startDate: "2026-10-26" }])).rejects.toThrow("not found");
    // A bar's task never changes; all-or-nothing.
    await expect(savePlan(t, "admin", [{ ref: bar, task: f.id.A }])).rejects.toThrow("task cannot change");
    const before = (await segments(t)).length;
    await expect(
      savePlan(t, "admin", [{ task: f.id.A, startDate: "2026-10-26" }, { task: f.id.A, startDate: "2026-10-30", endDate: "2026-10-29" }]),
    ).rejects.toThrow("Item 2");
    expect((await segments(t)).length).toBe(before);
  });

  it("replays an idempotency key and refuses it for another request", async () => {
    const t = createT();
    const f = await setup(t);
    const first = await savePlan(t, "alice", [{ task: f.id.A, startDate: "2026-10-26" }], { idempotencyKey: "p1" });
    const replay = await savePlan(t, "alice", [{ task: f.id.A, startDate: "2026-10-26" }], { idempotencyKey: "p1" });
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await segments(t)).length).toBe(1);
    await expect(savePlan(t, "alice", [{ task: f.id.A, startDate: "2026-10-27" }], { idempotencyKey: "p1" })).rejects.toThrow("different request");
  });

  it("fetch include plan lists a task's bars with their refs", async () => {
    const t = createT();
    const f = await setup(t);
    const saved = await savePlan(t, "admin", [
      { task: f.id.A, member: email("alice"), startDate: "2026-10-26", endDate: "2026-10-27" },
      { task: f.id.A, member: "me", startDate: "2026-11-02" },
    ]);
    const data = await as(t, "alice").query(api.mcp.fetch.records, { refs: [f.id.A], include: ["plan"], now: NOW });
    const record = data.results[0];
    expect(record.ok && record.record.type === "task" && record.record.plan).toEqual({
      rows: [
        { id: saved.items[0].segmentId, member: "Alice", mine: true, startDate: "2026-10-26", endDate: "2026-10-27", partIndex: 1, partCount: 2 },
        { id: saved.items[1].segmentId, member: "Admin", mine: false, startDate: "2026-11-02", endDate: "2026-11-02", partIndex: 2, partCount: 2 },
      ],
      truncated: false,
    });
  });
});

describe("save_daily_notes and the daily_note search type", () => {
  it("writes your own note: create, append, replace, unchanged, clear", async () => {
    const t = createT();
    const f = await setup(t);
    const created = await saveNote(t, "alice", { content: "- Sent mockups", date: "2026-10-24", append: false });
    expect(created).toMatchObject({ tool: "save_daily_notes", date: "2026-10-24", action: "created", replayed: false });
    // Appending is the default.
    const appended = await saveNote(t, "alice", { content: `Ask @${email("bob")}`, date: "2026-10-24" });
    expect(appended).toMatchObject({ action: "updated", noteId: created.noteId });
    const stored = await t.run(async (ctx) => (await ctx.db.get(created.noteId))!);
    expect(stored).toMatchObject({ orgId: ORG, userId: f.alice, date: "2026-10-24" });
    const content = JSON.parse(stored.content!);
    expect(content.content).toHaveLength(2);
    expect(JSON.stringify(content)).toContain(`"type":"mention","attrs":{"id":"${f.bob}"`);
    // The app's upsert with the same content stores the same document.
    expect((await saveNote(t, "alice", { content: `- Sent mockups\n\nAsk @${email("bob")}`, date: "2026-10-24", append: false })).action).toBe("unchanged");
    const replaced = await saveNote(t, "alice", { content: "Rewritten", date: "2026-10-23" });
    expect(replaced.replacedExisting).toBeUndefined();
    expect((await saveNote(t, "alice", { content: "New text", date: "2026-10-23", append: false })).replacedExisting).toBe(true);
    await inApp(t, "alice").mutation(api.dailyNotes.upsert, { userId: f.alice, date: "2026-10-25", content: stored.content });
    const appNote = await t.run(async (ctx) =>
      (await ctx.db.query("dailyNotes").withIndex("by_userId_date", (q) => q.eq("userId", f.alice).eq("date", "2026-10-25")).first())!,
    );
    expect(appNote.content).toBe(stored.content);

    await expect(saveNote(t, "alice", { content: "", date: "2026-10-24" })).rejects.toThrow("nothing to append");
    expect((await saveNote(t, "alice", { content: "", date: "2026-10-24", append: false })).action).toBe("updated");
    expect((await t.run(async (ctx) => await ctx.db.get(created.noteId)))!.content).toBeUndefined();
    await expect(saveNote(t, "alice", { content: "  ", date: "2026-10-26", append: false })).rejects.toThrow("nothing to save");
    await expect(saveNote(t, "alice", { content: "@nobody@x.test hi" })).rejects.toThrow("is not a member");
    // Default date: today in the org timezone.
    const today = await saveNote(t, "bob", { content: "Today" });
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("members find and fetch only their own notes; admins any member's", async () => {
    const t = createT();
    const f = await setup(t);
    const alices = await saveNote(t, "alice", { content: "Pricing page draft", date: "2026-10-20" });
    await saveNote(t, "alice", { content: "Hero mockups", date: "2026-10-22" });
    await saveNote(t, "bob", { content: "Bob's day", date: "2026-10-22" });

    const own = await noteSearch(t, "alice");
    expect(own.rows.map((r) => [r.date, r.preview, r.own])).toEqual([["2026-10-22", "Hero mockups", true], ["2026-10-20", "Pricing page draft", true]]);
    expect((await noteSearch(t, "alice", { query: "pricing" })).rows.map((r) => r.date)).toEqual(["2026-10-20"]);
    expect((await noteSearch(t, "alice", { date: { from: "2026-10-21" } })).rows.map((r) => r.date)).toEqual(["2026-10-22"]);
    await expect(noteSearch(t, "alice", { assignee: email("bob") })).rejects.toThrow("Members can search only their own daily notes");
    const asAdmin = await noteSearch(t, "admin", { assignee: email("alice") });
    expect(asAdmin.rows.map((r) => [r.date, r.member.name, r.own])).toEqual([["2026-10-22", "Alice", false], ["2026-10-20", "Alice", false]]);

    const fetchNote = (caller: Caller) => as(t, caller).query(api.mcp.fetch.records, { refs: [alices.noteId], include: [], now: NOW });
    const mine = (await fetchNote("alice")).results[0];
    expect(mine.ok && mine.record).toMatchObject({ type: "daily_note", date: "2026-10-20", own: true, text: "Pricing page draft" });
    expect((await fetchNote("bob")).results[0]).toMatchObject({ ok: false });
    expect((await fetchNote("admin")).results[0]).toMatchObject({ ok: true });
    expect((await fetchNote("other")).results[0]).toMatchObject({ ok: false });
    // No delete for notes, as in the app.
    await expect(as(t, "alice").mutation(api.mcp.write.remove, { refs: [alices.noteId] })).rejects.toThrow("the app has no delete for notes");
    void f;
  });
});

describe("fetch(inbox) and mark_read", () => {
  /** Alice gets one assignment and `comments` comment notifications from the admin. */
  async function notify(t: T, f: Awaited<ReturnType<typeof setup>>, comments: number) {
    await t.run(async (ctx) => {
      const task = await createTask(ctx, f.adminAuth, { title: "Assigned to Alice", projectId: f.arlo, assigneeIds: [f.alice] });
      const access = await loadTaskForWrite(ctx, f.A, f.adminAuth);
      for (let i = 1; i <= comments; i += 1) await createCommentForAuth(ctx, access, { content: doc(`Comment ${i} ${"x".repeat(i === 1 ? 600 : 0)}`) });
      // Bob's own notification never shows in Alice's inbox.
      const bobAccess = await loadTaskForWrite(ctx, f.B, f.adminAuth);
      await createCommentForAuth(ctx, bobAccess, { content: doc("For Bob") });
      return task;
    });
  }

  it("lists only the caller's items, unread first, and pages exactly with the cursor", async () => {
    const t = createT();
    const f = await setup(t);
    await notify(t, f, 4);
    const all = await inbox(t, "alice", { limit: 100, includeRead: true });
    expect(all.items).toHaveLength(5);
    expect(all.unreadCount).toBe(5);
    expect(all.cursor).toBeNull();
    expect(all.items.every((i) => i.task.identifier !== f.id.B)).toBe(true);
    const first = all.items.find((i) => i.type === "comment" && i.text?.text.startsWith("Comment 1"))!;
    expect(first.text).toMatchObject({ truncated: true, snapshot: false });
    expect(first.text!.text.length).toBeLessThanOrEqual(501);

    // Read one: by default only the 4 unread are listed, and the result says read items exist.
    await markRead(t, "alice", [all.items[0].id]);
    const unreadOnly = await inbox(t, "alice", { limit: 100 });
    expect(unreadOnly.items.map((i) => i.unread)).toEqual([true, true, true, true]);
    expect(unreadOnly).toMatchObject({ readHidden: true, includeRead: false, cursor: null });
    // include_read, paged by 2: unread first, no item twice, none missing.
    const seen: string[] = [];
    const states: boolean[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const res = await inbox(t, "alice", { limit: 2, cursor, includeRead: true });
      seen.push(...res.items.map((i) => i.id));
      states.push(...res.items.map((i) => i.unread));
      if (!res.cursor) break;
      cursor = res.cursor;
    }
    expect([...seen].sort()).toEqual(all.items.map((i) => i.id).sort());
    expect(states).toEqual([true, true, true, true, false]);
    await expect(inbox(t, "alice", { cursor: "nope" })).rejects.toThrow("Invalid inbox cursor");
    const page = await inbox(t, "alice", { limit: 1, includeRead: true });
    await expect(inbox(t, "alice", { cursor: page.cursor! })).rejects.toThrow("different include_read");
    expect((await inbox(t, "other")).items).toEqual([]);
  });

  it("mark_read is idempotent and writes what the app's actions write", async () => {
    const t = createT();
    const f = await setup(t);
    await notify(t, f, 2);
    const { items } = await inbox(t, "alice");
    const [a, b] = items.filter((i) => i.type === "comment");

    await inApp(t, "alice").mutation(api.notifications.markRead, { ids: [a.id] });
    const first = await markRead(t, "alice", [b.id]);
    expect(first.items[0]).toMatchObject({ type: "notification", action: "marked_read" });
    const rows = await t.run(async (ctx) => ({ a: (await ctx.db.get(a.id))!, b: (await ctx.db.get(b.id))! }));
    expect(rows.b.inboxState).toBe(rows.a.inboxState);
    expect(Object.keys(rows.b).sort()).toEqual(Object.keys(rows.a).sort());

    const again = await markRead(t, "alice", [b.id]);
    expect(again.items[0].action).toBe("already_read");
    expect((await t.run(async (ctx) => await ctx.db.get(b.id)))!.readAt).toBe(rows.b.readAt);

    // Someone else's item is not found; another org's too.
    const bobsItem = await t.run(async (ctx) =>
      (await ctx.db.query("notifications").withIndex("by_recipient_org_state", (q) => q.eq("recipientId", f.bob).eq("orgId", ORG).eq("inboxState", "unread")).first())!,
    );
    await expect(markRead(t, "alice", [bobsItem._id])).rejects.toThrow("Inbox item");
    await expect(markRead(t, "other", [b.id])).rejects.toThrow("not found");

    // A task ref = opening the task (markViewed): comments and its inbox items read.
    const before = await t.run(async (ctx) =>
      (await ctx.db.query("taskUserState").withIndex("by_taskId_userId", (q) => q.eq("taskId", f.A).eq("userId", f.alice)).first())!,
    );
    expect(before.unreadComments).toBe(2);
    const viewed = await markRead(t, "alice", [f.id.A]);
    expect(viewed.items[0]).toMatchObject({ type: "task", action: "marked_read" });
    const state = await t.run(async (ctx) =>
      (await ctx.db.query("taskUserState").withIndex("by_taskId_userId", (q) => q.eq("taskId", f.A).eq("userId", f.alice)).first())!,
    );
    expect(state).toMatchObject({ unreadComments: 0, hasUnseenChanges: false });
    expect((await markRead(t, "alice", [f.id.A])).items[0].action).toBe("already_read");
    await expect(markRead(t, "alice", [f.id.B])).rejects.toThrow("not found");

    // "inbox" = Mark all as read; then nothing is unread.
    const all = await markRead(t, "alice", ["inbox"]);
    expect(all.items[0]).toMatchObject({ type: "inbox", action: "marked_read", count: 1 });
    expect((await inbox(t, "alice")).unreadCount).toBe(0);
    expect((await markRead(t, "alice", ["inbox"])).items[0]).toMatchObject({ action: "already_read", count: 0 });

    // A comment ref is read with its task (the app's granularity); other kinds are refused.
    const commentId = await t.run(async (ctx) =>
      await createCommentForAuth(ctx, await loadTaskForWrite(ctx, f.A, f.adminAuth), { content: doc("One more") }),
    );
    const byComment = await markRead(t, "alice", [commentId]);
    expect(byComment.items[0]).toMatchObject({ type: "comment", action: "marked_read", label: `${f.id.A} · Alice task` });
    expect((await inbox(t, "alice")).unreadCount).toBe(0);
    await expect(markRead(t, "alice", ["ARLO"])).rejects.toThrow("mark_read takes inbox items");

    // Idempotency key: replay returns the first result.
    const k1 = await markRead(t, "alice", ["inbox"], { idempotencyKey: "m1" });
    expect(await markRead(t, "alice", ["inbox"], { idempotencyKey: "m1" })).toEqual({ ...k1, replayed: true });
  });

  it('"inbox" marks at most 200 per call and says when more may remain', async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < 205; i += 1) {
        await ctx.db.insert("notifications", {
          orgId: ORG, recipientId: f.alice, actorId: f.admin, type: "assigned", taskId: f.A, previewText: "Alice task",
          inboxState: "unread", createdAt: 1_000 + i, updatedAt: 1_000 + i,
        });
      }
    });
    const first = await markRead(t, "alice", ["inbox"]);
    expect(first.items[0]).toMatchObject({ type: "inbox", count: 200, more: true });
    const second = await markRead(t, "alice", ["inbox"]);
    expect(second.items[0]).toMatchObject({ count: 5 });
    expect(second.items[0].more).toBeUndefined();
  });

  it("a deleted comment or an unreadable task falls back to the stored preview", async () => {
    const t = createT();
    const f = await setup(t);
    const [kept, gone] = await t.run(async (ctx) => {
      const access = await loadTaskForWrite(ctx, f.A, f.adminAuth);
      const a = await createCommentForAuth(ctx, access, { content: doc("Still here") });
      const b = await createCommentForAuth(ctx, access, { content: doc("Soon gone") });
      return [a, b];
    });
    await t.run(async (ctx) => ctx.db.delete(gone));
    let items = (await inbox(t, "alice")).items;
    expect(items.find((i) => i.commentId === gone)!.text).toEqual({ text: "Soon gone", truncated: false, snapshot: true, deleted: true });
    expect(items.find((i) => i.commentId === kept)!.text).toMatchObject({ text: "Still here", snapshot: false });

    // Alice loses access to the task: no live text, only the snapshot the app stored.
    await t.run(async (ctx) => {
      await ctx.db.patch(kept, { content: doc("Edited after the notification") });
      for (const edge of await ctx.db.query("taskAssignees").withIndex("by_taskId_userId", (q) => q.eq("taskId", f.A).eq("userId", f.alice)).collect()) {
        await ctx.db.delete(edge._id);
      }
    });
    items = (await inbox(t, "alice")).items;
    expect(items.find((i) => i.commentId === kept)!.text).toEqual({ text: "Still here", truncated: false, snapshot: true, deleted: false });
    expect(items.find((i) => i.commentId === gone)!.text).toMatchObject({ snapshot: true, deleted: false });
  });
});

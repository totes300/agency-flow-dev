// @vitest-environment edge-runtime
//
// MCP slice 4 (docs/prd-mcp.md §6, §13): save_time_entries, timer and
// delete for time entries through convex/mcp/*, with OAuth identities, plus
// the comment-search ordering fix.
//   app rules  members log / edit / delete only their own time; admins any,
//              and log for others; close-locked entries refused (edit, delete)
//   D1         rates and amounts never input, never in the output
//   D23        an idempotency-key replay returns the first result; another
//              request with the same key is refused
//   I5         one bad item writes nothing
//   category   the app's chain: explicit ?? member default ?? task category,
//              identical to the app's create
//   timer      start / stop create the same entry as the app; one timer
//   D15 / D22  time activity rows carry "via <client>"; exclude_self drops them

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { tzWallToEpoch } from "../../lib/workday";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp4";
const OTHER = "org_mcp4_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string, "admin" | "member"]> = {
  admin: ["clerk_admin", ORG, "admin"],
  alice: ["clerk_alice", ORG, "member"],
  bob: ["clerk_bob", ORG, "member"],
  other: ["clerk_other", OTHER, "admin"],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const as = (t: T, caller: Caller, clientId = "client_claude") =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: clientId, org_id: SUBJECT[caller][1] });

/** An app session token (the UI surface). */
const inApp = (t: T, caller: Caller) =>
  t.withIdentity({
    subject: SUBJECT[caller][0],
    tokenIdentifier: `test|${SUBJECT[caller][0]}`,
    org_id: SUBJECT[caller][1],
    org_role: SUBJECT[caller][2] === "admin" ? "org:admin" : "org:member",
  });

const email = (caller: Caller) => `${SUBJECT[caller][0]}@x.test`;

/**
 * A T&M project with two rated categories, so the category chain decides the
 * rate: Design (120, the task's) and Development (100, Alice's default).
 * Bob has no default (falls back to the task's category).
 */
/** The fixture, with every member connected through the OAuth clients this file uses. */
async function setup(t: T) {
  const fixture = await setupData(t);
  await t.run((ctx) => connectMembers(ctx, ["client_claude", "client_codex"]));
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
    const other = await mkUser("Other", "clerk_other");
    const design = await ctx.db.insert("workCategories", { orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin });
    const dev = await ctx.db.insert("workCategories", { orgId: ORG, name: "Development", color: "green", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin });
    for (const [userId, clerkUserId, role, orgId, defaultWorkCategoryId] of [
      [admin, "clerk_admin", "admin", ORG, undefined],
      [alice, "clerk_alice", "member", ORG, dev],
      [bob, "clerk_bob", "member", ORG, undefined],
      [other, "clerk_other", "admin", OTHER, undefined],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now, defaultWorkCategoryId });
      await ctx.db.insert("userRates", { orgId, userId, currency: "EUR", costRate: 40, createdAt: now, updatedAt: now });
    }
    for (const [workCategoryId, defaultBillRate] of [[design, 120], [dev, 100]] as const) {
      await ctx.db.insert("categoryRates", { orgId: ORG, workCategoryId, currency: "EUR", defaultBillRate, createdAt: now, updatedAt: now });
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
    const mk = (title: string, assigneeIds: Id<"users">[]) =>
      createTask(ctx, adminAuth, { title, projectId: arlo, assigneeIds, workCategoryId: design }, { notify: false });
    const A = await mk("Alice task", [alice]);
    const B = await mk("Bob task", [bob]);
    const AB = await mk("Shared task", [alice, bob]);
    const noProject = await createTask(ctx, adminAuth, { title: "Lead", assigneeIds: [alice] }, { notify: false });
    const otherAuth: AuthContext = { userId: other, orgId: OTHER, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(other))! };
    const foreignTask = await createTask(ctx, otherAuth, { title: "Foreign secret task", assigneeIds: [other] }, { notify: false });
    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier!;
    return {
      admin, alice, bob, other, design, dev, arlo, client, foreignTask,
      A, B, AB,
      id: { A: await identifier(A), B: await identifier(B), AB: await identifier(AB), noProject: await identifier(noProject) },
    };
  });
}

type Item = Record<string, unknown>;
const save = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}, clientId?: string) =>
  as(t, caller, clientId).mutation(api.mcp.write.saveTimeEntries, { items: items as never, clientName: "Claude", ...extra });
const remove = (t: T, caller: Caller, refs: string[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.remove, { refs, clientName: "Claude", ...extra });
const entries = (t: T) => t.run(async (ctx) => await ctx.db.query("timeEntries").collect());
const entry = (t: T, id: Id<"timeEntries">) => t.run(async (ctx) => (await ctx.db.get(id))!);
const activity = (t: T) => t.run(async (ctx) => await ctx.db.query("activityLog").collect());
const later = () => Date.now() + 60_000;

/** The ledger fields both paths must agree on (ids, owner and timestamps aside). */
function ledger(e: Doc<"timeEntries">) {
  return {
    projectId: e.projectId,
    taskId: e.taskId,
    date: e.date,
    durationMinutes: e.durationMinutes,
    note: e.note,
    isBillable: e.isBillable,
    method: e.method,
    costRate: e.costRate,
    billableRate: e.billableRate,
    rateCurrency: e.rateCurrency,
    snapshotCategoryId: e.snapshotCategoryId,
  };
}

/**
 * Puts an entry into a live close: final without invoice (a closed period),
 * a draft, or final with an issued invoice.
 */
async function lock(t: T, entryId: Id<"timeEntries">, status: "final" | "draft" | "invoiced") {
  await t.run(async (ctx) => {
    const e = (await ctx.db.get(entryId))!;
    const closeId = await ctx.db.insert("billingCloses", {
      orgId: e.orgId, projectId: e.projectId, kind: "t_and_m", periodStart: "2026-09-01", periodEnd: "2026-09-30",
      status: status === "draft" ? "draft" : "final",
      currency: "EUR", roundingMinutes: 15, includedMinutes: 0, overageRateMinor: 0, usageMinutes: e.durationMinutes,
      overageMinutes: 0, amountMinor: 0, committedAt: Date.now(), committedBy: e.createdBy,
    });
    if (status === "invoiced") {
      const project = (await ctx.db.get(e.projectId))!;
      const invoiceId = await ctx.db.insert("invoices", {
        orgId: e.orgId, projectId: e.projectId, clientId: project.clientId, number: 7, prefix: "INV", status: "invoiced",
        currency: "EUR", subtotalMinor: 0, totalMinor: 0, issueDate: "2026-10-01", closeId,
        createdAt: Date.now(), updatedAt: Date.now(), createdBy: e.createdBy,
      });
      await ctx.db.patch(closeId, { invoiceId });
    }
    await ctx.db.patch(entryId, { closeId });
  });
}

// ─── save_time_entries ───────────────────────────────────────────────────────

describe("save_time_entries: logging", () => {
  it("a member logs their own time; the entry equals the app's create for the same input", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await save(t, "alice", [{ task: f.id.A, minutes: 90, date: "2026-10-20", note: "  Hero mockups " }]);
    expect(result).toMatchObject({
      tool: "save_time_entries",
      replayed: false,
      items: [{ task: f.id.A, date: "2026-10-20", minutes: 90, member: "Alice", action: "created" }],
    });
    const mcp = await entry(t, result.items[0].entryId);
    expect(mcp.userId).toBe(f.alice);
    expect(mcp.createdBy).toBe(f.alice);
    // A past date anchors at noon in the org timezone (the form's rule), minus the duration.
    expect(mcp.startedAt).toBe(Date.UTC(2026, 9, 20, 12) - 90 * 60_000);

    // The app's form for the same input: same ledger row.
    const appId = await inApp(t, "alice").mutation(api.timeEntries.create, {
      taskId: f.A, durationMinutes: 90, startedAt: Date.UTC(2026, 9, 20, 12) - 90 * 60_000, date: "2026-10-20", note: "Hero mockups",
    });
    expect(ledger(mcp)).toEqual(ledger(await entry(t, appId)));
    // Alice's default category (Development, 100) beats the task's (Design).
    expect(mcp).toMatchObject({ snapshotCategoryId: f.dev, billableRate: 100, note: "Hero mockups", method: "manual" });
  });

  it("applies the category chain like the app: explicit ?? member default ?? task", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await save(t, "admin", [
      { task: f.id.AB, minutes: 30, member: email("bob") },
      { task: f.id.AB, minutes: 30, member: email("alice") },
      { task: f.id.AB, minutes: 30, member: email("alice"), category: "design" },
    ]);
    const [bob, alice, explicit] = await Promise.all(items.map((i) => entry(t, i.entryId)));
    expect(bob).toMatchObject({ userId: f.bob, createdBy: f.admin, snapshotCategoryId: f.design, billableRate: 120 });
    expect(alice).toMatchObject({ userId: f.alice, snapshotCategoryId: f.dev, billableRate: 100 });
    expect(explicit).toMatchObject({ userId: f.alice, snapshotCategoryId: f.design, billableRate: 120 });
    expect(items.map((i) => i.member)).toEqual(["Bob", "Alice", "Alice"]);
  });

  it("defaults to today in the org timezone", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await save(t, "alice", [{ task: f.id.A, minutes: 15 }]);
    expect(items[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it("only admins log for others; members only on tasks they can open; the app's task rules hold", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(save(t, "alice", [{ task: f.id.A, minutes: 10, member: email("bob") }])).rejects.toThrow(
      "Item 1 (" + f.id.A + "): Only admins can log time for other users. Nothing was saved.",
    );
    await expect(save(t, "alice", [{ task: f.id.B, minutes: 10 }])).rejects.toThrow(`${f.id.B} not found`);
    await expect(save(t, "admin", [{ task: f.id.noProject, minutes: 10 }])).rejects.toThrow("Assign a project first");
    await expect(save(t, "other", [{ task: f.id.A, minutes: 10 }])).rejects.toThrow(`${f.id.A} not found`);
    await expect(save(t, "alice", [{ task: f.id.A }])).rejects.toThrow("minutes is required to log time");
    await expect(save(t, "alice", [{ task: f.id.A, minutes: 2.5 }])).rejects.toThrow("whole number");
    await expect(save(t, "alice", [{ task: f.id.A, minutes: 10, category: "Nope" }])).rejects.toThrow('No work category "Nope"');
    expect(await entries(t)).toHaveLength(0);
  });

  it("never returns rates or amounts", async () => {
    const t = createT();
    const f = await setup(t);
    const result = await save(t, "alice", [{ task: f.id.A, minutes: 60 }]);
    expect(JSON.stringify(result)).not.toMatch(/rate|amount|cost|currency/i);
    const { items } = await save(t, "alice", [{ ref: result.items[0].entryId, minutes: 75 }]);
    expect(Object.keys(items[0]).sort()).toEqual(["action", "billable", "category", "date", "entryId", "member", "minutes", "task"]);
  });
});

describe("save_time_entries: editing", () => {
  it("edits only what differs, re-anchoring a date change like the app", async () => {
    const t = createT();
    const f = await setup(t);
    const created = await save(t, "alice", [{ task: f.id.A, minutes: 60, date: "2026-10-20", note: "Draft" }]);
    const id = created.items[0].entryId;
    const before = await entry(t, id);

    const same = await save(t, "alice", [{ ref: id, minutes: 60, date: "2026-10-20", note: "Draft" }]);
    expect(same.items[0].action).toBe("unchanged");
    expect((await entry(t, id)).updatedAt).toBe(before.updatedAt);

    const edited = await save(t, "alice", [{ ref: id, minutes: 45, date: "2026-10-22", note: null, task: f.id.AB }]);
    expect(edited.items[0]).toMatchObject({ action: "updated", minutes: 45, date: "2026-10-22", task: f.id.AB });
    const after = await entry(t, id);
    expect(after).toMatchObject({ durationMinutes: 45, date: "2026-10-22", taskId: f.AB });
    expect(after.note).toBeUndefined();
    // Same time of day, two days later.
    expect(after.startedAt - before.startedAt).toBe(2 * 86_400_000);
    // Sticky category: a task move never re-derives it.
    expect(after.snapshotCategoryId).toBe(f.dev);

    const recat = await save(t, "alice", [{ ref: id, category: "Design" }]);
    expect(recat.items[0].action).toBe("updated");
    expect(await entry(t, id)).toMatchObject({ snapshotCategoryId: f.design, billableRate: 120 });
    await expect(save(t, "alice", [{ ref: id, member: email("bob") }])).rejects.toThrow("member applies to new entries");
  });

  it("members edit and delete only their own entries; admins any", async () => {
    const t = createT();
    const f = await setup(t);
    const bobs = (await save(t, "bob", [{ task: f.id.AB, minutes: 30 }])).items[0].entryId;
    // Alice cannot even resolve Bob's entry (members see their own time only).
    await expect(save(t, "alice", [{ ref: bobs, minutes: 10 }])).rejects.toThrow(`${bobs} not found`);
    await expect(remove(t, "alice", [bobs])).rejects.toThrow(`${bobs} not found`);
    await expect(save(t, "other", [{ ref: bobs, minutes: 10 }])).rejects.toThrow(`${bobs} not found`);
    expect((await save(t, "admin", [{ ref: bobs, minutes: 40 }])).items[0]).toMatchObject({ action: "updated", member: "Bob" });
    expect((await entry(t, bobs)).userId).toBe(f.bob);
    expect(await remove(t, "admin", [bobs])).toMatchObject({
      items: [{ input: bobs, type: "time_entry", action: "deleted", label: expect.stringMatching(/^time entry \d{4}-\d{2}-\d{2} · 40m · Bob on ARLO-\d+$/) }],
    });
    const own = (await save(t, "alice", [{ task: f.id.A, minutes: 20 }])).items[0].entryId;
    expect((await remove(t, "alice", [own])).items[0].action).toBe("deleted");
    expect(await entries(t)).toHaveLength(0);
  });

  it("refuses edits and deletes of close-locked entries with the app's messages", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await save(t, "alice", [
      { task: f.id.A, minutes: 30, date: "2026-09-10" },
      { task: f.id.A, minutes: 30, date: "2026-09-11" },
      { task: f.id.A, minutes: 30, date: "2026-09-12" },
    ]);
    const [closed, draft, invoiced] = items.map((i) => i.entryId);
    await lock(t, closed, "final");
    await lock(t, draft, "draft");
    await lock(t, invoiced, "invoiced");
    await expect(save(t, "alice", [{ ref: invoiced, minutes: 10 }])).rejects.toThrow(
      "Cannot edit a time entry linked to an invoice — void the invoice first",
    );
    await expect(remove(t, "admin", [invoiced])).rejects.toThrow("Cannot delete a time entry linked to an invoice — void the invoice first");
    await expect(save(t, "alice", [{ ref: closed, minutes: 10 }])).rejects.toThrow(
      "Cannot edit a time entry in a closed period — reopen the period first",
    );
    await expect(save(t, "admin", [{ ref: draft, note: "x" }])).rejects.toThrow(
      "Cannot edit a time entry that's on a draft invoice — delete the draft first",
    );
    await expect(remove(t, "admin", [closed])).rejects.toThrow("Cannot delete a time entry in a closed period — reopen the period first");
    await expect(remove(t, "alice", [draft])).rejects.toThrow("Cannot delete a time entry that's on a draft invoice — delete the draft first");
    expect(await entries(t)).toHaveLength(3);
  });
});

describe("save_time_entries: batches and idempotency", () => {
  it("one bad item writes nothing (I5)", async () => {
    const t = createT();
    const f = await setup(t);
    const kept = (await save(t, "alice", [{ task: f.id.A, minutes: 30 }])).items[0].entryId;
    const activityBefore = (await activity(t)).length;
    await expect(
      save(t, "alice", [
        { task: f.id.A, minutes: 30 },
        { ref: kept, minutes: 99 },
        { task: f.id.B, minutes: 10 },
      ]),
    ).rejects.toThrow(`Item 3 (${f.id.B}): ${f.id.B} not found. Use search to find tasks. Nothing was saved.`);
    expect(await entries(t)).toHaveLength(1);
    expect((await entry(t, kept)).durationMinutes).toBe(30);
    expect(await activity(t)).toHaveLength(activityBefore);
  });

  it("a replay returns the first result and writes nothing; another request with the key is refused", async () => {
    const t = createT();
    const f = await setup(t);
    const items = [{ task: f.id.A, minutes: 30, note: "once" }];
    const first = await save(t, "alice", items, { idempotencyKey: "k1" });
    const again = await save(t, "alice", items, { idempotencyKey: "k1" });
    expect(again).toEqual({ ...first, replayed: true });
    expect(await entries(t)).toHaveLength(1);
    await expect(save(t, "alice", [{ task: f.id.A, minutes: 31 }], { idempotencyKey: "k1" })).rejects.toThrow(
      "This idempotencyKey was already used for a different request",
    );
    // Keys are per user: Bob's k1 is his own.
    await save(t, "bob", [{ task: f.id.B, minutes: 5 }], { idempotencyKey: "k1" });
    expect(await entries(t)).toHaveLength(2);
  });
});

// ─── Attribution and the changes feed ────────────────────────────────────────

describe("time activity: via and exclude_self (D15, D22)", () => {
  it("logged / edited / deleted rows carry via; exclude_self drops only the caller's own client", async () => {
    const t = createT();
    const f = await setup(t);
    const id = (await save(t, "alice", [{ task: f.id.A, minutes: 30 }])).items[0].entryId;
    await save(t, "alice", [{ ref: id, minutes: 50 }]);
    await remove(t, "alice", [id]);
    const rows = (await activity(t)).filter((r) => r.type.startsWith("time_entry_"));
    expect(rows.map((r) => [r.type, r.via?.clientName, r.via?.clientId])).toEqual([
      ["time_entry_logged", "Claude", "client_claude"],
      ["time_entry_edited", "Claude", "client_claude"],
      ["time_entry_deleted", "Claude", "client_claude"],
    ]);
    // The app's own writes carry no via.
    await inApp(t, "alice").mutation(api.timeEntries.create, { taskId: f.A, durationMinutes: 5, startedAt: Date.now() - 300_000 });
    expect((await activity(t)).filter((r) => r.type === "time_entry_logged").map((r) => r.via ?? null)[1]).toBeNull();

    const feed = (excludeSelf: boolean, clientId?: string) =>
      as(t, "alice", clientId).query(api.mcp.fetch.changes, {
        excludeSelf, includeText: true, limit: 50, now: later(), types: ["time_entry_logged", "time_entry_edited", "time_entry_deleted"],
      });
    expect((await feed(false)).changes.map((c) => [c.type, c.via])).toEqual([
      ["time_entry_logged", "Claude"],
      ["time_entry_edited", "Claude"],
      ["time_entry_deleted", "Claude"],
      ["time_entry_logged", null],
    ]);
    expect((await feed(true)).changes.map((c) => [c.type, c.via])).toEqual([["time_entry_logged", null]]);
    expect((await feed(true, "client_codex")).changes).toHaveLength(4);
    // Bob cannot read Alice's task: none of it reaches his feed.
    expect(
      (
        await as(t, "bob").query(api.mcp.fetch.changes, {
          excludeSelf: false, includeText: true, limit: 50, now: later(), types: ["time_entry_logged", "time_entry_edited", "time_entry_deleted"],
        })
      ).changes,
    ).toEqual([]);
  });
});

// ─── timer ───────────────────────────────────────────────────────────────────

describe("timer", () => {
  it("start / status / stop through MCP create the same entry as the app; the app sees the timer", async () => {
    const t = createT();
    const f = await setup(t);
    const started = await as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A, clientName: "Claude" });
    expect(started).toMatchObject({ tool: "timer", action: "started", task: { identifier: f.id.A, title: "Alice task" }, replayed: false });
    // The app's timer bar reads the same state.
    expect(await inApp(t, "alice").query(api.timer.getState, {})).toMatchObject({ taskId: f.A, status: "running" });
    await expect(as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.AB })).rejects.toThrow(
      "A timer is already running. Stop it before starting a new one.",
    );

    // 65m 20s in, for Alice (MCP) and Bob (app) alike: both save 66 minutes.
    const sessionStart = Date.now() - 65 * 60_000 - 20_000;
    await inApp(t, "bob").mutation(api.timer.start, { taskId: f.AB });
    await t.run(async (ctx) => {
      await ctx.db.patch(f.alice, { timerStartedAt: sessionStart });
      await ctx.db.patch(f.bob, { timerStartedAt: sessionStart });
    });
    // Bob's app timer on the shared task, Alice's MCP timer moved there too.
    await t.run(async (ctx) => ctx.db.patch(f.alice, { timerTaskId: f.AB }));

    const status = await as(t, "alice").query(api.mcp.timer.status, { now: sessionStart + 65 * 60_000 + 30_000 });
    expect(status).toEqual({
      timezone: "UTC",
      timer: {
        state: "running", task: { identifier: f.id.AB, title: "Shared task" }, currentRunSince: sessionStart, resumed: false, minutes: 66, stale: false,
      },
    });
    // fetch("me") shows the same timer, read-only.
    expect((await as(t, "alice").query(api.mcp.fetch.me, { now: sessionStart + 65 * 60_000 + 30_000 })).timer).toEqual(status.timer);

    const stopped = await as(t, "alice").mutation(api.mcp.timer.stop, { note: "Hero", clientName: "Claude" });
    const app = await inApp(t, "bob").mutation(api.timer.stop, { note: "Hero" });
    expect(stopped).toMatchObject({ action: "stopped", task: { identifier: f.id.AB }, stale: false, minutes: 66, date: app.date });
    expect(app.roundedMinutes).toBe(66);
    const mcpEntry = await entry(t, stopped.entryId!);
    const appEntry = await entry(t, app.entryId!);
    expect({ ...ledger(mcpEntry), snapshotCategoryId: undefined, billableRate: undefined }).toEqual({
      ...ledger(appEntry), snapshotCategoryId: undefined, billableRate: undefined,
    });
    expect(mcpEntry).toMatchObject({ method: "timer", startedAt: sessionStart, userId: f.alice, createdBy: f.alice, note: "Hero" });
    // Each owner's own chain: Alice's default (Development), Bob's falls back to the task (Design).
    expect([mcpEntry.snapshotCategoryId, appEntry.snapshotCategoryId]).toEqual([f.dev, f.design]);
    expect(await inApp(t, "alice").query(api.timer.getState, {})).toBeNull();
    expect(await as(t, "alice").query(api.mcp.timer.status, { now: Date.now() })).toEqual({ timezone: "UTC", timer: { state: "idle" } });
    // D-STOPLOG: both stops logged the entry; via only on the MCP one.
    const logged = (await activity(t)).filter((r) => r.type === "time_entry_logged");
    expect(logged.map((r) => [r.userId, r.metadata, r.via?.clientName ?? null])).toEqual([
      [f.alice, { entryId: stopped.entryId, duration: "01:06", note: "Hero" }, "Claude"],
      [f.bob, { entryId: app.entryId, duration: "01:06", note: "Hero" }, null],
    ]);
    await expect(as(t, "alice").mutation(api.mcp.timer.stop, {})).rejects.toThrow("No active timer");
  });

  it("stops under 30 seconds without saving; members time only tasks they can open; foreign tasks are not found", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.B })).rejects.toThrow(`${f.id.B} not found`);
    await expect(as(t, "admin").mutation(api.mcp.timer.start, { task: f.foreignTask })).rejects.toThrow(`${f.foreignTask} not found`);
    await expect(as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.noProject })).rejects.toThrow(
      "Assign a project to this task before starting a timer",
    );
    await as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A });
    const stopped = await as(t, "alice").mutation(api.mcp.timer.stop, {});
    expect(stopped).toMatchObject({ action: "discarded", discardReason: "too_short", task: { identifier: f.id.A } });
    expect(stopped.entryId).toBeUndefined();
    expect(await entries(t)).toHaveLength(0);
  });

  it("start and stop replay their idempotency key", async () => {
    const t = createT();
    const f = await setup(t);
    const first = await as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A, idempotencyKey: "s1" });
    const again = await as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A, idempotencyKey: "s1" });
    expect(again).toEqual({ ...first, replayed: true });
    await expect(as(t, "alice").mutation(api.mcp.timer.stop, { idempotencyKey: "s1" })).rejects.toThrow(
      "This idempotencyKey was already used for a different request",
    );
    await t.run(async (ctx) => ctx.db.patch(f.alice, { timerStartedAt: Date.now() - 10 * 60_000 }));
    const stop = await as(t, "alice").mutation(api.mcp.timer.stop, { idempotencyKey: "s2" });
    expect(await as(t, "alice").mutation(api.mcp.timer.stop, { idempotencyKey: "s2" })).toEqual({ ...stop, replayed: true });
    expect(await entries(t)).toHaveLength(1);
  });
});

describe("timer across workspaces (timer state is per user)", () => {
  it("a timer on another org's task is refused untouched from this org, and nothing of it leaks", async () => {
    const t = createT();
    const f = await setup(t);
    // Alice is also a member of OTHER and runs a timer there.
    const startedAt = Date.now() - 20 * 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert("orgMembers", { orgId: OTHER, clerkUserId: "clerk_alice", userId: f.alice, role: "member", joinedAt: Date.now() });
      await ctx.db.patch(f.alice, { timerTaskId: f.foreignTask, timerStartedAt: startedAt, timerAccumulatedMs: 0, timerStatus: "running" });
      await connectMembers(ctx, ["client_claude"]);
    });
    const elsewhere = "Your timer is running in another workspace; stop it there.";
    const status = await as(t, "alice").query(api.mcp.timer.status, { now: Date.now() });
    expect(status).toEqual({ timezone: "UTC", timer: { state: "elsewhere" } });
    const me = await as(t, "alice").query(api.mcp.fetch.me, { now: Date.now() });
    expect(me.timer).toEqual({ state: "elsewhere" });
    await expect(as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A, idempotencyKey: "x1" })).rejects.toThrow(elsewhere);
    await expect(as(t, "alice").mutation(api.mcp.timer.stop, { idempotencyKey: "x2" })).rejects.toThrow(elsewhere);
    // The app's own stop from this org refuses the same way.
    await expect(inApp(t, "alice").mutation(api.timer.stop, {})).rejects.toThrow(elsewhere);
    const user = await t.run(async (ctx) => (await ctx.db.get(f.alice))!);
    expect(user).toMatchObject({ timerTaskId: f.foreignTask, timerStartedAt: startedAt, timerStatus: "running" });
    expect(JSON.stringify([status, me])).not.toMatch(/Foreign secret task|KON|ELSE/);
    expect(await t.run(async (ctx) => await ctx.db.query("mcpIdempotency").collect())).toEqual([]);
    expect(await entries(t)).toHaveLength(0);

    // Its own workspace sees it as usual.
    const there = await t
      .withIdentity({ subject: "clerk_alice", issuer: "https://clerk.test", client_id: "client_claude", org_id: OTHER })
      .query(api.mcp.timer.status, { now: Date.now() });
    expect(there.timer).toMatchObject({ state: "running", task: { title: "Foreign secret task" } });
  });

  it("a timer whose task was deleted is cleared on stop and says why", async () => {
    const t = createT();
    const f = await setup(t);
    await as(t, "alice").mutation(api.mcp.timer.start, { task: f.id.A });
    await t.run(async (ctx) => ctx.db.delete(f.A));
    expect((await as(t, "alice").query(api.mcp.timer.status, { now: Date.now() })).timer).toEqual({ state: "orphaned" });
    const stopped = await as(t, "alice").mutation(api.mcp.timer.stop, {});
    expect(stopped).toEqual({ tool: "timer", action: "discarded", discardReason: "task_missing", replayed: false });
    expect((await t.run(async (ctx) => (await ctx.db.get(f.alice))!)).timerTaskId).toBeUndefined();
  });

  it("an archive auto-save logs the entry by the archiving admin, with via through MCP", async () => {
    const t = createT();
    const f = await setup(t);
    await inApp(t, "bob").mutation(api.timer.start, { taskId: f.B });
    await t.run(async (ctx) => ctx.db.patch(f.bob, { timerStartedAt: Date.now() - 10 * 60_000 }));
    await as(t, "admin").mutation(api.mcp.write.saveTasks, { items: [{ ref: f.id.B, archived: true }], clientName: "Claude" });
    const [saved] = await entries(t);
    expect(saved).toMatchObject({ userId: f.bob, createdBy: f.admin, method: "timer", note: "Auto-saved when the task was archived" });
    const logged = (await activity(t)).filter((r) => r.type === "time_entry_logged");
    expect(logged.map((r) => [r.taskId, r.userId, r.via?.clientName])).toEqual([[f.B, f.admin, "Claude"]]);
  });
});

describe("save_time_entries: billable, categories, timezone, foreign refs", () => {
  it("billable defaults to the task's and can be set or changed like the app's form", async () => {
    const t = createT();
    const f = await setup(t);
    const { items } = await save(t, "alice", [
      { task: f.id.A, minutes: 30 },
      { task: f.id.A, minutes: 30, billable: false },
    ]);
    const [inherit, off] = await Promise.all(items.map((i) => entry(t, i.entryId)));
    expect(inherit).toMatchObject({ isBillable: true, billableRate: 100 });
    expect(off).toMatchObject({ isBillable: false, billableRate: 0 });
    expect(items.map((i) => [i.billable, i.category])).toEqual([[true, "Development"], [false, "Development"]]);
    const flipped = await save(t, "alice", [{ ref: items[1].entryId, billable: true }]);
    expect(flipped.items[0]).toMatchObject({ action: "updated", billable: true });
    expect(await entry(t, items[1].entryId)).toMatchObject({ isBillable: true, billableRate: 100 });
  });

  it("an unchanged archived category is no change; a new archived one is refused", async () => {
    const t = createT();
    const f = await setup(t);
    const id = (await save(t, "alice", [{ task: f.id.A, minutes: 30, category: "Design" }])).items[0].entryId;
    await t.run(async (ctx) => ctx.db.patch(f.design, { archivedAt: Date.now() }));
    expect((await save(t, "alice", [{ ref: id, category: " design ", minutes: 30 }])).items[0]).toMatchObject({
      action: "unchanged", category: "Design",
    });
    const other = (await save(t, "alice", [{ task: f.id.A, minutes: 10 }])).items[0].entryId;
    await expect(save(t, "alice", [{ ref: other, category: "Design" }])).rejects.toThrow('The work category "Design" is archived');
  });

  it("shows the category on fetched and searched time entries", async () => {
    const t = createT();
    const f = await setup(t);
    const id = (await save(t, "alice", [{ task: f.id.A, minutes: 30 }])).items[0].entryId;
    const [record] = (await as(t, "alice").query(api.mcp.fetch.records, { refs: [id], include: [], now: Date.now() })).results;
    expect(record.ok && record.record.type === "time_entry" && record.record.category).toBe("Development");
    const found = await as(t, "alice").query(api.mcp.search.timeEntries, {
      offset: 0, limit: 5, now: Date.now(), tracked: {}, updated: {}, task: f.id.A,
    });
    expect(found.rows.map((r) => r.category)).toEqual(["Development"]);
  });

  it("defaults to today in a non-UTC org timezone and clamps a long entry to that midnight", async () => {
    const t = createT();
    const f = await setup(t);
    const tz = "Pacific/Auckland";
    await t.run(async (ctx) => {
      const settings = (await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique())!;
      await ctx.db.patch(settings._id, { timezone: tz });
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const { items } = await save(t, "alice", [{ task: f.id.A, minutes: 24 * 60 }]);
    expect(items[0].date).toBe(today);
    const [y, m, d] = today.split("-").map(Number);
    expect((await entry(t, items[0].entryId)).startedAt).toBe(tzWallToEpoch(y, m, d, 0, 0, 0, tz));
    expect((await as(t, "alice").query(api.mcp.fetch.me, { now: Date.now() })).today).toBe(today);
  });

  it("a foreign time-entry ID is not found for delete and edit, and stays", async () => {
    const t = createT();
    const f = await setup(t);
    const foreign = await t.run(async (ctx) => {
      const project = (await ctx.db.query("projects").withIndex("by_orgId_code", (q) => q.eq("orgId", OTHER).eq("code", "ELSE")).first())
        ?? null;
      const projectId = project?._id ?? (await ctx.db.insert("projects", {
        orgId: OTHER, clientId: await ctx.db.insert("clients", { orgId: OTHER, name: "Else", currency: "EUR", createdAt: 0, updatedAt: 0, createdBy: f.other }),
        name: "Else", code: "ELSE", billingType: "t_and_m", createdAt: 0, updatedAt: 0, createdBy: f.other,
      }));
      return await ctx.db.insert("timeEntries", {
        orgId: OTHER, projectId, taskId: f.foreignTask, userId: f.other, date: "2026-10-20", startedAt: Date.UTC(2026, 9, 20, 9),
        durationMinutes: 30, isBillable: true, method: "manual", costRate: 1, billableRate: 1, rateCurrency: "EUR",
        createdAt: 0, updatedAt: 0, createdBy: f.other,
      });
    });
    await expect(remove(t, "admin", [foreign])).rejects.toThrow(`${foreign} not found`);
    await expect(save(t, "admin", [{ ref: foreign, minutes: 5 }])).rejects.toThrow(`${foreign} not found`);
    expect((await entry(t, foreign)).durationMinutes).toBe(30);
  });
});

// ─── Comment search ordering (carried fix) ───────────────────────────────────

describe("comment search order", () => {
  it("is newest first, ties broken by insertion order, stable across pages (global and task-filtered)", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      // One transaction: every comment and activity row shares one createdAt.
      const at = Date.now() - 60_000;
      for (let i = 1; i <= 12; i += 1) {
        const commentId = await ctx.db.insert("comments", {
          orgId: ORG, taskId: f.A, userId: f.alice, createdAt: at, updatedAt: at,
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `heavy comment ${i}` }] }] },
        });
        await ctx.db.insert("activityLog", { orgId: ORG, taskId: f.A, userId: f.alice, type: "comment_added", metadata: { commentId }, createdAt: at });
      }
    });
    const expected = Array.from({ length: 12 }, (_, i) => `heavy comment ${12 - i}`);
    for (const filter of [{}, { task: f.id.A }]) {
      const pages: string[] = [];
      for (let offset = 0; offset < 12; offset += 5) {
        const page = await as(t, "alice").query(api.mcp.search.comments, {
          offset, limit: 5, updated: {}, now: Date.now(), ...filter,
        });
        pages.push(...page.rows.map((r) => r.text));
      }
      expect(pages).toEqual(expected);
    }
  });
});

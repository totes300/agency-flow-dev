// @vitest-environment edge-runtime
//
// MCP slice 2 (docs/prd-mcp.md §6, §7, §13): `fetch` records and `search`
// through convex/mcp/*, with OAuth identities.
//   I3   every reference form resolves in the caller's org only; foreign,
//        missing and unreadable records are all "not found"
//   T1   a member never fetches or finds a task the app would not show
//        them; time entries follow the app (members: own only)
//   §7   aliases, case-insensitive keys, a bare key = project code and
//        `client:KEY` for clients, duplicates already in the data →
//        candidates, paging totals and cap-hit `incomplete`

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { addIdentifierAlias, createTask, type CreateTaskInput } from "../tasks/write";
import { OPEN_ROW_CAP } from "../tasks/read";
import { REF_CAP } from "../workspaceRefs";
import { connectMembers } from "./helpers/mcpConnections";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp2";
const OTHER = "org_mcp2_other";
/** 2026-10-24 12:00 UTC: "today" in the fixture's UTC org. */
const NOW = Date.UTC(2026, 9, 24, 12);

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "carol" | "bob" | "other";

const SUBJECT: Record<Caller, [string, string]> = {
  admin: ["clerk_admin", ORG],
  alice: ["clerk_alice", ORG],
  carol: ["clerk_carol", ORG],
  bob: ["clerk_bob", ORG],
  other: ["clerk_other", OTHER],
};

/** A Clerk OAuth access token as Convex sees it: client_id + org_id, no role. */
const as = (t: T, caller: Caller) =>
  t.withIdentity({ subject: SUBJECT[caller][0], issuer: "https://clerk.test", client_id: "client_claude", org_id: SUBJECT[caller][1] });

/** The fixture, with every member connected through the OAuth clients this file uses. */
async function setup(t: T) {
  const fixture = await setupData(t);
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return fixture;
}

async function setupData(t: T) {
  return await t.run(async (ctx) => {
    const now = NOW - 3600_000;
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
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy,
      });
    }
    const status: Record<string, Id<"statuses">> = {};
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, other]] as const) {
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        const id = await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
        if (orgId === ORG) status[s.name] = id;
      }
    }
    const mkClient = async (orgId: string, name: string, prefix: string | undefined, createdBy: Id<"users">) =>
      await ctx.db.insert("clients", { orgId, name, currency: "EUR", prefix, createdAt: now, updatedAt: now, createdBy });
    const mkProject = async (orgId: string, name: string, code: string, clientId: Id<"clients">, createdBy: Id<"users">) =>
      await ctx.db.insert("projects", {
        orgId, clientId, name, code, billingType: "retainer", monthlyFee: 5000, createdAt: now, updatedAt: now, createdBy,
      });
    // Client prefix ARLO collides with project code ARLO (the default suggestion).
    const arloClient = await mkClient(ORG, "Arlow", "ARLO", admin);
    const konv = await mkClient(ORG, "Konverted", "KONV", admin);
    const dupA = await mkClient(ORG, "Dup A", "DUP", admin);
    const dupB = await mkClient(ORG, "Dup B", "dup", admin);
    const arlo = await mkProject(ORG, "Arlow site", "ARLO", arloClient, admin);
    const site = await mkProject(ORG, "Konverted site", "KSITE", konv, admin);
    // KSITE has a team (the project's Team setting); ARLO none.
    await ctx.db.patch(site, { teamMembers: [alice, bob] });
    const otherClient = await mkClient(OTHER, "Elsewhere", "ELSE", other);
    const otherProject = await mkProject(OTHER, "Elsewhere", "ELSE", otherClient, other);
    const launch = await ctx.db.insert("labels", { orgId: ORG, name: "Launch", color: "red", position: "a0" });

    const authOf = async (userId: Id<"users">, orgId: string): Promise<AuthContext> => ({
      userId, orgId, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(userId))!,
    });
    const adminAuth = await authOf(admin, ORG);
    const otherAuth = await authOf(other, OTHER);
    const mk = (auth: AuthContext, input: CreateTaskInput) => createTask(ctx, auth, input, { notify: false, now });

    const description = JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Brief" }] },
        { type: "paragraph", content: [{ type: "text", text: "Rebuild the " }, { type: "text", text: "hero", marks: [{ type: "bold" }] }] },
      ],
    });
    /** Parent, ARLO, Carol; described + labelled. */
    const P = await mk(adminAuth, { title: "Parent hero", projectId: arlo, assigneeIds: [carol], description, labelIds: [launch] });
    /** Sub-task of P, Alice. */
    const S = await mk(adminAuth, { title: "Sub copy", parentTaskId: P, assigneeIds: [alice] });
    /** Alice, overdue (due yesterday), started. */
    const A = await mk(adminAuth, {
      title: "Alpha overdue", projectId: arlo, assigneeIds: [alice], statusId: status["In progress"], dueDate: "2026-10-23",
    });
    /** Alice, due today: not overdue. */
    const B = await mk(adminAuth, { title: "Beta due today", projectId: site, assigneeIds: [alice], dueDate: "2026-10-24" });
    /** Admin only, overdue: invisible to Alice. */
    const U = await mk(adminAuth, { title: "Alpha admin only", projectId: site, assigneeIds: [admin], dueDate: "2026-10-01" });
    /** Done, Alice, overdue date but closed. */
    const D = await mk(adminAuth, {
      title: "Done thing", projectId: arlo, assigneeIds: [alice], statusId: status.Done, dueDate: "2026-10-02",
    });
    const X = await mk(otherAuth, { title: "Other org Alpha", projectId: otherProject });

    const identifier = async (id: Id<"tasks">) => (await ctx.db.get(id))!.identifier;
    await addIdentifierAlias(ctx, ORG, "OLD-7", A);

    // Comments, each with its comment_added activity row (as comments.create writes).
    const comment = async (taskId: Id<"tasks">, userId: Id<"users">, text: string, at: number) => {
      const id = await ctx.db.insert("comments", {
        taskId, orgId: ORG, userId, content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
        createdAt: at, updatedAt: at,
      });
      await ctx.db.insert("activityLog", { taskId, orgId: ORG, userId, type: "comment_added", metadata: { commentId: id }, createdAt: at });
      return id;
    };
    const cP = await comment(P, carol, "Hero copy is ready", NOW - 5000);
    const cU = await comment(U, admin, "Secret admin hero note", NOW - 4000);
    const cA = await comment(A, alice, "Blocked on hero assets", NOW - 3000);

    // Time entries: Alice and Admin on A.
    const entry = async (taskId: Id<"tasks">, projectId: Id<"projects">, userId: Id<"users">, date: string, minutes: number, note: string) =>
      await ctx.db.insert("timeEntries", {
        orgId: ORG, projectId, taskId, userId, date, startedAt: Date.parse(`${date}T09:00:00Z`), durationMinutes: minutes,
        note, isBillable: true, method: "manual", costRate: 10, billableRate: 99, rateCurrency: "EUR",
        createdAt: now, updatedAt: now, createdBy: userId,
      });
    const eAlice = await entry(A, arlo, alice, "2026-10-20", 90, "Hero layout");
    const eAdmin = await entry(A, arlo, admin, "2026-10-21", 30, "Review");
    await entry(B, site, alice, "2026-09-30", 15, "Kickoff");

    return {
      admin, alice, bob, carol, status, arlo, site, otherProject, arloClient, konv, dupA, dupB, otherClient, launch,
      P, S, A, B, U, D, X, cP, cU, cA, eAlice, eAdmin,
      id: {
        P: await identifier(P), S: await identifier(S), A: await identifier(A), B: await identifier(B),
        U: await identifier(U), D: await identifier(D), X: await identifier(X),
      },
    };
  });
}

const records = (t: T, caller: Caller, refs: string[], include: Array<"subtasks" | "comments" | "activity" | "time" | "files" | "attachment_text"> = []) =>
  as(t, caller).query(api.mcp.fetch.records, { refs, include, now: NOW });

const NO_RANGE = {};
const taskSearch = (t: T, caller: Caller, args: Record<string, unknown> = {}) =>
  as(t, caller).query(api.mcp.search.tasks, { offset: 0, limit: 25, due: NO_RANGE, updated: NO_RANGE, now: NOW, ...args });

// ─── fetch: references ───────────────────────────────────────────────────────

describe("fetch records: task references (I3, T1)", () => {
  it("resolves identifiers case-insensitively, aliases, IDs and app links", async () => {
    const t = createT();
    const f = await setup(t);
    const { results } = await records(t, "admin", [
      f.id.A.toLowerCase(),
      "old-7",
      f.A,
      `https://localhost:3001/tasks/${f.id.A}`,
      `https://localhost:3001/my-tasks?task=${f.id.A}`,
    ]);
    for (const r of results) {
      expect(r.ok).toBe(true);
      expect(r.ok && r.record.type === "task" && r.record.id).toBe(f.A);
    }
  });

  it("other-org, missing and unreadable tasks are the same 'not found'", async () => {
    const t = createT();
    const f = await setup(t);
    const message = async (caller: Caller, ref: string) => {
      const [r] = (await records(t, caller, [ref])).results;
      return r.ok ? "found" : r.message;
    };
    expect(await message("admin", f.id.X)).toBe(`${f.id.X} not found. Use search to find tasks.`);
    expect(await message("admin", f.X)).toBe(`${f.X} not found. Use search to find tasks.`);
    expect(await message("admin", "ARLO-999")).toBe("ARLO-999 not found. Use search to find tasks.");
    // Alice cannot read U (admin's task): exactly like a missing task.
    expect(await message("alice", f.id.U)).toBe(`${f.id.U} not found. Use search to find tasks.`);
    expect(await message("bob", f.id.A)).toBe(`${f.id.A} not found. Use search to find tasks.`);
    // Carol reads the parent's sub-task through the parent edge (§11.5).
    expect(await message("carol", f.id.S)).toBe("found");
  });

  it("returns the task detail with markdown description and includes", async () => {
    const t = createT();
    const f = await setup(t);
    const [r] = (await records(t, "admin", [f.id.P], ["subtasks", "comments", "files", "attachment_text"])).results;
    expect(r.ok).toBe(true);
    if (!r.ok || r.record.type !== "task") throw new Error("expected a task");
    expect(r.record).toMatchObject({
      identifier: f.id.P,
      title: "Parent hero",
      status: "Inbox",
      project: { code: "ARLO", name: "Arlow site" },
      client: { name: "Arlow", prefix: "ARLO" },
      assignees: ["Carol"],
      labels: ["Launch"],
      description: "## Brief\n\nRebuild the **hero**",
      subtaskCount: 1,
    });
    expect(r.record.subtasks?.rows.map((s) => s.identifier)).toEqual([f.id.S]);
    expect(r.record.comments?.rows).toEqual([
      expect.objectContaining({ id: f.cP, author: "Carol", text: "Hero copy is ready", resolved: false }),
    ]);
    // attachment_text implies the file list (with text per file; none here).
    expect(r.record.files).toEqual({ rows: [], truncated: false, withText: true, selected: false });
    // Not requested → not loaded.
    expect(r.record.activity).toBeNull();
    expect(r.record.time).toBeNull();
  });

  it("time: admins see every entry, members only their own (no rates)", async () => {
    const t = createT();
    const f = await setup(t);
    const time = async (caller: Caller) => {
      const [r] = (await records(t, caller, [f.id.A], ["time"])).results;
      if (!r.ok || r.record.type !== "task") throw new Error("expected a task");
      return r.record.time!;
    };
    const admin = await time("admin");
    expect(admin).toMatchObject({ total: 2, totalMinutes: 120, ownOnly: false });
    expect(admin.rows.map((e) => e.member)).toEqual(["Admin", "Alice"]);
    expect(JSON.stringify(admin)).not.toMatch(/Rate|99/);
    const alice = await time("alice");
    expect(alice).toMatchObject({ total: 1, totalMinutes: 90, ownOnly: true });
    expect(alice.rows).toEqual([expect.objectContaining({ id: f.eAlice, member: "Alice", minutes: 90, note: "Hero layout" })]);
  });
});

describe("fetch records: other kinds (I3)", () => {
  it("projects by code, clients by prefix (case-insensitive), members by email and ID", async () => {
    const t = createT();
    const f = await setup(t);
    const { results } = await records(t, "alice", ["ksite", "Konv", "CAROL_unused@x.test", "clerk_bob@X.TEST", f.carol]);
    expect(results[0]).toMatchObject({
      ok: true,
      record: {
        type: "project",
        code: "KSITE",
        client: { name: "Konverted", prefix: "KONV" },
        team: [{ name: "Alice", email: "clerk_alice@x.test" }, { name: "Bob", email: "clerk_bob@x.test" }],
        includeIgnored: false,
      },
    });
    // No team → []; include passed for a non-task record is flagged (the route says so), tasks never carry the flag.
    const flagged = await records(t, "admin", ["ARLO", f.id.A], ["comments"]);
    expect(flagged.results[0]).toMatchObject({ ok: true, record: { type: "project", code: "ARLO", team: [], includeIgnored: true } });
    expect(flagged.results[1].ok && flagged.results[1].record.type === "task" && "includeIgnored" in flagged.results[1].record).toBe(false);
    expect(results[1]).toMatchObject({ ok: true, record: { type: "client", name: "Konverted", prefix: "KONV", projects: [{ code: "KSITE" }] } });
    expect(results[2]).toMatchObject({ ok: false, message: 'CAROL_unused@x.test is not a member of this workspace. Members are listed in fetch("workspace").' });
    expect(results[3]).toMatchObject({ ok: true, record: { type: "member", name: "Bob", role: "member" } });
    expect(results[4]).toMatchObject({ ok: true, record: { type: "member", name: "Carol" } });
    // No money on project records.
    expect(JSON.stringify(results[0])).not.toMatch(/5000|monthlyFee|billing/i);
  });

  it("a bare key is the project code; clients are client:KEY; duplicates return candidates", async () => {
    const t = createT();
    const f = await setup(t);
    const [arlo, arloClient, bareDup, dup, konvBare] = (
      await records(t, "admin", ["arlo", "client:arlo", "DUP", "Client:dup", "KONV"])
    ).results;
    // Project ARLO and client prefix ARLO: the bare key means the project.
    expect(arlo).toMatchObject({ ok: true, record: { type: "project", id: f.arlo } });
    expect(arloClient).toMatchObject({ ok: true, record: { type: "client", id: f.arloClient, prefix: "ARLO" } });
    // No project KONV: the bare key falls back to the unique client prefix.
    expect(konvBare).toMatchObject({ ok: true, record: { type: "client", id: f.konv } });
    // Duplicate prefixes already in the data (case-insensitive) → candidates, no crash.
    for (const r of [bareDup, dup]) {
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.candidates.map((c) => c.id).sort()).toEqual([f.dupA, f.dupB].sort());
    }
    if (!dup.ok) {
      expect(dup.message).toMatch(/^"Client:dup" is ambiguous: it matches client client:(DUP|dup) · Dup [AB] \(ref /);
    }
  });

  it("a client whose legacy prefix has another format is referenced by ID only", async () => {
    const t = createT();
    const f = await setup(t);
    const legacy = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("clients", {
        orgId: ORG, name: "Legacy & Co", currency: "EUR", prefix: "LEGACYCO99", createdAt: now, updatedAt: now, createdBy: f.admin,
      });
    });
    await t.run(async (ctx) => ctx.db.patch(legacy, { prefix: "L&C" }));
    const [byKey, byId] = (await records(t, "admin", ["client:LEGACYCO99", legacy])).results;
    expect(byKey.ok).toBe(false);
    expect(byId).toMatchObject({ ok: true, record: { type: "client", prefix: null } });
    // The workspace sheet lists it by ID, not by its unusable prefix.
    const workspace = await as(t, "admin").query(api.mcp.fetch.workspace, {});
    expect(workspace.clients.find((c) => c.id === legacy)?.prefix).toBeNull();
    expect(workspace.clients.find((c) => c.id === f.konv)?.prefix).toBe("KONV");
  });

  it("IDs and links of another org's records are not found", async () => {
    const t = createT();
    const f = await setup(t);
    const { results } = await records(t, "admin", [
      f.otherProject,
      `https://localhost:3001/clients/${f.otherClient}`,
      "ELSE",
      f.cU,
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false, true]);
    expect(results[0]).toMatchObject({ message: `${f.otherProject} not found. Project codes are listed in fetch("workspace").` });
    expect(results[1]).toMatchObject({ message: expect.stringMatching(/not found/) });
  });

  it("comments and time entries follow their task's and the app's visibility", async () => {
    const t = createT();
    const f = await setup(t);
    const alice = (await records(t, "alice", [f.cA, f.cU, `https://localhost:3001/tasks/${f.id.A}?comment=${f.cA}`, f.eAlice, f.eAdmin])).results;
    expect(alice[0]).toMatchObject({ ok: true, record: { type: "comment", text: "Blocked on hero assets", task: { identifier: f.id.A } } });
    expect(alice[1]).toMatchObject({ ok: false, message: `${f.cU} not found. Use search to find comments.` });
    expect(alice[2]).toMatchObject({ ok: true, record: { type: "comment", id: f.cA } });
    expect(alice[3]).toMatchObject({ ok: true, record: { type: "time_entry", minutes: 90, project: { code: "ARLO" } } });
    // Alice can read task A, but the app shows members only their own entries.
    expect(alice[4]).toMatchObject({ ok: false, message: `${f.eAdmin} not found. Use search to find time entries.` });
    const admin = (await records(t, "admin", [f.eAdmin])).results;
    expect(admin[0]).toMatchObject({ ok: true, record: { type: "time_entry", member: "Admin" } });
  });

  it("refuses more than 25 refs", async () => {
    const t = createT();
    await setup(t);
    await expect(records(t, "admin", Array.from({ length: 26 }, (_, i) => `ARLO-${i + 1}`))).rejects.toThrow(/at most 25/);
  });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe("search tasks", () => {
  it('"What\'s overdue for me?": mine + overdue, open tasks due before today (org timezone)', async () => {
    const t = createT();
    const f = await setup(t);
    const result = await taskSearch(t, "alice", { mine: true, overdue: true });
    expect(result.today).toBe("2026-10-24");
    expect(result.rows.map((r) => r.identifier)).toEqual([f.id.A]);
    expect(result.rows[0]).toMatchObject({ overdue: true, status: "In progress", assignees: ["Alice"] });
    expect(result.rows[0]).not.toHaveProperty("project");
    expect(result).toMatchObject({ total: 1, incomplete: false });
    // Admin's own overdue task is U; Alice's overdue A is not "mine" for the admin.
    expect((await taskSearch(t, "admin", { mine: true, overdue: true })).rows.map((r) => r.identifier)).toEqual([f.id.U]);
    await expect(taskSearch(t, "alice", { overdue: true, status: "Done" })).rejects.toThrow(/overdue covers open tasks/);
  });

  it("a member never finds a task the app would not show them", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = async (caller: Caller, args: Record<string, unknown>) =>
      (await taskSearch(t, caller, args)).rows.map((r) => r.identifier).sort();
    expect(await ids("admin", { query: "Alpha" })).toEqual([f.id.A, f.id.U].sort());
    expect(await ids("alice", { query: "Alpha" })).toEqual([f.id.A]);
    expect(await ids("bob", { query: "Alpha" })).toEqual([]);
    expect(await ids("other", { query: "Alpha" })).toEqual([f.id.X]);
    // A filter never widens visibility.
    expect(await ids("bob", { assignee: "clerk_alice@x.test" })).toEqual([]);
  });

  it("filters by assignee, status, label, client and project refs", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = async (args: Record<string, unknown>) =>
      (await taskSearch(t, "admin", args)).rows.map((r) => r.identifier).sort();
    expect(await ids({ assignee: "CLERK_ALICE@x.test" })).toEqual([f.id.A, f.id.B, f.id.S].sort());
    expect(await ids({ assignee: "me" })).toEqual([f.id.U]);
    expect(await ids({ status: "in progress" })).toEqual([f.id.A]);
    expect(await ids({ status: "completed" })).toEqual([f.id.D]);
    expect(await ids({ status: "any", project: "arlo" })).toEqual([f.id.P, f.id.S, f.id.A, f.id.D].sort());
    expect(await ids({ label: "launch" })).toEqual([f.id.P]);
    expect(await ids({ client: "konv" })).toEqual([f.id.B, f.id.U].sort());
    expect(await ids({ due: { from: "2026-10-23", to: "2026-10-24" } })).toEqual([f.id.A, f.id.B].sort());
    expect(await ids({ client: "client:KONV" })).toEqual([f.id.B, f.id.U].sort());
    await expect(ids({ client: "ELSE" })).rejects.toThrow('ELSE not found. Client prefixes (client:KEY) are listed in fetch("workspace").');
    await expect(ids({ project: "client:KONV" })).rejects.toThrow('"client:KONV" is a client prefix, not a project.');
    await expect(ids({ project: f.otherProject })).rejects.toThrow(/not found/);
    await expect(ids({ client: "ARLO-1" })).rejects.toThrow('"ARLO-1" is a task key, not a client.');
    await expect(ids({ status: "Nope" })).rejects.toThrow(/No status "Nope"/);
    await expect(ids({ assignee: "me", mine: true })).rejects.toThrow(/either mine or assignee/);
  });

  it("refuses to match a label against a clipped label list", async () => {
    const t = createT();
    await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < REF_CAP; i++) {
        await ctx.db.insert("labels", { orgId: ORG, name: `L${i}`, color: "red", position: `b${i}` });
      }
    });
    await expect(taskSearch(t, "admin", { label: "Launch" })).rejects.toThrow(
      `This workspace has more than ${REF_CAP} labels, so a label filter cannot be matched by name.`,
    );
  });

  it("pages with offset and reports the full total", async () => {
    const t = createT();
    const f = await setup(t);
    const first = await taskSearch(t, "admin", { limit: 2 });
    expect(first.total).toBe(5); // P, S, A, B, U (D is closed)
    expect(first.rows).toHaveLength(2);
    const second = await taskSearch(t, "admin", { limit: 2, offset: 2 });
    const third = await taskSearch(t, "admin", { limit: 2, offset: 4 });
    const all = [...first.rows, ...second.rows, ...third.rows].map((r) => r.identifier);
    expect(new Set(all).size).toBe(5);
    expect(all.sort()).toEqual([f.id.P, f.id.S, f.id.A, f.id.B, f.id.U].sort());
    await expect(taskSearch(t, "admin", { limit: 101 })).rejects.toThrow(/limit must be between 1 and 100/);
  });

  it("flags a capped load as incomplete instead of claiming a complete result", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      for (let i = 0; i < OPEN_ROW_CAP + 1; i++) {
        const number = 10_000 + i;
        await ctx.db.insert("tasks", {
          orgId: ORG, title: `Bulk ${i}`, hasDescription: false, identifier: `BULK-${number}`,
          numberScope: { kind: "org" }, number, statusId: f.status["Next up"], statusCategory: "unstarted",
          priority: 0, assigneeIds: [], labelIds: [], billable: true, sortKey: `z${String(i).padStart(5, "0")}`,
          trackedMinutes: 0, commentCount: 0, subtaskCount: 0, subtaskDoneCount: 0, lastActivityAt: NOW,
          createdAt: NOW, updatedAt: NOW, createdBy: f.admin,
        });
      }
    });
    const result = await taskSearch(t, "admin", { status: "unstarted" });
    expect(result.incomplete).toBe(true);
    expect(result.rows).toHaveLength(25);
  });
});

describe("search time entries, comments and reference data", () => {
  const timeSearch = (t: T, caller: Caller, args: Record<string, unknown> = {}) =>
    as(t, caller).query(api.mcp.search.timeEntries, { offset: 0, limit: 25, tracked: NO_RANGE, updated: NO_RANGE, now: NOW, ...args });
  const commentSearch = (t: T, caller: Caller, args: Record<string, unknown> = {}) =>
    as(t, caller).query(api.mcp.search.comments, { offset: 0, limit: 25, updated: NO_RANGE, now: NOW, ...args });

  it("time entries: members see only their own, with a note when they ask for others", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = await timeSearch(t, "admin");
    expect(admin).toMatchObject({ total: 3, totalMinutes: 135, incomplete: false, notes: [] });
    const aliceOwn = await timeSearch(t, "alice", { tracked: { from: "2026-10-01" } });
    expect(aliceOwn.rows.map((r) => r.id)).toEqual([f.eAlice]);
    expect(aliceOwn.totalMinutes).toBe(90);
    const aliceAsksAdmin = await timeSearch(t, "alice", { assignee: "clerk_admin@x.test" });
    expect(aliceAsksAdmin.rows).toEqual([]);
    expect(aliceAsksAdmin.notes).toEqual(["Members see only their own time entries, so entries logged by others are not shown."]);
    expect((await timeSearch(t, "admin", { assignee: "clerk_admin@x.test" })).rows.map((r) => r.id)).toEqual([f.eAdmin]);
    expect((await timeSearch(t, "admin", { client: "KONV" })).totalMinutes).toBe(15);
    expect((await timeSearch(t, "admin", { project: "ARLO", query: "hero" })).rows.map((r) => r.id)).toEqual([f.eAlice]);
    expect(JSON.stringify(admin)).not.toMatch(/Rate/);
    // A date range with a project reads the org's date index and filters the project.
    expect((await timeSearch(t, "admin", { project: "ARLO", tracked: { from: "2026-10-21" } })).rows.map((r) => r.id)).toEqual([f.eAdmin]);
  });

  it("time entries and comments filter by a task the caller can read", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = await timeSearch(t, "admin", { task: f.id.A });
    expect(admin.rows.map((r) => r.id)).toEqual([f.eAdmin, f.eAlice]);
    expect(admin.totalMinutes).toBe(120);
    expect((await timeSearch(t, "alice", { task: f.id.A.toLowerCase() })).rows.map((r) => r.id)).toEqual([f.eAlice]);
    await expect(timeSearch(t, "bob", { task: f.id.A })).rejects.toThrow(`${f.id.A} not found. Use search to find tasks.`);
    expect((await commentSearch(t, "admin", { task: f.id.P })).rows.map((r) => r.id)).toEqual([f.cP]);
    expect((await commentSearch(t, "carol", { task: f.id.P, query: "copy" })).rows.map((r) => r.id)).toEqual([f.cP]);
    await expect(commentSearch(t, "alice", { task: f.id.U })).rejects.toThrow(/not found/);
  });

  it("the comment scan is bounded and says incomplete when it hits its cap", async () => {
    const t = createT();
    const f = await setup(t);
    // 500 newer activity rows push every comment_added row past the scan cap.
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("activityLog", {
          taskId: f.A, orgId: ORG, userId: f.admin, type: "task_created", metadata: {}, createdAt: NOW + i,
        });
      }
    });
    const result = await commentSearch(t, "admin");
    expect(result).toMatchObject({ rows: [], total: 0, incomplete: true });
    // A task filter reads that task's comments directly.
    expect((await commentSearch(t, "admin", { task: f.id.A })).rows.map((r) => r.id)).toEqual([f.cA]);
  });

  it("comments: only on readable tasks, filtered by author and text", async () => {
    const t = createT();
    const f = await setup(t);
    const ids = async (caller: Caller, args: Record<string, unknown> = {}) =>
      (await commentSearch(t, caller, args)).rows.map((r) => r.id);
    expect(await ids("admin", { query: "hero" })).toEqual([f.cA, f.cU, f.cP]);
    expect(await ids("alice", { query: "hero" })).toEqual([f.cA]);
    expect(await ids("carol")).toEqual([f.cP]);
    expect(await ids("bob")).toEqual([]);
    expect(await ids("admin", { assignee: "clerk_carol@x.test" })).toEqual([f.cP]);
    expect(await ids("admin", { mine: true })).toEqual([f.cU]);
    expect(await ids("admin", { updatedSince: NOW - 4500 })).toEqual([f.cA, f.cU]);
    expect(await ids("other")).toEqual([]);
  });

  it("projects, clients and members of the caller's org only", async () => {
    const t = createT();
    await setup(t);
    const projects = await as(t, "alice").query(api.mcp.search.projects, { offset: 0, limit: 25 });
    expect(projects.rows.map((p) => p.code)).toEqual(["ARLO", "KSITE"]);
    const konvProjects = await as(t, "alice").query(api.mcp.search.projects, { offset: 0, limit: 25, client: "konv" });
    expect(konvProjects.rows.map((p) => p.code)).toEqual(["KSITE"]);
    const clients = await as(t, "admin").query(api.mcp.search.clients, { offset: 0, limit: 25, query: "dup" });
    expect(clients.rows.map((c) => c.name)).toEqual(["Dup A", "Dup B"]);
    const members = await as(t, "admin").query(api.mcp.search.members, { offset: 0, limit: 25, query: "x.test" });
    expect(members.rows.map((m) => m.name)).toEqual(["Admin", "Alice", "Bob", "Carol"]);
    expect(members.total).toBe(4);
  });

  it("session tokens cannot call the search functions (I4)", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity({ subject: "clerk_admin", issuer: "https://clerk.test", orgId: ORG, orgRole: "org:admin" })
        .query(api.mcp.search.members, { offset: 0, limit: 25 }),
    ).rejects.toThrow("MCP functions require an OAuth access token");
  });
});

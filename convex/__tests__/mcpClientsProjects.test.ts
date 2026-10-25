// @vitest-environment edge-runtime
//
// MCP slice 7a (docs/prd-mcp.md §6, §13): save_clients, save_projects and
// delete for projects and clients, through convex/mcp/* with OAuth identities.
//   §6   admins only, as in the app: members are refused, nothing is written
//   I3   other-org refs are "not found"
//   D3   app parity: the same documents as the app's own mutations
//   D15  a code rename's identifier_changed rows and the archive's saved
//        timer entries carry "via <client>"
//   D6   delete: the app's rules for projects and clients
//   D23  idempotency replay / mismatch
//   I5   one bad item writes nothing

import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";
import { connectMembers } from "./helpers/mcpConnections";
import { BILLING_TYPE_NOT_SET_NOTE } from "../lib/mcpSaveProjects";

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_mcp7";
const OTHER = "org_mcp7_other";

const createT = () => convexTest(schema, modules);
type T = ReturnType<typeof createT>;

type Caller = "admin" | "alice" | "other";

const SUBJECT: Record<Caller, [string, string, "admin" | "member"]> = {
  admin: ["clerk_admin", ORG, "admin"],
  alice: ["clerk_alice", ORG, "member"],
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

/** The fixture, with every member connected through the OAuth clients this file uses. */
async function setup(t: T) {
  const fixture = await setupData(t);
  await t.run((ctx) => connectMembers(ctx, ["client_claude"]));
  return fixture;
}

async function setupData(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now() - 3600_000;
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const other = await mkUser("Other", "clerk_other");
    for (const [userId, clerkUserId, role, orgId] of [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
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
    const design = await ctx.db.insert("workCategories", { orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin });
    const dev = await ctx.db.insert("workCategories", { orgId: ORG, name: "Development", color: "green", sortOrder: 1, createdAt: now, updatedAt: now, createdBy: admin });
    const arlow = await ctx.db.insert("clients", { orgId: ORG, name: "Arlow", currency: "EUR", prefix: "ARL", createdAt: now, updatedAt: now, createdBy: admin });
    const arlo = await ctx.db.insert("projects", {
      orgId: ORG, clientId: arlow, name: "Arlow site", code: "ARLO", billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const otherClient = await ctx.db.insert("clients", { orgId: OTHER, name: "Else", currency: "EUR", prefix: "ELS", createdAt: now, updatedAt: now, createdBy: other });
    const otherProject = await ctx.db.insert("projects", {
      orgId: OTHER, clientId: otherClient, name: "Else", code: "ELSE", billingType: "t_and_m", createdAt: now, updatedAt: now, createdBy: other,
    });
    const adminAuth: AuthContext = { userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))! };
    const task = await createTask(ctx, adminAuth, { title: "Hero", projectId: arlo, assigneeIds: [alice] }, { notify: false });
    return { admin, alice, other, design, dev, arlow, arlo, otherClient, otherProject, adminAuth, task };
  });
}

type Item = Record<string, unknown>;
const saveClients = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.saveClients, { items: items as never, clientName: "Claude", ...extra });
const saveProjects = (t: T, caller: Caller, items: Item[], extra: Record<string, unknown> = {}) =>
  as(t, caller).mutation(api.mcp.write.saveProjects, { items: items as never, clientName: "Claude", ...extra });
const remove = (t: T, caller: Caller, refs: string[]) =>
  as(t, caller).mutation(api.mcp.write.remove, { refs, clientName: "Claude" });

const get = <Table extends "clients" | "projects">(t: T, id: Id<Table>) =>
  t.run(async (ctx) => (await ctx.db.get(id)) as Doc<Table> | null);

/** A document without its identity and clock fields, for app-parity comparisons. */
function shape<D extends Record<string, unknown>>(doc: D | null, ...also: string[]): Record<string, unknown> {
  const drop = new Set(["_id", "_creationTime", "createdAt", "updatedAt", ...also]);
  return Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => !drop.has(k) && v !== undefined));
}

const counts = (t: T) =>
  t.run(async (ctx) => ({
    clients: (await ctx.db.query("clients").collect()).length,
    projects: (await ctx.db.query("projects").collect()).length,
    estimates: (await ctx.db.query("projectCategoryEstimates").collect()).length,
    overrides: (await ctx.db.query("projectRateOverrides").collect()).length,
  }));

/** Billing history fixtures: a logged entry, a draft invoice, a final close on a project. */
async function entry(t: T, f: Awaited<ReturnType<typeof setup>>, projectId: Id<"projects">, taskId: Id<"tasks">) {
  await t.run(async (ctx) => {
    await ctx.db.insert("timeEntries", {
      orgId: ORG, projectId, taskId, userId: f.alice, date: "2026-10-20", startedAt: Date.now(), durationMinutes: 30,
      isBillable: true, method: "manual", costRate: 1, billableRate: 1, rateCurrency: "EUR",
      createdAt: Date.now(), updatedAt: Date.now(), createdBy: f.alice,
    });
  });
}
const invoiceOn = (t: T, f: Awaited<ReturnType<typeof setup>>, projectId: Id<"projects">, clientId: Id<"clients">) =>
  t.run(async (ctx) =>
    await ctx.db.insert("invoices", {
      orgId: ORG, projectId, clientId, prefix: "INV", status: "draft", currency: "EUR",
      subtotalMinor: 0, totalMinor: 0, issueDate: "2026-10-01", createdAt: Date.now(), updatedAt: Date.now(), createdBy: f.admin,
    } as never),
  );
const closeOn = (t: T, f: Awaited<ReturnType<typeof setup>>, projectId: Id<"projects">) =>
  t.run(async (ctx) =>
    await ctx.db.insert("billingCloses", {
      orgId: ORG, projectId, kind: "t_and_m", status: "final", periodStart: "2026-09-01", periodEnd: "2026-09-30",
      currency: "EUR", roundingMinutes: 1, includedMinutes: 0, overageRateMinor: 0, usageMinutes: 0, overageMinutes: 0,
      amountMinor: 0, committedAt: Date.now(), committedBy: f.admin,
    } as never),
  );

describe("save_clients", () => {
  it("is admin-only: a member is refused and nothing is written", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await counts(t);
    await expect(saveClients(t, "alice", [{ name: "Nope" }])).rejects.toThrow("Clients are created and edited by admins only");
    await expect(saveClients(t, "alice", [{ ref: "client:ARL", notes: "x" }])).rejects.toThrow("admins only");
    expect(await counts(t)).toEqual(before);
    expect((await get(t, f.arlow))!.notes).toBeUndefined();
  });

  it("creates and edits exactly like the app's client form", async () => {
    const t = createT();
    const f = await setup(t);
    const fields = { currency: "HUF", usePrefix: true, billingName: "  Ap Team ", billingEmail: "ap@konv.test", taxId: "HU1", notes: "VIP" } as const;
    const appId = await inApp(t, "admin").mutation(api.clients.create, { name: "Konv App", prefix: "kapp", ...fields });
    const mcp = await saveClients(t, "admin", [{ name: "Konv Mcp", prefix: "kmcp", ...fields }]);
    expect(mcp.items[0]).toMatchObject({ name: "Konv Mcp", prefix: "KMCP", action: "created", archived: false });
    const mcpId = mcp.items[0].clientId;
    expect(shape(await get(t, mcpId), "name", "prefix")).toEqual(shape(await get(t, appId), "name", "prefix"));
    expect((await get(t, mcpId))!.prefix).toBe("KMCP");

    // Edit: the form's diff; null clears a billing field; the same values again are "unchanged".
    await inApp(t, "admin").mutation(api.clients.update, { id: appId, billingEmail: "", taxId: "HU2", name: "Konv App 2" });
    const edited = await saveClients(t, "admin", [{ ref: "client:KMCP", billingEmail: null, taxId: "HU2", name: "Konv Mcp 2" }]);
    expect(edited.items[0]).toMatchObject({ action: "updated", name: "Konv Mcp 2" });
    expect(shape(await get(t, mcpId), "name", "prefix")).toEqual(shape(await get(t, appId), "name", "prefix"));
    const again = await saveClients(t, "admin", [{ ref: mcpId, taxId: "HU2", prefix: "kmcp", currency: "HUF" }]);
    expect(again.items[0].action).toBe("unchanged");

    // Prefix rules: format and uniqueness (case-insensitive), currency immutable.
    await expect(saveClients(t, "admin", [{ ref: mcpId, prefix: "arl" }])).rejects.toThrow("already");
    await expect(saveClients(t, "admin", [{ name: "Bad", prefix: "K-1" }])).rejects.toThrow("is not valid");
    await expect(saveClients(t, "admin", [{ ref: mcpId, currency: "EUR" }])).rejects.toThrow("currency cannot change");

    // Archive / restore through the app's paths.
    const archived = await saveClients(t, "admin", [{ ref: "client:ARL", archived: true }]);
    expect(archived.items[0]).toMatchObject({ archived: true, action: "updated" });
    expect((await get(t, f.arlow))!.archivedAt).toBeDefined();
    await saveClients(t, "admin", [{ ref: "client:ARL", archived: false }]);
    expect((await get(t, f.arlow))!.archivedAt).toBeUndefined();
  });

  it("an edit that re-sends a legacy client's unchanged invoicePrefix heals it onto prefix, as the app does", async () => {
    const t = createT();
    const f = await setup(t);
    const legacy = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("clients", {
        orgId: ORG, name: "Legacy", currency: "EUR", invoicePrefix: "LEG", createdAt: now, updatedAt: now, createdBy: f.admin,
      });
    });
    const saved = await saveClients(t, "admin", [{ ref: legacy, prefix: "leg", notes: "unrelated edit" }]);
    expect(saved.items[0]).toMatchObject({ action: "updated", prefix: "LEG" });
    expect(await get(t, legacy)).toMatchObject({ prefix: "LEG", invoicePrefix: "LEG", notes: "unrelated edit" });
  });

  it("later items see earlier writes: a new or renamed client:PREFIX resolves in the same call", async () => {
    const t = createT();
    const f = await setup(t);
    const saved = await saveClients(t, "admin", [
      { name: "Fresh", prefix: "NEW" },
      { ref: "client:NEW", taxId: "T1" },
      { ref: "client:ARL", prefix: "ARX" },
      { ref: "client:ARX", notes: "renamed" },
      { ref: "client:ARX", archived: true },
      { ref: "client:ARX", name: "Arlow 2" },
    ]);
    expect(saved.items.map((i) => i.action)).toEqual(["created", "updated", "updated", "updated", "updated", "updated"]);
    const arlow = (await get(t, f.arlow))!;
    expect(arlow).toMatchObject({ prefix: "ARX", notes: "renamed", name: "Arlow 2" });
    expect(arlow.archivedAt).toBeDefined();
    expect((await get(t, saved.items[0].clientId))!.taxId).toBe("T1");
    await expect(saveClients(t, "admin", [{ ref: "client:ARL", notes: "x" }])).rejects.toThrow("not found");
  });

  it("is all-or-nothing, never resolves another org's client and replays an idempotency key", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await counts(t);
    await expect(saveClients(t, "admin", [{ name: "Fine" }, { name: "Arlow" }])).rejects.toThrow(
      "Item 2 (Arlow): A client with this name already exists. Nothing was saved.",
    );
    expect(await counts(t)).toEqual(before);
    await expect(saveClients(t, "admin", [{ ref: f.otherClient, notes: "x" }])).rejects.toThrow("not found");
    await expect(saveClients(t, "admin", [{ ref: "client:ELS", notes: "x" }])).rejects.toThrow("not found");

    const first = await saveClients(t, "admin", [{ name: "Once" }], { idempotencyKey: "k1" });
    const replay = await saveClients(t, "admin", [{ name: "Once" }], { idempotencyKey: "k1" });
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await counts(t)).clients).toBe(before.clients + 1);
    await expect(saveClients(t, "admin", [{ name: "Twice" }], { idempotencyKey: "k1" })).rejects.toThrow("different request");
  });
});

describe("save_projects", () => {
  it("is admin-only: a member is refused and nothing is written", async () => {
    const t = createT();
    await setup(t);
    const before = await counts(t);
    await expect(
      saveProjects(t, "alice", [{ name: "X", client: "client:ARL", billingType: "non_billable" }]),
    ).rejects.toThrow("Projects are created and edited by admins only");
    await expect(saveProjects(t, "alice", [{ ref: "ARLO", name: "Renamed" }])).rejects.toThrow("admins only");
    expect(await counts(t)).toEqual(before);
  });

  it("creates retainer and fixed projects exactly like the New Project form", async () => {
    const t = createT();
    const f = await setup(t);
    const retainer = {
      billingType: "retainer" as const, includedMinutesPerMonth: 1200, monthlyFee: 2000, overageRate: 95,
      startDate: "2026-11-01", cycleLength: 3, rolloverEnabled: true, teamMembers: [f.alice],
    };
    const appRetainer = await inApp(t, "admin").mutation(api.projects.create, { clientId: f.arlow, name: "Ret App", code: "RAPP", ...retainer });
    const mcp = await saveProjects(t, "admin", [
      {
        name: "Ret Mcp", client: "client:ARL", code: "rmcp", billingType: "retainer", includedMinutes: 1200, monthlyFee: 2000,
        overageRate: 95, startDate: "2026-11-01", cycleLength: 3, rollover: true, team: [email("alice")],
      },
      { name: "Fix Mcp", client: f.arlow, code: "FMCP", billingType: "fixed", fixedFee: 12000, estimates: [{ category: "Design", minutes: 600 }], rates: [{ category: "Design", rate: 140 }] },
    ]);
    expect(mcp.items.map((i) => [i.code, i.billingType, i.action])).toEqual([["RMCP", "retainer", "created"], ["FMCP", "fixed", "created"]]);
    expect(shape(await get(t, mcp.items[0].projectId), "name", "code")).toEqual(shape(await get(t, appRetainer), "name", "code"));

    const appFixed = await inApp(t, "admin").mutation(api.projects.create, {
      clientId: f.arlow, name: "Fix App", code: "FAPP", billingType: "fixed", fixedPrice: 12000,
      categoryEstimates: [{ workCategoryId: f.design, estimatedMinutes: 600 }],
    });
    await inApp(t, "admin").mutation(api.projectRateOverrides.upsert, { projectId: appFixed, workCategoryId: f.design, billableRate: 140 });
    expect(shape(await get(t, mcp.items[1].projectId), "name", "code")).toEqual(shape(await get(t, appFixed), "name", "code"));
    const children = (projectId: Id<"projects">) =>
      t.run(async (ctx) => ({
        estimates: (await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
          .map((e) => [e.workCategoryId, e.estimatedMinutes]).sort(),
        overrides: (await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
          .map((o) => [o.workCategoryId, o.billableRate]),
      }));
    expect(await children(mcp.items[1].projectId)).toEqual(await children(appFixed));
  });

  it("edits through Settings' paths: diff only, code rename with aliases and via, retainer terms, estimates, rates", async () => {
    const t = createT();
    const f = await setup(t);
    const before = await t.run(async (ctx) => (await ctx.db.get(f.task))!.identifier!);
    expect(before).toBe("ARLO-1");

    const renamed = await saveProjects(t, "admin", [{ ref: "ARLO", code: "arw", name: "Arlow web", team: ["me", email("alice")] }]);
    expect(renamed.items[0]).toMatchObject({ code: "ARW", previousCode: "ARLO", name: "Arlow web", action: "updated" });
    const after = await t.run(async (ctx) => ({
      task: (await ctx.db.get(f.task))!,
      alias: await ctx.db.query("taskIdentifierAliases").withIndex("by_orgId_identifier", (q) => q.eq("orgId", ORG).eq("identifier", "ARLO-1")).first(),
      activity: (await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", f.task)).collect()).filter((a) => a.type === "identifier_changed"),
      project: (await ctx.db.get(f.arlo))!,
    }));
    expect(after.task.identifier).toBe("ARW-1");
    expect(after.alias?.taskId).toBe(f.task);
    expect(after.activity).toHaveLength(1);
    expect(after.activity[0]).toMatchObject({ userId: f.admin, via: { kind: "mcp", clientId: "client_claude", clientName: "Claude" } });
    expect(after.project.teamMembers).toEqual([f.admin, f.alice]);

    // Same values again: nothing written.
    const same = await saveProjects(t, "admin", [{ ref: "ARW", code: "ARW", name: "Arlow web", team: [email("alice"), "me"], billingType: "t_and_m" }]);
    expect(same.items[0].action).toBe("unchanged");

    // One code change per call; the client never changes (the billing type: see
    // "billing type change" below); fields must apply.
    const two = await saveProjects(t, "admin", [{ name: "P2", client: "client:ARL", billingType: "non_billable", code: "PTWO" }]);
    await expect(saveProjects(t, "admin", [{ ref: "ARW", code: "ARX" }, { ref: two.items[0].projectId, code: "PTHREE" }])).rejects.toThrow(
      "Change at most one project code per call",
    );
    await expect(saveProjects(t, "admin", [{ ref: "ARW", client: f.otherClient }])).rejects.toThrow("not found");
    await expect(saveProjects(t, "admin", [{ ref: "ARW", fixedFee: 10 }])).rejects.toThrow("fixedFee applies to fixed-fee projects");
    await expect(saveProjects(t, "admin", [{ ref: "ARW", monthlyFee: 10 }])).rejects.toThrow("apply to retainer projects");
    await expect(saveProjects(t, "admin", [{ ref: "ARW", estimates: [] }])).rejects.toThrow("estimates apply to fixed-fee");

    // T&M rates: the Rates settings (override, then back to the default with null).
    await saveProjects(t, "admin", [{ ref: "ARW", rates: [{ category: "Design", rate: 120 }, { category: "Development", rate: 100 }] }]);
    await saveProjects(t, "admin", [{ ref: "ARW", rates: [{ category: "Development", rate: null }] }]);
    const overrides = await t.run(async (ctx) =>
      (await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", f.arlo)).collect()).map((o) => [o.workCategoryId, o.billableRate]),
    );
    expect(overrides).toEqual([[f.design, 120]]);

    // Retainer terms: the app's updateRetainer (confirmed), compared with the Settings call.
    const created = await saveProjects(t, "admin", [
      { name: "R1", client: "client:ARL", billingType: "retainer", includedMinutes: 600, overageRate: 90, startDate: "2026-01-01" },
      { name: "R2", client: "client:ARL", billingType: "retainer", includedMinutes: 600, overageRate: 90, startDate: "2026-01-01" },
    ]);
    const [r1, r2] = created.items.map((i) => i.projectId);
    await inApp(t, "admin").mutation(api.projects.updateRetainer, {
      id: r1, includedMinutesPerMonth: 900, monthlyFee: 1500, overageRate: 110, retainerStatus: "inactive", confirmed: true,
    });
    await saveProjects(t, "admin", [{ ref: r2, includedMinutes: 900, monthlyFee: 1500, overageRate: 110, retainerActive: false }]);
    expect(shape(await get(t, r2), "name", "code")).toEqual(shape(await get(t, r1), "name", "code"));

    // Fixed estimates replace the list, as the Budget settings' Save.
    const fixed = await saveProjects(t, "admin", [
      { name: "F1", client: "client:ARL", billingType: "fixed", fixedFee: 5000, estimates: [{ category: "Design", minutes: 60 }, { category: "Development", minutes: 120 }] },
    ]);
    await saveProjects(t, "admin", [{ ref: fixed.items[0].projectId, estimates: [{ category: "Development", minutes: 180 }] }]);
    const estimates = await t.run(async (ctx) =>
      (await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", fixed.items[0].projectId)).collect()).map((e) => [e.workCategoryId, e.estimatedMinutes]),
    );
    expect(estimates).toEqual([[f.dev, 180]]);
  });

  it("T&M create with rates; durations as strings; rollover rules", async () => {
    const t = createT();
    const f = await setup(t);
    const tm = await saveProjects(t, "admin", [
      { name: "TM", client: "client:ARL", code: "TMX", billingType: "t_and_m", rates: [{ category: "Design", rate: 130 }], team: ["me"] },
    ]);
    expect(tm.items[0]).toMatchObject({ code: "TMX", billingType: "t_and_m", action: "created" });
    const appTm = await inApp(t, "admin").mutation(api.projects.create, { clientId: f.arlow, name: "TM app", code: "TMA", billingType: "t_and_m", teamMembers: [f.admin] });
    expect(shape(await get(t, tm.items[0].projectId), "name", "code")).toEqual(shape(await get(t, appTm), "name", "code"));
    const rate = await t.run(async (ctx) =>
      (await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", tm.items[0].projectId)).collect()).map((o) => o.billableRate),
    );
    expect(rate).toEqual([130]);

    // Durations: "20h" and "1h30m" are the app's parser's minutes; nonsense is refused.
    const ret = await saveProjects(t, "admin", [
      { name: "Ret", client: "client:ARL", billingType: "retainer", includedMinutes: "20h", overageRate: 90, startDate: "2026-01-01", cycleLength: 3, rollover: true },
      { name: "Fix", client: "client:ARL", billingType: "fixed", fixedFee: 100, estimates: [{ category: "Design", minutes: "1h30m" }, { category: "Development", minutes: 0 }] },
    ]);
    expect((await get(t, ret.items[0].projectId))!.includedMinutesPerMonth).toBe(1200);
    const est = await t.run(async (ctx) =>
      (await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", ret.items[1].projectId)).collect())
        .map((e) => [e.workCategoryId, e.estimatedMinutes]).sort(),
    );
    expect(est).toEqual([[f.design, 90], [f.dev, 0]].sort());
    await expect(saveProjects(t, "admin", [{ ref: ret.items[0].projectId, includedMinutes: "lots" }])).rejects.toThrow("is not a duration");

    // Rollover needs a 2+ month cycle (the app would silently turn it off).
    await expect(
      saveProjects(t, "admin", [{ name: "R1", client: "client:ARL", billingType: "retainer", includedMinutes: 60, overageRate: 1, startDate: "2026-01-01", rollover: true }]),
    ).rejects.toThrow("rollover needs a cycle of 2 or more months");
    await expect(saveProjects(t, "admin", [{ ref: ret.items[0].projectId, cycleLength: 1, rollover: true }])).rejects.toThrow("rollover needs a cycle");

    // With a live close the cycle is locked: an unchanged rollover/cycle is not sent, so the fee still saves.
    await t.run(async (ctx) =>
      ctx.db.insert("billingCloses", {
        orgId: ORG, projectId: ret.items[0].projectId, kind: "retainer", status: "final", periodStart: "2026-01-01", periodEnd: "2026-03-31",
        currency: "EUR", roundingMinutes: 1, includedMinutes: 3600, overageRateMinor: 9000, usageMinutes: 0, overageMinutes: 0,
        amountMinor: 0, committedAt: Date.now(), committedBy: f.admin,
      } as never),
    );
    const fee = await saveProjects(t, "admin", [{ ref: ret.items[0].projectId, monthlyFee: 2500, rollover: true, cycleLength: 3 }]);
    expect(fee.items[0].action).toBe("updated");
    expect((await get(t, ret.items[0].projectId))!.monthlyFee).toBe(2500);
    await expect(saveProjects(t, "admin", [{ ref: ret.items[0].projectId, startDate: "2026-02-01" }])).rejects.toThrow(
      "Reopen or void the closed periods before changing the billing cycle.",
    );
  });

  it("archives with the app's timer rescue (via on the saved entry) and restores", async () => {
    const t = createT();
    const f = await setup(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("userRates", { orgId: ORG, userId: f.alice, currency: "EUR", costRate: 40, createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("categoryRates", { orgId: ORG, workCategoryId: f.design, currency: "EUR", defaultBillRate: 100, createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(f.task, { workCategoryId: f.design });
      await ctx.db.patch(f.alice, { timerTaskId: f.task, timerStatus: "running", timerStartedAt: Date.now() - 44.5 * 60_000 });
    });
    const archived = await saveProjects(t, "admin", [{ ref: "ARLO", archived: true }]);
    expect(archived.items[0]).toMatchObject({ archived: true, action: "updated" });
    const saved = archived.items[0].autoSavedTimers ?? [];
    const failed = archived.items[0].timerSaveFailures ?? [];
    expect(failed).toEqual([]);
    expect(saved).toEqual([{ member: "Alice", minutes: 45 }]);
    const logged = await t.run(async (ctx) =>
      (await ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", f.task)).collect()).find((a) => a.type === "time_entry_logged"),
    );
    expect(logged?.via).toMatchObject({ kind: "mcp", clientName: "Claude" });
    expect((await get(t, f.arlo))!.archivedAt).toBeDefined();
    await saveProjects(t, "admin", [{ ref: "ARLO", archived: false }]);
    expect((await get(t, f.arlo))!.archivedAt).toBeUndefined();
  });

  it("never resolves another org's project", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(saveProjects(t, "admin", [{ ref: "ELSE", name: "x" }])).rejects.toThrow("ELSE not found");
    await expect(saveProjects(t, "admin", [{ ref: f.otherProject, name: "x" }])).rejects.toThrow("not found");
    await expect(saveProjects(t, "admin", [{ name: "X", client: "client:ELS", billingType: "non_billable" }])).rejects.toThrow("not found");
  });
});

describe("billing type change (D-BILLINGTYPE, owner 2026-10-25)", () => {
  const TERMS = ["fixedPrice", "retainerStatus", "includedMinutesPerMonth", "monthlyFee", "overageRate", "startDate", "rolloverEnabled", "cycleLength"] as const;
  /** The billing term fields a project document carries (set ones only). */
  const terms = (doc: Doc<"projects">) => Object.fromEntries(TERMS.map((k) => [k, doc[k]]).filter(([, v]) => v !== undefined));
  const children = (t: T, projectId: Id<"projects">) =>
    t.run(async (ctx) => ({
      estimates: (await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
        .map((e) => [e.workCategoryId, e.estimatedMinutes]).sort(),
      overrides: (await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect())
        .map((o) => [o.workCategoryId, o.billableRate]),
    }));
  const canChange = async (t: T, id: Id<"projects">) => (await inApp(t, "admin").query(api.projects.get, { id }))!.canChangeBillingType;

  it("a create without billingType starts non-billable and says so; terms without a type are refused", async () => {
    const t = createT();
    await setup(t);
    const saved = await saveProjects(t, "admin", [{ name: "Terms later", client: "client:ARL" }]);
    expect(saved.items[0]).toMatchObject({ billingType: "non_billable", action: "created", note: BILLING_TYPE_NOT_SET_NOTE });
    expect(terms((await get(t, saved.items[0].projectId))!)).toEqual({});
    const typed = await saveProjects(t, "admin", [{ name: "Typed", client: "client:ARL", billingType: "t_and_m" }]);
    expect(typed.items[0].note).toBeUndefined();
    await expect(saveProjects(t, "admin", [{ name: "X", client: "client:ARL", fixedFee: 100 }])).rejects.toThrow(
      "billingType is required with fixedFee",
    );
    await expect(saveProjects(t, "admin", [{ name: "X", client: "client:ARL", includedMinutes: 60, rates: [] }])).rejects.toThrow(
      "billingType is required with rates, includedMinutes",
    );
  });

  it("changes the type with the new terms while there is no billing history: app and MCP write the same document, stale terms are cleared", async () => {
    const t = createT();
    const f = await setup(t);
    const [a, b] = (
      await saveProjects(t, "admin", [
        { name: "A", client: "client:ARL", code: "AAA" },
        { name: "B", client: "client:ARL", code: "BBB" },
      ])
    ).items.map((i) => i.projectId);
    const taskA = await t.run(async (ctx) => await createTask(ctx, f.adminAuth, { title: "A1", projectId: a }, { notify: false }));
    await entry(t, f, a, taskA);
    const entryBefore = await t.run(async (ctx) =>
      (await ctx.db.query("timeEntries").withIndex("by_orgId_projectId_closeId", (q) => q.eq("orgId", ORG).eq("projectId", a)).collect())[0],
    );
    expect(await canChange(t, a)).toBe(true);

    // non-billable → retainer: the app's Settings (projects.update) and MCP write the same document.
    await inApp(t, "admin").mutation(api.projects.update, {
      id: a, billingType: "retainer", includedMinutesPerMonth: 600, monthlyFee: 1500, overageRate: 90, startDate: "2026-11-01", cycleLength: 3,
    });
    const viaMcp = await saveProjects(t, "admin", [
      { ref: "BBB", billingType: "retainer", includedMinutes: "10h", monthlyFee: 1500, overageRate: 90, startDate: "2026-11-01", cycleLength: 3 },
    ]);
    expect(viaMcp.items[0]).toMatchObject({ code: "BBB", billingType: "retainer", action: "updated" });
    const docA = (await get(t, a))!;
    expect(terms(docA)).toEqual({
      retainerStatus: "active", includedMinutesPerMonth: 600, monthlyFee: 1500, overageRate: 90, startDate: "2026-11-01", rolloverEnabled: true, cycleLength: 3,
    });
    // (A has a task, hence a nextTaskNumber; B has none.)
    expect(shape(await get(t, b), "name", "code")).toEqual(shape(docA, "name", "code", "nextTaskNumber"));
    // Logged time is untouched: its billable flag and rate snapshot are per entry.
    expect(await t.run(async (ctx) => await ctx.db.get(entryBefore._id))).toEqual(entryBefore);

    // retainer → fixed: the retainer terms go, the fee is set, Budget rows are seeded as a
    // fixed create does (listed + the other active categories at 0); rate overrides stay.
    await inApp(t, "admin").mutation(api.projectRateOverrides.upsert, { projectId: a, workCategoryId: f.design, billableRate: 140 });
    await inApp(t, "admin").mutation(api.projects.update, {
      id: a, billingType: "fixed", fixedPrice: 9000, categoryEstimates: [{ workCategoryId: f.design, estimatedMinutes: 300 }],
    });
    await saveProjects(t, "admin", [
      { ref: "BBB", billingType: "fixed", fixedFee: 9000, estimates: [{ category: "Design", minutes: "5h" }], rates: [{ category: "Design", rate: 140 }] },
    ]);
    expect(terms((await get(t, a))!)).toEqual({ fixedPrice: 9000 });
    expect(shape(await get(t, b), "name", "code")).toEqual(shape(await get(t, a), "name", "code", "nextTaskNumber"));
    expect(await children(t, a)).toEqual({ estimates: [[f.design, 300], [f.dev, 0]].sort(), overrides: [[f.design, 140]] });
    expect(await children(t, b)).toEqual(await children(t, a));

    // fixed → T&M: the fee and the Budget rows go; rate overrides stay (both types take rates).
    await saveProjects(t, "admin", [{ ref: "AAA", billingType: "t_and_m" }]);
    expect(terms((await get(t, a))!)).toEqual({});
    expect(await children(t, a)).toEqual({ estimates: [], overrides: [[f.design, 140]] });

    // T&M → non-billable: the rate overrides go too (no type that takes rates).
    await inApp(t, "admin").mutation(api.projects.update, { id: a, billingType: "non_billable" });
    expect((await get(t, a))!.billingType).toBe("non_billable");
    expect(await children(t, a)).toEqual({ estimates: [], overrides: [] });

    // The same type is not a change; a change validates the new terms as create does; fields must apply to the NEW type.
    expect((await saveProjects(t, "admin", [{ ref: "AAA", billingType: "non_billable" }])).items[0].action).toBe("unchanged");
    await expect(saveProjects(t, "admin", [{ ref: "AAA", billingType: "fixed" }])).rejects.toThrow("Fixed fee is required");
    await expect(saveProjects(t, "admin", [{ ref: "AAA", billingType: "retainer", includedMinutes: 60, overageRate: 90 }])).rejects.toThrow(
      "Start date is required",
    );
    await expect(
      inApp(t, "admin").mutation(api.projects.update, { id: a, billingType: "retainer", includedMinutesPerMonth: 60, startDate: "2026-01-01" }),
    ).rejects.toThrow("Overage rate is required");
    await expect(saveProjects(t, "admin", [{ ref: "AAA", billingType: "fixed", fixedFee: 10, monthlyFee: 5 }])).rejects.toThrow(
      "monthlyFee apply to retainer projects",
    );
    // Without a type change, retainer terms and estimates belong to their own settings.
    await expect(inApp(t, "admin").mutation(api.projects.update, { id: a, monthlyFee: 5 })).rejects.toThrow("monthlyFee is edited in the Retainer settings");
    await expect(inApp(t, "admin").mutation(api.projects.update, { id: a, categoryEstimates: [] })).rejects.toThrow("edited in the Budget settings");
    expect(terms((await get(t, a))!)).toEqual({});
    expect((await get(t, a))!.billingType).toBe("non_billable");
  });

  it("is refused once a close (any status) or an invoice exists, in the app too; projects.get says so", async () => {
    const t = createT();
    const f = await setup(t);
    const [closed, invoiced] = (
      await saveProjects(t, "admin", [
        { name: "Closed", client: "client:ARL", code: "CLOS", billingType: "t_and_m" },
        { name: "Invoiced", client: "client:ARL", code: "INVD", billingType: "t_and_m" },
      ])
    ).items.map((i) => i.projectId);
    expect(await canChange(t, closed)).toBe(true);
    const close = await closeOn(t, f, closed);
    await invoiceOn(t, f, invoiced, f.arlow);
    for (const id of [closed, invoiced]) {
      expect(await canChange(t, id)).toBe(false);
      await expect(saveProjects(t, "admin", [{ ref: id, billingType: "fixed", fixedFee: 100 }])).rejects.toThrow(
        "billing type cannot change once billing has started",
      );
      await expect(inApp(t, "admin").mutation(api.projects.update, { id, billingType: "non_billable" })).rejects.toThrow("billing type cannot change");
      expect((await get(t, id))!.billingType).toBe("t_and_m");
    }
    // A released close is history too; unrelated edits still work, and the same type is not a change.
    await t.run((ctx) => ctx.db.patch(close, { status: "released", releasedAt: Date.now(), releasedReason: "reopened" }));
    await expect(saveProjects(t, "admin", [{ ref: "CLOS", billingType: "non_billable" }])).rejects.toThrow("billing type cannot change");
    expect((await saveProjects(t, "admin", [{ ref: "CLOS", name: "Closed 2", billingType: "t_and_m" }])).items[0]).toMatchObject({ action: "updated", name: "Closed 2" });
  });
});

describe("delete projects and clients (D6, D-DELETEGUARD)", () => {
  /** An empty T&M project under `client`, created through MCP. */
  const emptyProject = async (t: T, client: string, name: string) =>
    (await saveProjects(t, "admin", [{ name, client, billingType: "t_and_m" }])).items[0];

  it("is admin-only and never reaches another org", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(remove(t, "alice", ["ARLO"])).rejects.toThrow("Admin access required");
    await expect(remove(t, "alice", ["client:ARL"])).rejects.toThrow("Admin access required");
    await expect(remove(t, "admin", [f.otherProject])).rejects.toThrow("not found");
    await expect(remove(t, "admin", ["client:ELS"])).rejects.toThrow("not found");
    expect(await get(t, f.arlo)).not.toBeNull();
  });

  it("projects: refused with time entries, a running timer, tasks, invoices or closes — in the app too", async () => {
    const t = createT();
    const f = await setup(t);
    await entry(t, f, f.arlo, f.task);
    await expect(remove(t, "admin", ["ARLO"])).rejects.toThrow("Cannot delete a project with time entries — archive it instead");

    const timed = await emptyProject(t, "client:ARL", "Timed");
    const task = await t.run(async (ctx) => await createTask(ctx, f.adminAuth, { title: "Timed", projectId: timed.projectId }, { notify: false }));
    await t.run(async (ctx) => ctx.db.patch(f.alice, { timerTaskId: task, timerStatus: "running", timerStartedAt: Date.now() }));
    await expect(remove(t, "admin", [timed.projectId])).rejects.toThrow("Alice has a running timer on this project");
    await t.run(async (ctx) => ctx.db.patch(f.alice, { timerTaskId: undefined, timerStatus: undefined, timerStartedAt: undefined }));
    // Any task blocks it, archived ones included; the app's own mutation says the same.
    await t.run(async (ctx) => ctx.db.patch(task, { archivedAt: Date.now() }));
    await expect(remove(t, "admin", [timed.projectId])).rejects.toThrow("Cannot delete a project with tasks — archive it instead");
    await expect(inApp(t, "admin").mutation(api.projects.remove, { id: timed.projectId })).rejects.toThrow(
      "Cannot delete a project with tasks — archive it instead",
    );

    const invoiced = await emptyProject(t, "client:ARL", "Invoiced");
    await invoiceOn(t, f, invoiced.projectId, f.arlow);
    await expect(remove(t, "admin", [invoiced.projectId])).rejects.toThrow("Cannot delete a project with invoices — archive it instead");

    const closed = await emptyProject(t, "client:ARL", "Closed");
    await closeOn(t, f, closed.projectId);
    await expect(remove(t, "admin", [closed.projectId])).rejects.toThrow(
      "Cannot delete a project with closed billing periods — archive it instead",
    );
    expect(await get(t, timed.projectId)).not.toBeNull();
  });

  it("projects: an empty one is deleted with its estimates and rate overrides", async () => {
    const t = createT();
    await setup(t);
    const fixed = await saveProjects(t, "admin", [
      { name: "F", client: "client:ARL", billingType: "fixed", fixedFee: 100, estimates: [{ category: "Design", minutes: 60 }], rates: [{ category: "Design", rate: 1 }] },
    ]);
    const projectId = fixed.items[0].projectId;
    const deleted = await remove(t, "admin", [projectId]);
    expect(deleted.items[0]).toMatchObject({ type: "project", label: `project ${fixed.items[0].code} · F`, action: "deleted" });
    expect(await get(t, projectId)).toBeNull();
    const left = await t.run(async (ctx) => ({
      estimates: await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      overrides: await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    }));
    expect(left).toEqual({ estimates: [], overrides: [] });
  });

  it("clients: refused when any project has tasks, time, invoices or closes, naming the project", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(remove(t, "admin", ["client:ARL"])).rejects.toThrow(
      "Cannot delete a client whose project ARLO has tasks — archive it instead",
    );
    await expect(inApp(t, "admin").mutation(api.clients.remove, { id: f.arlow })).rejects.toThrow("whose project ARLO has tasks");

    const fresh = (await saveClients(t, "admin", [{ name: "Blocked", prefix: "BLK" }])).items[0].clientId;
    const project = await emptyProject(t, "client:BLK", "Blocked site");
    const invoice = await invoiceOn(t, f, project.projectId, fresh);
    await expect(remove(t, "admin", ["client:BLK"])).rejects.toThrow(`whose project ${project.code} has invoices`);
    await t.run(async (ctx) => ctx.db.delete(invoice));
    const close = await closeOn(t, f, project.projectId);
    await expect(remove(t, "admin", ["client:BLK"])).rejects.toThrow(`whose project ${project.code} has closed billing periods`);
    await t.run(async (ctx) => ctx.db.delete(close));
    const task = await t.run(async (ctx) => await createTask(ctx, f.adminAuth, { title: "x", projectId: project.projectId }, { notify: false }));
    await entry(t, f, project.projectId, task);
    await expect(remove(t, "admin", ["client:BLK"])).rejects.toThrow(`whose project ${project.code} has time entries`);
    expect(await get(t, fresh)).not.toBeNull();
  });

  it("clients: deleted with contacts, projects, estimates and rate overrides", async () => {
    const t = createT();
    const f = await setup(t);
    const clientId = (await saveClients(t, "admin", [{ name: "Gone", prefix: "GONE" }])).items[0].clientId;
    const project = await saveProjects(t, "admin", [
      { name: "Gone site", client: "client:GONE", billingType: "fixed", fixedFee: 10, estimates: [{ category: "Design", minutes: 30 }], rates: [{ category: "Design", rate: 5 }] },
    ]);
    const projectId = project.items[0].projectId;
    await t.run(async (ctx) =>
      ctx.db.insert("clientContacts", { orgId: ORG, clientId, name: "C", email: "c@x.test", isPrimary: true, createdAt: 1, updatedAt: 1, createdBy: f.admin }),
    );
    // The project listed after its client: already deleted with it.
    const deleted = await remove(t, "admin", ["client:GONE", projectId]);
    expect(deleted.items.map((i) => [i.type, i.action])).toEqual([["client", "deleted"], ["project", "already_deleted"]]);
    expect(deleted.items[0].label).toBe("client client:GONE · Gone");
    const left = await t.run(async (ctx) => ({
      client: await ctx.db.get(clientId),
      project: await ctx.db.get(projectId),
      contacts: await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).collect(),
      estimates: await ctx.db.query("projectCategoryEstimates").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
      overrides: await ctx.db.query("projectRateOverrides").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).collect(),
    }));
    expect(left).toEqual({ client: null, project: null, contacts: [], estimates: [], overrides: [] });
  });
});

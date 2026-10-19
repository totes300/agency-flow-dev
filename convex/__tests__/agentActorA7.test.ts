// @vitest-environment edge-runtime
//
// A7 — every registry tool on the actor path (docs/prd-email-triage-
// implementation-plan.md §3 P1):
//   - each migrated actor variant returns exactly what the public query
//     returns for the same admin / member (one shared `*ForAuth` core);
//   - scope is unchanged: members get money stripped from the finance
//     summary, are self-scoped in time reports, and are refused by every
//     admin-only collector inside the core (not only at tool-build time);
//   - the interactive role fails closed: a signed-in actor is an admin only
//     if orgMembers AND the JWT say so; no identity = orgMembers only;
//   - background, job and question-answer runs get the same tools as an
//     interactive run (finance tools as the designated admin, createSheet /
//     the timesheet persisting artifacts, the archive proposal), except the
//     interactive-only connector tools, which are dropped and recorded.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { registerAgentJobForTesting } from "../lib/agentJobs";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";

const modelSlot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../lib/worksheetAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/worksheetAi")>();
  return {
    ...actual,
    resolveModel: () => {
      if (!modelSlot.current) {
        throw new actual.WorksheetAiUnavailableError("no mock model set");
      }
      return modelSlot.current;
    },
  };
});

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_a7";
const IDENTITY = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
} as const;
const ADMIN_REQUIRED = /Admin access required/;

// Entries are dated in the current month so "this month" / in-progress
// branches are exercised without faking the clock under the agent component.
const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = TODAY.slice(0, 7);
const YEAR = Number(MONTH.slice(0, 4));
const MONTH_NUM = Number(MONTH.slice(5, 7));
const FIRST = `${MONTH}-01`;

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  clientId: Id<"clients">;
  tmProject: Id<"projects">;
  retainer: Id<"projects">;
  aliceTask: Id<"tasks">;
  aliceTaskIdentifier: string;
  invoiceRef: string;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_admin", userId: admin, role: "admin", joinedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_alice", userId: alice, role: "member", joinedAt: now });
    await ctx.db.insert("orgSettings", {
      orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 1,
      createdAt: now, updatedAt: now, createdBy: admin, agentActorUserId: admin,
    });
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: admin,
      });
    }
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "EUR", createdAt: now, updatedAt: now, createdBy: admin,
    });
    const categoryId = await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const tmProject = await ctx.db.insert("projects", {
      orgId: ORG, clientId, name: "Arlow site", code: "ARLO", billingType: "t_and_m",
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const retainer = await ctx.db.insert("projects", {
      orgId: ORG, clientId, name: "Arlow care", code: "CARE", billingType: "retainer",
      monthlyFee: 1000, includedMinutesPerMonth: 600, overageRate: 90, startDate: `${YEAR}-01-01`,
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = {
      userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))!,
    };
    const aliceTask = await createTask(
      ctx, adminAuth, { title: "Homepage hero", projectId: tmProject, assigneeIds: [alice], workCategoryId: categoryId },
      { notify: false },
    );
    const careTask = await createTask(
      ctx, adminAuth, { title: "Monthly care", projectId: retainer, assigneeIds: [admin] },
      { notify: false },
    );
    const entry = (taskId: Id<"tasks">, projectId: Id<"projects">, userId: Id<"users">, minutes: number, note?: string) =>
      ctx.db.insert("timeEntries", {
        orgId: ORG, projectId, taskId, userId, date: FIRST, startedAt: Date.parse(`${FIRST}T09:00:00Z`),
        durationMinutes: minutes, isBillable: true, method: "manual", costRate: 40, billableRate: 100,
        rateCurrency: "EUR", snapshotCategoryId: categoryId, createdAt: now, updatedAt: now, createdBy: userId,
        ...(note ? { note } : {}),
      });
    await entry(aliceTask, tmProject, alice, 90, "Built the hero section");
    await entry(aliceTask, tmProject, admin, 30);
    await entry(careTask, retainer, admin, 120);
    await ctx.db.insert("invoices", {
      orgId: ORG, projectId: tmProject, clientId, number: 7, prefix: "INV-", status: "invoiced",
      currency: "EUR", subtotalMinor: 15000, totalMinor: 15000, issueDate: FIRST,
      createdAt: now, updatedAt: now, createdBy: admin,
    });
    const task = (await ctx.db.get(aliceTask))!;
    return {
      admin, alice, clientId, tmProject, retainer, aliceTask,
      aliceTaskIdentifier: task.identifier!, invoiceRef: "INV-007",
    };
  });
}

async function mkThread(
  t: T,
  opts: { owner: Id<"users">; tools: string[] },
): Promise<Id<"agentThreads">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      orgId: ORG, name: "A7 tester", description: "", instructions: "Be brief.",
      tools: opts.tools, runPermission: "everyone", trigger: "manual",
      createdBy: opts.owner, createdAt: now, updatedAt: now,
    });
    const componentThreadId = await createThread(ctx, components.agent, { userId: opts.owner });
    return await ctx.db.insert("agentThreads", {
      orgId: ORG, componentThreadId, agentId, userId: opts.owner, title: "New chat",
      status: "idle", lastActivityAt: now, createdAt: now,
    });
  });
}

function recordingModel(args: Parameters<typeof mockModel>[0]) {
  const model = mockModel(args);
  return model as typeof model & {
    doStreamCalls: Array<Parameters<typeof model.doStream>[0]>;
  };
}

const call = (toolName: string, input: unknown, id = "call_1") => ({
  type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input),
});
const offered = (model: ReturnType<typeof recordingModel>) =>
  (model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort();
/** What the model saw after its tool step (tool results are in this prompt). */
const secondPrompt = (model: ReturnType<typeof recordingModel>) => JSON.stringify(model.doStreamCalls[1].prompt);

beforeEach(() => {
  modelSlot.current = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

// ─── Actor variants == public queries ────────────────────────────────────────

describe("actor variants run the public queries' cores", () => {
  it("member-readable reads: same result as the public query for admin and member", async () => {
    const t = createT();
    const f = await setup(t);
    for (const [who, userId] of [["admin", f.admin], ["alice", f.alice]] as const) {
      const pub = t.withIdentity(IDENTITY[who]);
      const actor = { orgId: ORG, userId };
      expect(await t.query(internal.agentActorTools.countTasksByStatus, { actor }), who).toEqual(
        await pub.query(api.tasks.agent.countTasksByStatus, {}),
      );
      expect(await t.query(internal.agentActorTools.resolveTask, { actor, task: f.aliceTaskIdentifier })).toEqual(
        await pub.query(api.tasks.agent.resolveTask, { task: f.aliceTaskIdentifier }),
      );
      for (const projectId of [f.tmProject, f.retainer]) {
        expect(await t.query(internal.agentActorTools.getProject, { actor, id: projectId })).toEqual(
          await pub.query(api.projects.get, { id: projectId }),
        );
        expect(await t.query(internal.agentActorTools.projectOverview, { actor, projectId })).toEqual(
          await pub.query(api.timeEntries.projectOverview, { projectId }),
        );
        expect(await t.query(internal.agentActorTools.projectMonthlyBreakdown, { actor, projectId })).toEqual(
          await pub.query(api.timeEntries.projectMonthlyBreakdown, { projectId }),
        );
        expect(await t.query(internal.agentActorTools.getProjectSummary, { actor, projectId })).toEqual(
          await pub.query(api.projects.getSummary, { projectId }),
        );
      }
      expect(await t.query(internal.agentActorTools.getRetainerData, { actor, id: f.retainer })).toEqual(
        await pub.query(api.projects.getRetainerData, { id: f.retainer }),
      );
    }
  });

  it("finance summary keeps stripping money for members", async () => {
    const t = createT();
    const f = await setup(t);
    for (const projectId of [f.tmProject, f.retainer]) {
      const admin = await t.query(internal.agentActorTools.getProjectSummary, {
        actor: { orgId: ORG, userId: f.admin }, projectId,
      });
      const member = await t.query(internal.agentActorTools.getProjectSummary, {
        actor: { orgId: ORG, userId: f.alice }, projectId,
      });
      expect(admin).toHaveProperty("profitability");
      expect(member).not.toHaveProperty("profitability");
      expect(member).not.toHaveProperty("billingStatus");
      expect(member).not.toHaveProperty("overage");
      expect(member?.timeBreakdown).toEqual(admin?.timeBreakdown);
    }
  });

  it("admin-only reads: equal for the admin, refused for a member on both paths", async () => {
    const t = createT();
    const f = await setup(t);
    const adminPub = t.withIdentity(IDENTITY.admin);
    const alicePub = t.withIdentity(IDENTITY.alice);
    const admin = { orgId: ORG, userId: f.admin };
    const alice = { orgId: ORG, userId: f.alice };
    const report = { projectId: f.retainer, year: YEAR, month: MONTH_NUM };

    expect(await t.query(internal.agentActorTools.getMonthlyReport, { actor: admin, ...report })).toEqual(
      await adminPub.query(api.billingReports.getMonthlyReport, report),
    );
    expect(await t.query(internal.agentActorTools.getCloseQueue, { actor: admin })).toEqual(
      await adminPub.query(api.billingViews.getCloseQueue, {}),
    );
    expect(await t.query(internal.agentActorTools.getNavSignals, { actor: admin })).toEqual(
      await adminPub.query(api.billingViews.getNavSignals, {}),
    );
    const invoices = await t.query(internal.agentActorTools.listAllInvoices, { actor: admin, status: "invoiced" });
    expect(invoices).toHaveLength(1);
    expect(invoices).toEqual(await adminPub.query(api.invoices.listAllInvoices, { status: "invoiced" }));
    expect(await t.query(internal.agentActorTools.getInvoiceMetrics, { actor: admin })).toEqual(
      await adminPub.query(api.invoices.getInvoiceMetrics, {}),
    );
    const detail = await t.query(internal.agentActorTools.getInvoice, { actor: admin, identifier: f.invoiceRef });
    expect(detail).not.toBeNull();
    expect(detail).toEqual(await adminPub.query(api.invoices.getInvoice, { identifier: f.invoiceRef }));

    const refused = [
      t.query(internal.agentActorTools.getMonthlyReport, { actor: alice, ...report }),
      t.query(internal.agentActorTools.getCloseQueue, { actor: alice }),
      t.query(internal.agentActorTools.getNavSignals, { actor: alice }),
      t.query(internal.agentActorTools.listAllInvoices, { actor: alice }),
      t.query(internal.agentActorTools.getInvoiceMetrics, { actor: alice }),
      t.query(internal.agentActorTools.getInvoice, { actor: alice, identifier: f.invoiceRef }),
      alicePub.query(api.billingReports.getMonthlyReport, report),
      alicePub.query(api.billingViews.getCloseQueue, {}),
      alicePub.query(api.invoices.listAllInvoices, {}),
      alicePub.query(api.invoices.getInvoice, { identifier: f.invoiceRef }),
    ];
    for (const p of refused) await expect(p).rejects.toThrow(ADMIN_REQUIRED);
  });

  it("agent collectors: admin-only ones refuse members; time reports self-scope members", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = { orgId: ORG, userId: f.admin };
    const alice = { orgId: ORG, userId: f.alice };
    const period = { fromDate: FIRST, toDate: TODAY };

    const team = await t.query(internal.agentActorTools.timeByMember, { actor: admin, ...period, allMembers: true });
    expect(team.totals.minutes).toBe(240);
    // A member asking for everyone (or someone else) still gets only themselves.
    for (const widen of [{ allMembers: true }, { userIds: [f.admin] }]) {
      const own = await t.query(internal.agentActorTools.timeByMember, { actor: alice, ...period, ...widen });
      expect(own.members.map((m) => m.userId)).toEqual([f.alice]);
      expect(own.totals.minutes).toBe(90);
    }

    const months = await t.query(internal.agentActorTools.clientMonthlySummary, {
      actor: admin, clientId: f.clientId, fromMonth: MONTH, toMonth: MONTH,
    });
    expect(months.totals.minutes).toBe(240);
    const health = await t.query(internal.agentActorTools.retainerHealthForMonth, {
      actor: admin, year: YEAR, month: MONTH_NUM,
    });
    expect(health.rows.map((r) => r.projectId)).toEqual([f.retainer]);
    const snapshot = await t.query(internal.agentActorTools.orgFinanceSnapshot, { actor: admin, ...period });
    expect(snapshot.time.totalMinutes).toBe(240);
    const sheet = await t.query(internal.agentActorTools.collectTimesheetData, {
      actor: admin, clientId: f.clientId, periodStart: FIRST, periodEnd: TODAY,
    });
    expect(sheet.rows.map((r) => r.title).sort()).toEqual(["Homepage hero", "Monthly care"]);

    const refused = [
      t.query(internal.agentActorTools.clientMonthlySummary, { actor: alice, clientId: f.clientId, fromMonth: MONTH, toMonth: MONTH }),
      t.query(internal.agentActorTools.retainerHealthForMonth, { actor: alice, year: YEAR, month: MONTH_NUM }),
      t.query(internal.agentActorTools.orgFinanceSnapshot, { actor: alice, ...period }),
      t.query(internal.agentActorTools.collectTimesheetData, { actor: alice, clientId: f.clientId, periodStart: FIRST, periodEnd: TODAY }),
    ];
    for (const p of refused) await expect(p).rejects.toThrow(ADMIN_REQUIRED);
  });

  it("a demotion mid-run refuses the next admin-only read (role re-derived per call)", async () => {
    const t = createT();
    const f = await setup(t);
    const actor = { orgId: ORG, userId: f.admin };
    await t.query(internal.agentActorTools.getInvoiceMetrics, { actor });
    await t.mutation(internal.orgMembers.upsertMembership, { orgId: ORG, clerkUserId: "clerk_admin", role: "org:member" });
    await expect(t.query(internal.agentActorTools.getInvoiceMetrics, { actor })).rejects.toThrow(ADMIN_REQUIRED);
  });
});

// ─── Interactive role: orgMembers AND the JWT (fail closed) ──────────────────

describe("interactive role fails closed (orgMembers AND JWT)", () => {
  /** The admin's own session, but the JWT already says member (demoted; webhook lagging). */
  const STALE_MEMBER_JWT = { subject: "clerk_admin", orgId: ORG, orgRole: "org:member" };

  it("JWT member + orgMembers admin: admin cores refuse inside the query", async () => {
    const t = createT();
    const f = await setup(t);
    const actor = { orgId: ORG, userId: f.admin };
    const session = t.withIdentity(STALE_MEMBER_JWT);
    await expect(session.query(internal.agentActorTools.getInvoiceMetrics, { actor })).rejects.toThrow(ADMIN_REQUIRED);
    await expect(
      session.query(internal.agentActorTools.orgFinanceSnapshot, { actor, fromDate: FIRST, toDate: TODAY }),
    ).rejects.toThrow(ADMIN_REQUIRED);
    // Money is stripped exactly as for a member.
    const summary = await session.query(internal.agentActorTools.getProjectSummary, { actor, projectId: f.tmProject });
    expect(summary).not.toHaveProperty("profitability");
    // The matching JWT (admin + admin) still reads.
    expect(
      await t.withIdentity(IDENTITY.admin).query(internal.agentActorTools.getInvoiceMetrics, { actor }),
    ).toEqual(await t.query(internal.agentActorTools.getInvoiceMetrics, { actor }));
  });

  it("an interactive run started on the stale session is a member run", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    const threadId = await mkThread(t, { owner: f.admin, tools: ["listClients", "getInvoiceMetrics"] });
    const { runId } = await t.withIdentity(STALE_MEMBER_JWT).action(api.agentRunner.startRun, { threadId, message: "hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ via: "user", actorIsAdmin: false, status: "succeeded" });
    expect(offered(model)).toEqual(["listClients"]);
  });

  it("the JWT org must be the actor's org", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(
      t.withIdentity({ ...IDENTITY.admin, orgId: "org_elsewhere" })
        .query(internal.agentActorTools.listClients, { actor: { orgId: ORG, userId: f.admin } }),
    ).rejects.toThrow(/different organization/);
  });

  it("no identity, or another user's identity: orgMembers alone decides (background unchanged)", async () => {
    const t = createT();
    const f = await setup(t);
    const actor = { orgId: ORG, userId: f.admin };
    const background = await t.query(internal.agentActorTools.getInvoiceMetrics, { actor });
    // Alice's member session does not narrow the admin actor's role.
    expect(
      await t.withIdentity(IDENTITY.alice).query(internal.agentActorTools.getInvoiceMetrics, { actor }),
    ).toEqual(background);
    // …and a background run as the admin still gets admin tools.
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    const threadId = await mkThread(t, { owner: f.admin, tools: ["listClients", "getInvoiceMetrics"] });
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: f.admin, message: "hi" });
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ via: "background", actorIsAdmin: true, status: "succeeded" });
    expect(offered(model)).toEqual(["getInvoiceMetrics", "listClients"]);
  });
});

// ─── Background / job / answer runs get the same tools ───────────────────────

describe("non-interactive runs use the formerly ctx.auth-only tools", () => {
  it("a job run calls finance tools as the designated admin", async () => {
    const t = createT();
    const f = await setup(t);
    const unregister = registerAgentJobForTesting({
      name: "test_finance", tier: "agent_run", systemAgentKey: "assistant", visibility: "admins",
      instructions: "Report the numbers.", tools: ["collectOrgFinanceSnapshot", "getProjectFinanceSummary"],
    });
    try {
      const model = recordingModel({
        contentSteps: [
          [
            call("collectOrgFinanceSnapshot", { fromDate: FIRST, toDate: TODAY }, "call_1"),
            call("getProjectFinanceSummary", { projectId: f.tmProject }, "call_2"),
          ],
          [{ type: "text", text: "Done." }],
        ],
      });
      modelSlot.current = model;
      const res = await t.action(internal.agentJobs.startAgentJob, {
        job: "test_finance", orgId: ORG, anchor: { type: "emailThread", id: "et_a7" }, input: "How are we doing?",
      });
      if (res.status !== "started") throw new Error(`job did not start: ${JSON.stringify(res)}`);
      await t.finishAllScheduledFunctions(() => {});

      const run = await t.run((ctx) => ctx.db.get(res.runId));
      expect(run).toMatchObject({ userId: f.admin, via: "background", actorIsAdmin: true, status: "succeeded" });
      expect(run?.droppedTools).toBeUndefined();
      expect(offered(model)).toEqual(["collectOrgFinanceSnapshot", "getProjectFinanceSummary"]);
      const prompt = secondPrompt(model);
      expect(prompt).toContain("laborCostByCurrency");
      expect(prompt).toContain("profitability");
      expect(prompt).not.toContain("Admin access required");
    } finally {
      unregister();
    }
  });

  it("a member's background run: money stripped, admin-only tools absent, nothing dropped", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({
      contentSteps: [
        [call("getProjectFinanceSummary", { projectId: f.tmProject })],
        [{ type: "text", text: "Hours only." }],
      ],
    });
    modelSlot.current = model;
    const threadId = await mkThread(t, {
      owner: f.alice,
      tools: ["getProjectFinanceSummary", "collectOrgFinanceSnapshot", "collectTimesheetData", "countTasksByStatus"],
    });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.alice, message: "Project numbers?",
    });
    await t.finishAllScheduledFunctions(() => {});

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ via: "background", actorIsAdmin: false, status: "succeeded" });
    expect(run?.droppedTools).toBeUndefined();
    expect(offered(model)).toEqual(["countTasksByStatus", "getProjectFinanceSummary"]);
    const prompt = secondPrompt(model);
    expect(prompt).toContain("timeBreakdown");
    expect(prompt).not.toContain("profitability");
  });

  it("createSheet persists its artifact from a background run", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = mockModel({
      contentSteps: [
        [call("createSheet", {
          title: "Hours by client",
          columns: [{ key: "client", label: "Client", kind: "text" }, { key: "minutes", label: "Time", kind: "minutes" }],
          rows: [{ client: "Arlow", minutes: 240 }],
        })],
        [{ type: "text", text: "Sheet ready." }],
      ],
    });
    const threadId = await mkThread(t, { owner: f.alice, tools: ["createSheet"] });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.alice, message: "Make a sheet",
    });
    await t.finishAllScheduledFunctions(() => {});

    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("succeeded");
    const artifacts = await t.run((ctx) => ctx.db.query("agentArtifacts").collect());
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ orgId: ORG, threadId, userId: f.alice, kind: "sheet_csv", name: "Hours by client" });
  });

  it("the artifact write refuses an actor without write access to the thread", async () => {
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { owner: f.admin, tools: [] });
    const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
    await expect(
      t.mutation(internal.agentActorTools.createArtifact, {
        actor: { orgId: ORG, userId: f.alice }, componentThreadId, kind: "sheet_csv", name: "x", sheetJson: "{}",
      }),
    ).rejects.toThrow(/Thread not found/);
  });

  it("collectTimesheetData runs in an admin background run: summarizer key via the actor, artifact persisted", async () => {
    // No key anywhere → the summarizer degrades (it used to need ctx.auth to load the key).
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({
      contentSteps: [
        [call("collectTimesheetData", { clientId: f.clientId, startDate: FIRST, endDate: TODAY })],
        [{ type: "text", text: "Timesheet attached." }],
      ],
    });
    modelSlot.current = model;
    const threadId = await mkThread(t, { owner: f.admin, tools: ["collectTimesheetData"] });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.admin, message: "Timesheet for Arlow",
    });
    await t.finishAllScheduledFunctions(() => {});

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "succeeded", via: "background" });
    expect(run?.droppedTools).toBeUndefined();
    const prompt = secondPrompt(model);
    expect(prompt).toContain('"aiUnavailable":true');
    expect(prompt).toContain('"taskCount":2');
    const artifacts = await t.run((ctx) => ctx.db.query("agentArtifacts").collect());
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ threadId, userId: f.admin, kind: "timesheet_csv" });
  });

  it("proposeArchiveTask records through the actor createProposals path", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = mockModel({
      contentSteps: [
        [call("proposeArchiveTask", { task: f.aliceTaskIdentifier })],
        [{ type: "text", text: "Proposed." }],
      ],
    });
    const threadId = await mkThread(t, { owner: f.admin, tools: ["proposeArchiveTask"] });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.admin, message: "Archive the hero task",
    });
    await t.finishAllScheduledFunctions(() => {});

    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("succeeded");
    const proposals = await t.run((ctx) =>
      ctx.db.query("agentProposals").withIndex("by_threadId_status", (q) => q.eq("threadId", threadId)).collect(),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      userId: f.admin, status: "pending",
      payload: { kind: "archiveTask", taskId: f.aliceTask, taskTitle: "Homepage hero" },
    });
  });

  it("connector tools stay interactive-only: dropped and recorded in a background run", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    const threadId = await mkThread(t, { owner: f.alice, tools: ["echo", "listClients"] });
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: f.alice, message: "hi" });
    await t.finishAllScheduledFunctions(() => {});
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ via: "background", status: "succeeded", droppedTools: ["echo"] });
    expect(offered(model)).toEqual(["listClients"]);

    // The same agent in an interactive run keeps it.
    const interactive = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = interactive;
    const { runId: userRun } = await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, { threadId, message: "again" });
    await t.finishAllScheduledFunctions(() => {});
    expect((await t.run((ctx) => ctx.db.get(userRun)))?.droppedTools).toBeUndefined();
    expect(offered(interactive)).toEqual(["echo", "listClients"]);
  });

  it("a question-answer run in an ordinary chat keeps createSheet (no skipped-tools notice)", async () => {
    vi.useFakeTimers();
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { owner: f.alice, tools: ["createSheet", "countTasksByStatus"] });
    const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
    const { questionId } = await t.mutation(internal.agentQuestions.ask, {
      actor: { orgId: ORG, userId: f.alice }, componentThreadId,
      header: "Format", question: "Sheet or summary?",
      options: [{ label: "Sheet", recommended: true }, { label: "Summary" }],
      multiSelect: false, allowOther: true,
    });
    const model = recordingModel({
      contentSteps: [
        [call("createSheet", {
          title: "Open tasks",
          columns: [{ key: "task", label: "Task", kind: "text" }],
          rows: [{ task: f.aliceTaskIdentifier }],
        })],
        [{ type: "text", text: "Here is the sheet." }],
      ],
    });
    modelSlot.current = model;
    await t.withIdentity(IDENTITY.alice).mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const runs = await t.run((ctx) =>
      ctx.db.query("agentRuns").withIndex("by_threadId", (q) => q.eq("threadId", threadId)).collect(),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "succeeded", questionId, via: "background" });
    expect(runs[0].droppedTools).toBeUndefined();
    expect(offered(model)).toEqual(["countTasksByStatus", "createSheet"]);
    const artifacts = await t.run((ctx) => ctx.db.query("agentArtifacts").collect());
    expect(artifacts.map((a) => a.kind)).toEqual(["sheet_csv"]);
  });
});

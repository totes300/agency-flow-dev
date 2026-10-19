// @vitest-environment edge-runtime
//
// Agent actor layer + background runs (docs/prd-email-triage-implementation-
// plan.md §3 P1, phase A1):
//   - loadAuthContextForActor: DB-derived AuthContext, fails closed
//   - actor-path internal reads == public queries for the same user (one
//     code path), incl. member scope; revocation mid-run fails closed
//   - agentBackground.start: rejected for non-member / other-org thread /
//     someone else's thread; end-to-end run with a mocked model, no identity

import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { DEFAULT_STATUS_SEED } from "../tasks/model";
import { createTask } from "../tasks/write";

// The runner resolves its model via resolveModel (BYOK → env). Swap in the
// agent component's mock model so a full run executes without a provider.
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

const ORG = "org_actor";
const OTHER = "org_actor_other";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

const IDENTITY = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
} as const;

type Fixture = {
  admin: Id<"users">;
  alice: Id<"users">;
  bob: Id<"users">;
  outsider: Id<"users">;
  clientName: string;
  /** Assigned to Alice. */
  aliceTask: Id<"tasks">;
  /** Assigned to the admin only — invisible to Alice. */
  adminTask: Id<"tasks">;
};

async function setup(t: T): Promise<Fixture> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const alice = await mkUser("Alice", "clerk_alice");
    const bob = await mkUser("Bob", "clerk_bob");
    const outsider = await mkUser("Outsider", "clerk_outsider");
    const roles = [
      [admin, "clerk_admin", "admin", ORG],
      [alice, "clerk_alice", "member", ORG],
      [bob, "clerk_bob", "member", ORG],
      [outsider, "clerk_outsider", "admin", OTHER],
    ] as const;
    for (const [userId, clerkUserId, role, orgId] of roles) {
      await ctx.db.insert("orgMembers", { orgId, clerkUserId, userId, role, joinedAt: now });
    }
    for (const [orgId, createdBy] of [[ORG, admin], [OTHER, outsider]] as const) {
      await ctx.db.insert("orgSettings", {
        orgId, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        createdAt: now, updatedAt: now, createdBy,
      });
      for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
        await ctx.db.insert("statuses", {
          orgId, name: s.name, color: s.color, category: s.category, position: `a${i}`,
          isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy,
        });
      }
    }
    const clientId = await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "EUR", createdAt: now, updatedAt: now, createdBy: admin,
    });
    await ctx.db.insert("clients", {
      orgId: OTHER, name: "Elsewhere", currency: "EUR", createdAt: now, updatedAt: now, createdBy: outsider,
    });
    const projectId = await ctx.db.insert("projects", {
      orgId: ORG, clientId, name: "Arlow site", code: "ARLO", billingType: "retainer",
      monthlyFee: 5000, includedMinutesPerMonth: 600, createdAt: now, updatedAt: now, createdBy: admin,
    });
    await ctx.db.insert("workCategories", {
      orgId: ORG, name: "Design", color: "blue", sortOrder: 0, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const adminAuth: AuthContext = {
      userId: admin, orgId: ORG, orgRole: "admin", isAdmin: true, user: (await ctx.db.get(admin))!,
    };
    const aliceTask = await createTask(ctx, adminAuth, { title: "Alice task", projectId, assigneeIds: [alice] }, { notify: false });
    const adminTask = await createTask(ctx, adminAuth, { title: "Admin task", projectId, assigneeIds: [admin] }, { notify: false });
    return { admin, alice, bob, outsider, clientName: "Arlow", aliceTask, adminTask };
  });
}

/** An agent + app thread backed by a real component thread. */
async function mkThread(
  t: T,
  opts: { orgId: string; owner: Id<"users">; tools: string[]; runPermission?: "admins" | "everyone" },
): Promise<Id<"agentThreads">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      orgId: opts.orgId, name: "Background tester", description: "", instructions: "Be brief.",
      tools: opts.tools, runPermission: opts.runPermission ?? "everyone", trigger: "manual",
      createdBy: opts.owner, createdAt: now, updatedAt: now,
    });
    const componentThreadId = await createThread(ctx, components.agent, { userId: opts.owner });
    return await ctx.db.insert("agentThreads", {
      orgId: opts.orgId, componentThreadId, agentId, userId: opts.owner, title: "New chat",
      status: "idle", lastActivityAt: now, createdAt: now,
    });
  });
}

/** The component's mock model, typed with the call log it records. */
function recordingModel(args: Parameters<typeof mockModel>[0]) {
  const model = mockModel(args);
  return model as typeof model & {
    doStreamCalls: Array<Parameters<typeof model.doStream>[0]>;
  };
}

beforeEach(() => {
  modelSlot.current = null;
});

// ─── loadAuthContextForActor ─────────────────────────────────────────────────

describe("loadAuthContextForActor", () => {
  it("derives role flags from orgMembers for a current member", async () => {
    const t = createT();
    const f = await setup(t);
    const admin = await t.run((ctx) => loadAuthContextForActor(ctx, { orgId: ORG, userId: f.admin }));
    expect(admin).toMatchObject({ userId: f.admin, orgId: ORG, orgRole: "admin", isAdmin: true });
    expect(admin.user._id).toBe(f.admin);
    const alice = await t.run((ctx) => loadAuthContextForActor(ctx, { orgId: ORG, userId: f.alice }));
    expect(alice).toMatchObject({ userId: f.alice, orgId: ORG, orgRole: "member", isAdmin: false });
  });

  it("throws for a removed member", async () => {
    const t = createT();
    const f = await setup(t);
    await t.mutation(internal.orgMembers.deleteMembership, { orgId: ORG, clerkUserId: "clerk_alice" });
    await expect(
      t.run((ctx) => loadAuthContextForActor(ctx, { orgId: ORG, userId: f.alice })),
    ).rejects.toThrow(/not a member/);
  });

  it("throws for an org the user is not a member of", async () => {
    const t = createT();
    const f = await setup(t);
    await expect(
      t.run((ctx) => loadAuthContextForActor(ctx, { orgId: OTHER, userId: f.alice })),
    ).rejects.toThrow(/not a member/);
  });

  it("throws for a deleted user even with a membership row", async () => {
    const t = createT();
    const f = await setup(t);
    await t.mutation(internal.users.deleteFromClerk, { clerkUserId: "clerk_alice" });
    await expect(
      t.run((ctx) => loadAuthContextForActor(ctx, { orgId: ORG, userId: f.alice })),
    ).rejects.toThrow(/not found/);
  });
});

// ─── Actor-path reads == public queries ──────────────────────────────────────

describe("actor-path internal reads run the public queries' code", () => {
  it("return the same as the public query for the same user (admin and member)", async () => {
    const t = createT();
    const f = await setup(t);
    for (const [who, userId] of [["admin", f.admin], ["alice", f.alice]] as const) {
      const pub = t.withIdentity(IDENTITY[who]);
      const actor = { orgId: ORG, userId };
      expect(await t.query(internal.agentActorTools.listClients, { actor })).toEqual(
        await pub.query(api.clients.list, {}),
      );
      expect(await t.query(internal.agentActorTools.listProjects, { actor, includeArchived: true })).toEqual(
        await pub.query(api.projects.list, { includeArchived: true }),
      );
      expect(await t.query(internal.agentActorTools.listOrgMembers, { actor })).toEqual(
        await pub.query(api.orgMembers.listOrgMembers, {}),
      );
      expect(await t.query(internal.agentActorTools.listWorkCategories, { actor })).toEqual(
        await pub.query(api.workCategories.list, {}),
      );
      expect(await t.query(internal.agentActorTools.getWorkspaceRefs, { actor })).toEqual(
        await pub.query(api.workspaceRefs.get, {}),
      );
      expect(await t.query(internal.agentActorTools.findTasks, { actor })).toEqual(
        await pub.query(api.tasks.agent.findTasks, {}),
      );
      for (const task of [f.aliceTask, f.adminTask]) {
        expect(await t.query(internal.agentActorTools.getTaskDetail, { actor, task })).toEqual(
          await pub.query(api.tasks.agent.getTaskDetail, { task }),
        );
      }
    }
  });

  it("respect member scope: a member never sees tasks the public query hides", async () => {
    const t = createT();
    const f = await setup(t);
    const member = { orgId: ORG, userId: f.alice };
    const found = await t.query(internal.agentActorTools.findTasks, { actor: member });
    expect(found.tasks.map((r) => r.id)).toEqual([f.aliceTask]);
    expect(await t.query(internal.agentActorTools.getTaskDetail, { actor: member, task: f.adminTask })).toBeNull();
    // The admin actor sees both — scope is the role's, not the path's.
    const admin = await t.query(internal.agentActorTools.findTasks, { actor: { orgId: ORG, userId: f.admin } });
    expect(admin.tasks.map((r) => r.id).sort()).toEqual([f.aliceTask, f.adminTask].sort());
  });

  it("role comes from orgMembers per call: a demotion mid-run narrows the next read", async () => {
    const t = createT();
    const f = await setup(t);
    const actor = { orgId: ORG, userId: f.admin };
    expect((await t.query(internal.agentActorTools.findTasks, { actor })).tasks).toHaveLength(2);
    await t.mutation(internal.orgMembers.upsertMembership, { orgId: ORG, clerkUserId: "clerk_admin", role: "org:member" });
    expect((await t.query(internal.agentActorTools.findTasks, { actor })).tasks.map((r) => r.id)).toEqual([f.adminTask]);
  });

  it("fail closed for a removed member, an outsider, and the BYOK/connector variants", async () => {
    const t = createT();
    const f = await setup(t);
    const outsider = { orgId: ORG, userId: f.outsider };
    await expect(t.query(internal.agentActorTools.listClients, { actor: outsider })).rejects.toThrow(/not a member/);
    await expect(t.query(internal.aiIntegration.loadDecryptedKeyForActor, { actor: outsider })).rejects.toThrow(/not a member/);
    await expect(
      t.query(internal.connectors.resolveForActor, { actor: outsider, type: "echo" }),
    ).rejects.toThrow(/not a member/);

    const alice = { orgId: ORG, userId: f.alice };
    expect(await t.query(internal.aiIntegration.loadDecryptedKeyForActor, { actor: alice })).toBeNull();
    expect(await t.query(internal.connectors.resolveForActor, { actor: alice, type: "echo" })).toMatchObject({
      ok: false,
    });
    await t.mutation(internal.orgMembers.deleteMembership, { orgId: ORG, clerkUserId: "clerk_alice" });
    await expect(t.query(internal.agentActorTools.findTasks, { actor: alice })).rejects.toThrow(/not a member/);
  });

  it("createProposals records cards only in a thread the actor owns", async () => {
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: [] });
    const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
    const proposals = [{ kind: "createTask" as const, title: "From the actor path" }];

    const [id] = await t.mutation(internal.agentActorTools.createProposals, {
      actor: { orgId: ORG, userId: f.alice }, componentThreadId, proposals,
    });
    const row = await t.run((ctx) => ctx.db.get(id as Id<"agentProposals">));
    expect(row).toMatchObject({ orgId: ORG, threadId, userId: f.alice, status: "pending" });

    await expect(
      t.mutation(internal.agentActorTools.createProposals, {
        actor: { orgId: ORG, userId: f.bob }, componentThreadId, proposals,
      }),
    ).rejects.toThrow(/Thread not found/);
  });
});

// ─── agentBackground.start ───────────────────────────────────────────────────

describe("agentBackground.start", () => {
  it("rejects a non-member acting user", async () => {
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: ["listClients"] });
    await t.mutation(internal.orgMembers.deleteMembership, { orgId: ORG, clerkUserId: "clerk_alice" });
    await expect(
      t.action(internal.agentBackground.start, { threadId, actingUserId: f.alice, message: "hi" }),
    ).rejects.toThrow(/not a member/);
  });

  it("rejects a thread in another org", async () => {
    const t = createT();
    const f = await setup(t);
    const foreign = await mkThread(t, { orgId: OTHER, owner: f.outsider, tools: ["listClients"] });
    await expect(
      t.action(internal.agentBackground.start, { threadId: foreign, actingUserId: f.alice, message: "hi" }),
    ).rejects.toThrow(/not a member/);
  });

  it("rejects a thread owned by someone else (A1: owner must be the actor)", async () => {
    const t = createT();
    const f = await setup(t);
    const aliceThread = await mkThread(t, { orgId: ORG, owner: f.alice, tools: ["listClients"] });
    await expect(
      t.action(internal.agentBackground.start, { threadId: aliceThread, actingUserId: f.admin, message: "hi" }),
    ).rejects.toThrow(/Thread not found/);
    // Nothing was recorded: no run row, thread untouched.
    const runs = await t.run((ctx) => ctx.db.query("agentRuns").collect());
    expect(runs).toHaveLength(0);
  });

  it("enforces the agent's run permission against the DB role", async () => {
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: [], runPermission: "admins" });
    await expect(
      t.action(internal.agentBackground.start, { threadId, actingUserId: f.alice, message: "hi" }),
    ).rejects.toThrow(/permission/);
  });

  it("runs end-to-end with no identity: actor-path tool executes, every tool offered (A7)", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({
      contentSteps: [
        [{ type: "tool-call", toolCallId: "call_1", toolName: "listClients", input: "{}" }],
        [{ type: "text", text: "There is one client." }],
      ],
    });
    modelSlot.current = model;
    const threadId = await mkThread(t, {
      orgId: ORG, owner: f.alice, tools: ["listClients", "countTasksByStatus", "collectTimesheetData"],
    });

    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.alice, message: "Which clients do we have?",
    });
    await t.finishAllScheduledFunctions(() => {});

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
      orgId: ORG, userId: f.alice, via: "background", actorIsAdmin: false, status: "succeeded",
    });
    // Every tool is on the actor path (A7): nothing is dropped; the
    // admin-only timesheet tool is simply absent for a member (not dropped).
    expect(run?.droppedTools).toBeUndefined();
    const thread = await t.run((ctx) => ctx.db.get(threadId));
    expect(thread?.status).toBe("idle");

    // The model was offered the same tools an interactive member run gets,
    // and listClients really ran as Alice without ctx.auth: its result
    // reached the second model call.
    expect(model.doStreamCalls).toHaveLength(2);
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual(
      ["countTasksByStatus", "listClients"],
    );
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(f.clientName);
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).not.toContain("Elsewhere");
  });

  it("proposeCreateTasks in a background run records the proposal for the thread", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = mockModel({
      contentSteps: [
        [{
          type: "tool-call", toolCallId: "call_1", toolName: "proposeCreateTasks",
          input: JSON.stringify({ tasks: [{ title: "Reply to the client" }] }),
        }],
        [{ type: "text", text: "Proposed." }],
      ],
    });
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: ["proposeCreateTasks"] });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.alice, message: "Make a task",
    });
    await t.finishAllScheduledFunctions(() => {});

    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("succeeded");
    const proposals = await t.run((ctx) =>
      ctx.db.query("agentProposals").withIndex("by_threadId_status", (q) => q.eq("threadId", threadId)).collect(),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      orgId: ORG, userId: f.alice, status: "pending",
      payload: { kind: "createTask", title: "Reply to the client" },
    });
  });

  it("settles as failed (in-thread error) when no model is available", async () => {
    const t = createT();
    const f = await setup(t);
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: ["listClients"] });
    const { runId } = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: f.alice, message: "hi",
    });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "failed", via: "background", error: "No AI key is configured for this organization." });
  });
});

// ─── Interactive path regression ─────────────────────────────────────────────

describe("startRun (interactive) on the shared loop", () => {
  it("records via=user; formerly ctx.auth-only tools run on the actor path", async () => {
    const t = createT();
    const f = await setup(t);
    const model = recordingModel({
      contentSteps: [
        [{ type: "tool-call", toolCallId: "call_1", toolName: "countTasksByStatus", input: "{}" }],
        [{ type: "text", text: "Counted." }],
      ],
    });
    modelSlot.current = model;
    const threadId = await mkThread(t, {
      orgId: ORG, owner: f.alice, tools: ["listClients", "countTasksByStatus"],
    });
    const { runId } = await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, {
      threadId, message: "How many tasks?",
    });
    await t.finishAllScheduledFunctions(() => {});

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ via: "user", actorIsAdmin: false, status: "succeeded", userId: f.alice });
    expect(run?.droppedTools).toBeUndefined();
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual(
      ["countTasksByStatus", "listClients"],
    );
    // countTasksByStatus ran as the actor (member scope: Alice's own tasks).
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("assigned to you");
  });

  it("rejects with a clear error and records nothing when the membership row hasn't synced", async () => {
    const t = createT();
    const f = await setup(t);
    modelSlot.current = recordingModel({ content: [{ type: "text", text: "unused" }] });
    const threadId = await mkThread(t, { orgId: ORG, owner: f.alice, tools: ["listClients"] });
    // Users row present, orgMembers row missing (webhook lag / preview deploy).
    await t.mutation(internal.orgMembers.deleteMembership, { orgId: ORG, clerkUserId: "clerk_alice" });

    await expect(
      t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, { threadId, message: "hi" }),
    ).rejects.toThrow(/membership hasn't synced yet/);

    expect(await t.run((ctx) => ctx.db.query("agentRuns").collect())).toHaveLength(0);
    const thread = (await t.run((ctx) => ctx.db.get(threadId)))!;
    expect(thread).toMatchObject({ status: "idle", title: "New chat" });
    const messages = await t.run((ctx) =>
      ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
        threadId: thread.componentThreadId,
        order: "asc",
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    );
    expect(messages.page).toHaveLength(0);
  });

  it("takes the role from orgMembers, not the JWT: JWT admin + DB member = member run", async () => {
    const t = createT();
    const f = await setup(t);
    // The JWT claims admin, but the synced membership says member.
    const staleAdmin = { subject: "clerk_alice", orgId: ORG, orgRole: "org:admin" };

    const adminsOnly = await mkThread(t, {
      orgId: ORG, owner: f.alice, tools: ["listClients"], runPermission: "admins",
    });
    await expect(
      t.withIdentity(staleAdmin).action(api.agentRunner.startRun, { threadId: adminsOnly, message: "hi" }),
    ).rejects.toThrow(/permission/);

    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    const threadId = await mkThread(t, {
      orgId: ORG, owner: f.alice, tools: ["listClients", "collectTeamTime", "collectTimesheetData"],
    });
    const { runId } = await t.withIdentity(staleAdmin).action(api.agentRunner.startRun, {
      threadId, message: "hi",
    });
    await t.finishAllScheduledFunctions(() => {});

    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      via: "user", actorIsAdmin: false, status: "succeeded",
    });
    // Admin-scoped tools are filtered out exactly as for any member.
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["listClients"]);
  });
});

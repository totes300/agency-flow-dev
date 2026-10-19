// @vitest-environment edge-runtime
//
// Shared admin threads, anchors, queued background runs and proposal
// revisions (docs/prd-email-triage-implementation-plan.md §3 P3, phase A2a;
// PRD §4.2, §5.5, I10, I11):
//   - one access policy (threadAccess) across read / send / stop / decide,
//     for private and admins threads × owner / other admin / member
//   - two admins in one admins thread: a stale revision is refused, the
//     current one approves as the deciding admin (activity log)
//   - background starts on a busy thread queue, run exactly once after the
//     active run, and re-check the actor when they start
//   - ensureAnchoredThread is idempotent

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { DEFAULT_STATUS_SEED } from "../tasks/model";

// Same model swap as agentActor.test.ts: resolveModel → the component's mock.
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

// Make the component's saveMessage throw for one prompt, to simulate a queued
// run whose OPEN fails after its checks passed.
const saveFailure = vi.hoisted(() => ({ prompt: null as string | null }));
vi.mock("@convex-dev/agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@convex-dev/agent")>();
  return {
    ...actual,
    saveMessage: (async (...args: Parameters<typeof actual.saveMessage>) => {
      if (saveFailure.prompt !== null && args[2].prompt === saveFailure.prompt) {
        throw new Error("simulated open failure");
      }
      return await actual.saveMessage(...args);
    }) as typeof actual.saveMessage,
  };
});

const modules = (
  import.meta as ImportMeta & {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
).glob("../**/*.ts");

const ORG = "org_shared";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

type Who = "admin" | "admin2" | "alice" | "bob";
const IDENTITY: Record<Who, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" },
  admin2: { subject: "clerk_admin2", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_alice", orgId: ORG, orgRole: "org:member" },
  bob: { subject: "clerk_bob", orgId: ORG, orgRole: "org:member" },
};
type Users = Record<Who, Id<"users">>;

async function setup(t: T): Promise<Users> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const users = {} as Users;
    const roles: [Who, "admin" | "member"][] = [
      ["admin", "admin"], ["admin2", "admin"], ["alice", "member"], ["bob", "member"],
    ];
    for (const [who, role] of roles) {
      const externalId = IDENTITY[who].subject;
      users[who] = await ctx.db.insert("users", {
        name: who, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now,
      });
      await ctx.db.insert("orgMembers", {
        orgId: ORG, clerkUserId: externalId, userId: users[who], role, joinedAt: now,
      });
    }
    await ctx.db.insert("orgSettings", {
      orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
      createdAt: now, updatedAt: now, createdBy: users.admin,
    });
    for (const [i, s] of DEFAULT_STATUS_SEED.entries()) {
      await ctx.db.insert("statuses", {
        orgId: ORG, name: s.name, color: s.color, category: s.category, position: `a${i}`,
        isDefault: s.isDefault, createdAt: now, updatedAt: now, createdBy: users.admin,
      });
    }
    return users;
  });
}

async function mkAgent(t: T, createdBy: Id<"users">, runPermission: "admins" | "everyone" = "everyone") {
  return await t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("agents", {
      orgId: ORG, name: "Shared tester", description: "", instructions: "Be brief.",
      tools: [], runPermission, trigger: "manual", createdBy, createdAt: now, updatedAt: now,
    });
  });
}

async function mkThread(
  t: T,
  opts: { owner: Id<"users">; visibility?: "private" | "admins" },
): Promise<Id<"agentThreads">> {
  const agentId = await mkAgent(t, opts.owner);
  return await t.run(async (ctx) => {
    const now = Date.now();
    const componentThreadId = await createThread(ctx, components.agent, { userId: opts.owner });
    return await ctx.db.insert("agentThreads", {
      orgId: ORG, componentThreadId, agentId, userId: opts.owner, title: "New chat",
      status: "idle", lastActivityAt: now, createdAt: now,
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    });
  });
}

/** Simulate an in-flight run on the thread (row + thread status). */
async function markRunning(t: T, threadId: Id<"agentThreads">, userId: Id<"users">) {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    const runId = await ctx.db.insert("agentRuns", {
      orgId: ORG, threadId, agentId: thread.agentId, userId, via: "user",
      status: "running", startedAt: Date.now(),
    });
    await ctx.db.patch(threadId, { status: "running" });
    return runId;
  });
}

async function mkProposal(t: T, threadId: Id<"agentThreads">, title = "Draft task") {
  return await t.run(async (ctx) => {
    const thread = (await ctx.db.get(threadId))!;
    return await ctx.db.insert("agentProposals", {
      orgId: ORG, threadId, userId: thread.userId, payload: { kind: "createTask", title },
      status: "pending", revision: 1, createdAt: Date.now(),
    });
  });
}

async function componentMessages(t: T, threadId: Id<"agentThreads">) {
  const thread = (await t.run((ctx) => ctx.db.get(threadId)))!;
  const res = await t.run((ctx) =>
    ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: thread.componentThreadId, order: "asc",
      paginationOpts: { cursor: null, numItems: 50 },
    }),
  );
  return res.page;
}

beforeEach(() => {
  modelSlot.current = null;
  saveFailure.prompt = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── Access matrix ───────────────────────────────────────────────────────────

const MATRIX: { visibility: "private" | "admins"; owner: Who; who: Who; read: boolean; write: boolean }[] = [
  // private: the owner writes; any admin reads (audit); members neither.
  { visibility: "private", owner: "alice", who: "alice", read: true, write: true },
  { visibility: "private", owner: "alice", who: "admin", read: true, write: false },
  { visibility: "private", owner: "alice", who: "bob", read: false, write: false },
  // admins: every admin reads + writes; members neither.
  { visibility: "admins", owner: "admin", who: "admin", read: true, write: true },
  { visibility: "admins", owner: "admin", who: "admin2", read: true, write: true },
  { visibility: "admins", owner: "admin", who: "alice", read: false, write: false },
];

describe("thread access policy", () => {
  it.each(MATRIX)(
    "$visibility thread owned by $owner — $who: read=$read write=$write",
    async ({ visibility, owner, who, read, write }) => {
      const t = createT();
      const u = await setup(t);
      const threadId = await mkThread(t, { owner: u[owner], visibility });
      const as = t.withIdentity(IDENTITY[who]);

      // read: get / listRuns / listMessages
      if (read) {
        const thread = await as.query(api.agentThreads.get, { threadId });
        expect(thread.viewerCanWrite).toBe(write);
        expect(thread.visibility).toBe(visibility);
        await as.query(api.agentThreads.listRuns, { threadId });
        await as.query(api.agentThreads.listMessages, {
          threadId, paginationOpts: { cursor: null, numItems: 10 },
        });
      } else {
        await expect(as.query(api.agentThreads.get, { threadId })).rejects.toThrow(/Thread not found/);
        await expect(as.query(api.agentThreads.listRuns, { threadId })).rejects.toThrow(/Thread not found/);
        await expect(
          as.query(api.agentThreads.listMessages, { threadId, paginationOpts: { cursor: null, numItems: 10 } }),
        ).rejects.toThrow(/Thread not found/);
      }

      // proposal cards are visible exactly to readers
      const cardId = await mkProposal(t, threadId, "Visible?");
      const cards = await as.query(api.agentProposals.listForCards, { proposalIds: [cardId] });
      expect(cards.map((c) => c._id)).toEqual(read ? [cardId] : []);

      // send
      modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
      const send = as.action(api.agentRunner.startRun, { threadId, message: `hi from ${who}` });
      if (write) {
        const { runId } = await send;
        expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: "succeeded", userId: u[who] });
      } else {
        await expect(send).rejects.toThrow(/Thread not found/);
      }

      // stop
      const runId = await markRunning(t, threadId, u[owner]);
      const stop = as.mutation(api.agentRunner.stopRun, { runId });
      if (write) {
        await stop;
        expect((await t.run((ctx) => ctx.db.get(runId)))?.cancelRequested).toBe(true);
      } else {
        await expect(stop).rejects.toThrow(/Run not found/);
      }
      await t.mutation(internal.agentRunner.finishRun, { runId, status: "cancelled" });

      // updateDraft + approve + discard
      const proposalId = await mkProposal(t, threadId);
      const edit = as.mutation(api.agentProposals.updateDraft, {
        proposalId, revision: 1, editedPayload: { kind: "createTask", title: "Edited" },
      });
      const approve = () => as.mutation(api.agentProposals.approve, { proposalId, revision: 2 });
      const discardId = await mkProposal(t, threadId, "To discard");
      const discard = as.mutation(api.agentProposals.discard, { proposalId: discardId });
      if (write) {
        expect(await edit).toEqual({ revision: 2 });
        expect(await approve()).toMatchObject({ ok: true });
        await discard;
        expect((await t.run((ctx) => ctx.db.get(discardId)))?.status).toBe("discarded");
      } else {
        await expect(edit).rejects.toThrow(/Proposal not found/);
        await expect(as.mutation(api.agentProposals.approve, { proposalId, revision: 1 })).rejects.toThrow(
          /Proposal not found/,
        );
        await expect(discard).rejects.toThrow(/Proposal not found/);
        await expect(
          as.mutation(api.agentProposals.approveAll, { threadId, items: [{ proposalId, revision: 1 }] }),
        ).rejects.toThrow(/Thread not found/);
        expect((await t.run((ctx) => ctx.db.get(proposalId)))?.status).toBe("pending");
      }
    },
  );

  it("an interactive send on a busy thread is still rejected (no queue)", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    await markRunning(t, threadId, u.admin);
    await expect(
      t.withIdentity(IDENTITY.admin2).action(api.agentRunner.startRun, { threadId, message: "me too" }),
    ).rejects.toThrow(/already in progress/);
  });

  it("an admins thread names the author of each user turn", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    await t.withIdentity(IDENTITY.admin).action(api.agentRunner.startRun, { threadId, message: "from A" });
    await t.withIdentity(IDENTITY.admin2).action(api.agentRunner.startRun, { threadId, message: "from B" });
    const thread = await t.withIdentity(IDENTITY.admin).query(api.agentThreads.get, { threadId });
    expect(thread.authors.map((a) => a.name).sort()).toEqual(["admin", "admin2"]);
    const userTurns = (await componentMessages(t, threadId)).filter((m) => m.message?.role === "user");
    expect(userTurns.map((m) => m.userId)).toEqual([u.admin, u.admin2]);
  });

  it("actor-path createProposals follows thread write access", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
    const proposals = [{ kind: "createTask" as const, title: "Shared draft" }];
    const ids = await t.mutation(internal.agentActorTools.createProposals, {
      actor: { orgId: ORG, userId: u.admin2 }, componentThreadId, proposals,
    });
    expect(ids).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.get(ids[0] as Id<"agentProposals">))).toMatchObject({ revision: 1 });
    await expect(
      t.mutation(internal.agentActorTools.createProposals, {
        actor: { orgId: ORG, userId: u.alice }, componentThreadId, proposals,
      }),
    ).rejects.toThrow(/Thread not found/);
  });
});

// ─── Two admins, one admins thread, revisions (I11) ──────────────────────────

describe("proposal revisions in a shared thread", () => {
  it("B's stale approve is refused; the current revision approves as B", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const proposalId = await mkProposal(t, threadId, "Agent's title");
    const A = t.withIdentity(IDENTITY.admin);
    const B = t.withIdentity(IDENTITY.admin2);

    // B renders revision 1; A edits → revision 2.
    const [rendered] = await B.query(api.agentProposals.listForCards, { proposalIds: [proposalId] });
    expect(rendered.revision).toBe(1);
    expect(
      await A.mutation(api.agentProposals.updateDraft, {
        proposalId, revision: 1, editedPayload: { kind: "createTask", title: "A's title" },
      }),
    ).toEqual({ revision: 2 });

    await expect(
      B.mutation(api.agentProposals.approve, { proposalId, revision: rendered.revision }),
    ).rejects.toThrow("This changed — review it again.");
    // A stale edit is refused the same way (no silent overwrite of A's edit).
    await expect(
      B.mutation(api.agentProposals.updateDraft, {
        proposalId, revision: 1, editedPayload: { kind: "createTask", title: "B's title" },
      }),
    ).rejects.toThrow("This changed — review it again.");
    expect((await t.run((ctx) => ctx.db.get(proposalId)))?.status).toBe("pending");

    const [fresh] = await B.query(api.agentProposals.listForCards, { proposalIds: [proposalId] });
    expect(fresh).toMatchObject({ revision: 2, payload: { title: "A's title" } });
    const outcome = await B.mutation(api.agentProposals.approve, { proposalId, revision: fresh.revision });
    expect(outcome.ok).toBe(true);
    const taskId = (outcome as { committedRef: string }).committedRef as Id<"tasks">;

    expect(await t.run((ctx) => ctx.db.get(proposalId))).toMatchObject({
      status: "approved", decidedBy: u.admin2,
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.title).toBe("A's title"); // A's stored edit, not the agent draft
    const activity = await t.run((ctx) =>
      ctx.db.query("activityLog").withIndex("by_task", (q) => q.eq("taskId", taskId)).collect(),
    );
    expect(activity.find((a) => a.type === "task_created")?.userId).toBe(u.admin2);
  });

  it("approveAll refuses the batch when a rendered card changed, then approves the current one", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const p1 = await mkProposal(t, threadId, "One");
    const p2 = await mkProposal(t, threadId, "Two");
    const unseen = await mkProposal(t, threadId, "Arrived after render");
    const B = t.withIdentity(IDENTITY.admin2);
    await t.withIdentity(IDENTITY.admin).mutation(api.agentProposals.updateDraft, {
      proposalId: p2, revision: 1, editedPayload: { kind: "createTask", title: "Two (edited)" },
    });

    await expect(
      B.mutation(api.agentProposals.approveAll, {
        threadId, items: [{ proposalId: p1, revision: 1 }, { proposalId: p2, revision: 1 }],
      }),
    ).rejects.toThrow("This changed — review it again.");
    expect((await t.run((ctx) => ctx.db.get(p1)))?.status).toBe("pending"); // nothing executed

    const outcomes = await B.mutation(api.agentProposals.approveAll, {
      threadId, items: [{ proposalId: p1, revision: 1 }, { proposalId: p2, revision: 2 }],
    });
    expect(outcomes.map((o) => o.result)).toEqual(["approved", "approved"]);
    // Only rendered cards are approved — the unseen one stays pending.
    expect((await t.run((ctx) => ctx.db.get(unseen)))?.status).toBe("pending");
  });

  it("the agent revising its own plan bumps the revision and drops stale decisions", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
    const proposalId = await mkProposal(t, threadId, "Plan v1");
    await t.withIdentity(IDENTITY.admin).mutation(api.agentProposals.updateDraft, {
      proposalId, revision: 1, editedPayload: { kind: "createTask", title: "Human edit" },
    });

    expect(
      await t.mutation(internal.agentProposals.updateProposalPayload, {
        componentThreadId, proposalId, payload: { kind: "createTask", title: "Plan v2" },
      }),
    ).toEqual({ revision: 3 });
    const row = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(row).toMatchObject({ revision: 3, payload: { title: "Plan v2" } });
    // D25 (B6a): the owner's title edit survives a revision that didn't change it …
    expect(row.editedPayload).toMatchObject({ title: "Human edit" });
    // … and gives way when the agent marks the title as changed by new content.
    expect(
      await t.mutation(internal.agentProposals.updateProposalPayload, {
        componentThreadId, proposalId, payload: { kind: "createTask", title: "Plan v3" }, changedFields: ["title"],
      }),
    ).toEqual({ revision: 4 });
    const row2 = (await t.run((ctx) => ctx.db.get(proposalId)))!;
    expect(row2).toMatchObject({ revision: 4, payload: { title: "Plan v3" } });
    expect(row2.editedPayload).toBeUndefined();

    await expect(
      t.withIdentity(IDENTITY.admin2).mutation(api.agentProposals.approve, { proposalId, revision: 2 }),
    ).rejects.toThrow("This changed — review it again.");

    // Another thread's tool can't touch it; the kind can't change.
    const otherThread = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const otherComponent = (await t.run((ctx) => ctx.db.get(otherThread)))!.componentThreadId;
    await expect(
      t.mutation(internal.agentProposals.updateProposalPayload, {
        componentThreadId: otherComponent, proposalId, payload: { kind: "createTask", title: "x" },
      }),
    ).rejects.toThrow(/No proposal/);
  });

  it("rows without a stored revision read as revision 1", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const proposalId = await t.run((ctx) =>
      ctx.db.insert("agentProposals", {
        orgId: ORG, threadId, userId: u.alice, payload: { kind: "createTask", title: "Legacy" },
        status: "pending", createdAt: Date.now(),
      }),
    );
    const alice = t.withIdentity(IDENTITY.alice);
    expect((await alice.query(api.agentProposals.listForCards, { proposalIds: [proposalId] }))[0].revision).toBe(1);
    expect(await alice.mutation(api.agentProposals.approve, { proposalId, revision: 1 })).toMatchObject({ ok: true });
  });
});

// ─── Queued background runs (I11) ────────────────────────────────────────────

describe("background runs on a busy thread", () => {
  it("queue, then run exactly once after the active run finishes", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const active = await markRunning(t, threadId, u.admin);
    const model = mockModel({ content: [{ type: "text", text: "Queued answer." }] });
    modelSlot.current = model;

    const queued = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: u.admin2, message: "Second job",
    });
    expect(queued.queued).toBe(true);
    expect(await t.run((ctx) => ctx.db.get(queued.runId))).toMatchObject({
      status: "queued", via: "background", userId: u.admin2, queuedMessage: "Second job",
    });
    // Its prompt is not in the thread yet (it would land inside the active turn).
    expect(await componentMessages(t, threadId)).toHaveLength(0);
    // A queued run shows as a quiet line, not an outcome.
    const runs = await t.withIdentity(IDENTITY.admin).query(api.agentThreads.listRuns, { threadId });
    expect(runs.find((r) => r._id === queued.runId)?.queuedAt).not.toBeNull();

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = await t.run((ctx) => ctx.db.get(queued.runId));
    expect(run).toMatchObject({ status: "succeeded", userId: u.admin2, actorIsAdmin: true });
    expect(run?.queuedMessage).toBeUndefined();
    const prompts = (await componentMessages(t, threadId)).filter((m) => m.message?.role === "user");
    expect(prompts).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.status).toBe("idle");

    // A spurious extra pump is a no-op: still exactly one run, one prompt.
    await t.action(internal.agentBackground.runNextQueued, { threadId });
    const allRuns = await t.run((ctx) =>
      ctx.db.query("agentRuns").withIndex("by_threadId", (q) => q.eq("threadId", threadId)).collect(),
    );
    expect(allRuns).toHaveLength(2);
    expect((await componentMessages(t, threadId)).filter((m) => m.message?.role === "user")).toHaveLength(1);
  });

  it("several queued runs start one at a time, in order", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const active = await markRunning(t, threadId, u.admin);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const first = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin, message: "first" });
    const second = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin2, message: "second" });
    expect([first.queued, second.queued]).toEqual([true, true]);

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [r1, r2] = await t.run(async (ctx) => [await ctx.db.get(first.runId), await ctx.db.get(second.runId)]);
    expect(r1?.status).toBe("succeeded");
    expect(r2?.status).toBe("succeeded");
    expect(r1!.startedAt).toBeLessThanOrEqual(r2!.startedAt);
    const prompts = (await componentMessages(t, threadId)).filter((m) => m.message?.role === "user");
    expect(prompts.map((m) => m.userId)).toEqual([u.admin, u.admin2]);
  });

  it("a queued run whose actor lost admin is rejected when it starts", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const active = await markRunning(t, threadId, u.admin);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "unused" }] });

    const queued = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: u.admin2, message: "Will not run",
    });
    expect(queued.queued).toBe(true);
    await t.mutation(internal.orgMembers.upsertMembership, {
      orgId: ORG, clerkUserId: "clerk_admin2", role: "org:member",
    });

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = await t.run((ctx) => ctx.db.get(queued.runId));
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/Queued run not started/);
    // Its message is posted so the error block has context; nothing ran.
    const msgs = await componentMessages(t, threadId);
    expect(msgs.map((m) => [m.message?.role, m.userId])).toEqual([["user", u.admin2]]);
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.status).toBe("idle");
  });

  it("a background start by a member on an admins thread is rejected outright", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    await expect(
      t.action(internal.agentBackground.start, { threadId, actingUserId: u.alice, message: "hi" }),
    ).rejects.toThrow(/Thread not found/);
    expect(await t.run((ctx) => ctx.db.query("agentRuns").collect())).toHaveLength(0);
  });

  it("an idle thread with nothing queued starts immediately", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const res = await t.action(internal.agentBackground.start, {
      threadId, actingUserId: u.admin2, message: "go",
    });
    expect(res.queued).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(res.runId)))?.status).toBe("succeeded");
  });
});

describe("queue robustness", () => {
  it("a head whose open throws after its checks is failed; the next one still runs", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const active = await markRunning(t, threadId, u.admin);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const bad = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin, message: "BOOM" });
    const good = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin2, message: "fine" });
    saveFailure.prompt = "BOOM";

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const [b, g] = await t.run(async (ctx) => [await ctx.db.get(bad.runId), await ctx.db.get(good.runId)]);
    expect(b).toMatchObject({ status: "failed" });
    expect(b?.error).toMatch(/Queued run not started: .*simulated open failure/);
    expect(g?.status).toBe("succeeded");
    // B8a: only the claimed run "started" — the one refused at claim owns no messages.
    const listed = await t.withIdentity(IDENTITY.admin).query(api.agentThreads.listRuns, { threadId });
    expect(listed.find((r) => r._id === bad.runId)?.started).toBe(false);
    expect(listed.find((r) => r._id === good.runId)?.started).toBe(true);
    expect(listed.find((r) => r._id === active)?.started).toBe(true);
    const prompts = (await componentMessages(t, threadId)).filter((m) => m.message?.role === "user");
    expect(prompts.map((m) => m.userId)).toEqual([u.admin2]);
  });

  it("stopRun cancels a queued run without posting its message", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const active = await markRunning(t, threadId, u.admin);
    const queued = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin, message: "later" });
    // A member can't touch it; another admin can.
    await expect(
      t.withIdentity(IDENTITY.alice).mutation(api.agentRunner.stopRun, { runId: queued.runId }),
    ).rejects.toThrow(/Run not found/);
    await t.withIdentity(IDENTITY.admin2).mutation(api.agentRunner.stopRun, { runId: queued.runId });
    expect((await t.run((ctx) => ctx.db.get(queued.runId)))?.status).toBe("cancelled");
    const runs = await t.withIdentity(IDENTITY.admin).query(api.agentThreads.listRuns, { threadId });
    expect(runs.find((r) => r._id === queued.runId)).toMatchObject({ cancelledBeforeStart: true, queuedAt: null, started: false });

    modelSlot.current = mockModel({ content: [{ type: "text", text: "unused" }] });
    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(queued.runId)))?.status).toBe("cancelled");
    expect(await componentMessages(t, threadId)).toHaveLength(0);
  });

  it("approveAll with a repeated item creates one task", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const p1 = await mkProposal(t, threadId, "Only once");
    const p2 = await mkProposal(t, threadId, "Other");
    const outcomes = await t.withIdentity(IDENTITY.admin2).mutation(api.agentProposals.approveAll, {
      threadId,
      items: [{ proposalId: p1, revision: 1 }, { proposalId: p1, revision: 1 }, { proposalId: p2, revision: 1 }],
    });
    expect(outcomes.map((o) => [o.proposalId, o.result])).toEqual([[p1, "approved"], [p2, "approved"]]);
    const tasks = await t.run((ctx) => ctx.db.query("tasks").collect());
    expect(tasks.map((x) => x.title).sort()).toEqual(["Only once", "Other"]);
  });
});

describe("stale-run sweep", () => {
  it("fails runs stuck in running past 15 minutes, frees the thread, pumps its queue", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const stuckThread = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const freshThread = await mkThread(t, { owner: u.alice });
    const stuck = await markRunning(t, stuckThread, u.admin);
    const fresh = await markRunning(t, freshThread, u.alice);
    await t.run((ctx) => ctx.db.patch(stuck, { startedAt: Date.now() - 16 * 60 * 1000 }));
    const queued = await t.action(internal.agentBackground.start, {
      threadId: stuckThread, actingUserId: u.admin2, message: "after the timeout",
    });
    expect(queued.queued).toBe(true);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });

    expect(await t.mutation(internal.agentRunner.sweepStaleRuns, {})).toBe(1);
    expect(await t.run((ctx) => ctx.db.get(stuck))).toMatchObject({ status: "failed", error: "Run timed out" });
    expect((await t.run((ctx) => ctx.db.get(fresh)))?.status).toBe("running");
    expect((await t.run((ctx) => ctx.db.get(freshThread)))?.status).toBe("running");

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(queued.runId)))?.status).toBe("succeeded");
    expect((await t.run((ctx) => ctx.db.get(stuckThread)))?.status).toBe("idle");

    // A late finish of the timed-out run's action changes nothing.
    await t.mutation(internal.agentRunner.finishRun, { runId: stuck, status: "succeeded" });
    expect((await t.run((ctx) => ctx.db.get(stuck)))?.status).toBe("failed");
    expect(await t.mutation(internal.agentRunner.sweepStaleRuns, {})).toBe(0);
  });
});

describe("listMine and artifacts follow the thread policy", () => {
  it("a demoted owner no longer lists their admins thread; other admins never do", async () => {
    const t = createT();
    const u = await setup(t);
    const shared = await mkThread(t, { owner: u.admin2, visibility: "admins" });
    const own = await mkThread(t, { owner: u.admin2 });
    const ids = async (who: Who) =>
      (await t.withIdentity(IDENTITY[who]).query(api.agentThreads.listMine, {})).map((x) => x._id).sort();
    expect(await ids("admin2")).toEqual([shared, own].sort());
    expect(await ids("admin")).toEqual([]);
    // Queries take the role from the JWT: the demoted owner's refreshed token.
    const demoted = { ...IDENTITY.admin2, orgRole: "org:member" };
    const demotedList = await t.withIdentity(demoted).query(api.agentThreads.listMine, {});
    expect(demotedList.map((x) => x._id)).toEqual([own]);
  });

  it("artifacts are readable exactly when their thread is", async () => {
    const t = createT();
    const u = await setup(t);
    const shared = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const sheetJson = JSON.stringify({
      title: "Sheet", columns: [{ key: "a", label: "A", kind: "text" }], rows: [{ a: "1" }],
    });
    const artifactId = await t.run((ctx) =>
      ctx.db.insert("agentArtifacts", {
        orgId: ORG, threadId: shared, userId: u.admin, kind: "sheet_csv", name: "Sheet",
        sheetJson, createdAt: Date.now(),
      }),
    );
    const list = async (who: Who) =>
      (await t.withIdentity(IDENTITY[who]).query(api.agentArtifacts.listByThread, { threadId: shared })).map((a) => a._id);
    expect(await list("admin2")).toEqual([artifactId]);
    expect(await list("alice")).toEqual([]);
    expect(
      await t.withIdentity(IDENTITY.admin2).query(api.agentArtifacts.getForCanvas, { artifactId }),
    ).toMatchObject({ _id: artifactId, name: "Sheet" });
    // The owner shortcut is gone: a member owner of the row gets nothing on an admins thread.
    await t.run((ctx) => ctx.db.patch(artifactId, { userId: u.alice }));
    expect(
      await t.withIdentity(IDENTITY.alice).query(api.agentArtifacts.getForCanvas, { artifactId }),
    ).toBeNull();
  });
});

// ─── ensureAnchoredThread ────────────────────────────────────────────────────

describe("ensureAnchoredThread", () => {
  it("is idempotent: one thread (and one component thread) per anchor", async () => {
    const t = createT();
    const u = await setup(t);
    const agentId = await mkAgent(t, u.admin);
    const args = {
      orgId: ORG, agentId, anchor: { type: "emailThread", id: "gmail-thread-1" },
      visibility: "admins" as const, ownerUserId: u.admin,
    };
    const first = await t.mutation(internal.agentThreads.ensureAnchoredThread, args);
    const again = await t.mutation(internal.agentThreads.ensureAnchoredThread, args);
    // A different admin as nominal owner still finds THE admins thread.
    const viaOther = await t.mutation(internal.agentThreads.ensureAnchoredThread, { ...args, ownerUserId: u.admin2 });
    expect(again).toBe(first);
    expect(viaOther).toBe(first);
    const rows = await t.run((ctx) => ctx.db.query("agentThreads").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ visibility: "admins", anchor: args.anchor, userId: u.admin, status: "idle" });
    // The component thread exists and is usable.
    expect(await componentMessages(t, first)).toHaveLength(0);

    // Readable by admin2 as a shared thread.
    const view = await t.withIdentity(IDENTITY.admin2).query(api.agentThreads.get, { threadId: first });
    expect(view).toMatchObject({ viewerCanWrite: true, anchor: args.anchor });

    // A different anchor id is a different thread.
    const other = await t.mutation(internal.agentThreads.ensureAnchoredThread, {
      ...args, anchor: { type: "emailThread", id: "gmail-thread-2" },
    });
    expect(other).not.toBe(first);
  });

  it("private anchors are per owner; an admins thread needs an admin owner", async () => {
    const t = createT();
    const u = await setup(t);
    const agentId = await mkAgent(t, u.admin);
    const anchor = { type: "task", id: "task-1" };
    const alices = await t.mutation(internal.agentThreads.ensureAnchoredThread, {
      orgId: ORG, agentId, anchor, visibility: "private", ownerUserId: u.alice,
    });
    const bobs = await t.mutation(internal.agentThreads.ensureAnchoredThread, {
      orgId: ORG, agentId, anchor, visibility: "private", ownerUserId: u.bob,
    });
    expect(bobs).not.toBe(alices);
    expect(
      await t.mutation(internal.agentThreads.ensureAnchoredThread, {
        orgId: ORG, agentId, anchor, visibility: "private", ownerUserId: u.alice,
      }),
    ).toBe(alices);
    // Bob can't read Alice's task thread (I10).
    await expect(
      t.withIdentity(IDENTITY.bob).query(api.agentThreads.get, { threadId: alices }),
    ).rejects.toThrow(/Thread not found/);

    await expect(
      t.mutation(internal.agentThreads.ensureAnchoredThread, {
        orgId: ORG, agentId, anchor, visibility: "admins", ownerUserId: u.alice,
      }),
    ).rejects.toThrow(/owned by an admin/);

    // An admins-only agent never gets a member-owned thread.
    const adminAgent = await mkAgent(t, u.admin, "admins");
    await expect(
      t.mutation(internal.agentThreads.ensureAnchoredThread, {
        orgId: ORG, agentId: adminAgent, anchor, visibility: "private", ownerUserId: u.alice,
      }),
    ).rejects.toThrow(/admin's thread/);
    expect(
      await t.mutation(internal.agentThreads.ensureAnchoredThread, {
        orgId: ORG, agentId: adminAgent, anchor, visibility: "private", ownerUserId: u.admin,
      }),
    ).toBeTruthy();
  });
});

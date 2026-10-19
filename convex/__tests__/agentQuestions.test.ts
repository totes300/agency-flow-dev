// @vitest-environment edge-runtime
//
// The question block (docs/prd-email-triage-implementation-plan.md, phase A5;
// PRD D16, D18, §6.6, I7, I11):
//   - askUser (T5) writes one row as the run's actor and ENDS the run
//   - one question at a time: a new ask supersedes the pending one
//   - answer: access, option validation, stale plan revision, exactly one
//     next run (also under two concurrent admin answers), queued behind a
//     busy thread
//   - Later starts no run; settleQuestion settles from a typed message

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { QUESTION_STALE_MESSAGE } from "../../lib/agents/questions";
import { registerAgentJobForTesting, type AgentRunJob } from "../lib/agentJobs";

// resolveModel → the component's mock model (same swap as agentActor.test.ts).
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

const ORG = "org_questions";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

type Who = "admin" | "admin2" | "alice";
const IDENTITY: Record<Who, { subject: string; orgId: string; orgRole: string }> = {
  admin: { subject: "clerk_q_admin", orgId: ORG, orgRole: "org:admin" },
  admin2: { subject: "clerk_q_admin2", orgId: ORG, orgRole: "org:admin" },
  alice: { subject: "clerk_q_alice", orgId: ORG, orgRole: "org:member" },
};
type Users = Record<Who, Id<"users">>;

async function setup(t: T): Promise<Users> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const users = {} as Users;
    const roles: [Who, "admin" | "member"][] = [
      ["admin", "admin"], ["admin2", "admin"], ["alice", "member"],
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
    return users;
  });
}

async function mkThread(
  t: T,
  opts: { owner: Id<"users">; visibility?: "private" | "admins"; tools?: string[] },
): Promise<Id<"agentThreads">> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const agentId = await ctx.db.insert("agents", {
      orgId: ORG, name: "Asker", description: "", instructions: "Be brief.",
      tools: opts.tools ?? [], runPermission: "everyone", trigger: "manual",
      createdBy: opts.owner, createdAt: now, updatedAt: now,
    });
    const componentThreadId = await createThread(ctx, components.agent, { userId: opts.owner });
    return await ctx.db.insert("agentThreads", {
      orgId: ORG, componentThreadId, agentId, userId: opts.owner, title: "New chat",
      status: "idle", lastActivityAt: now, createdAt: now,
      ...(opts.visibility ? { visibility: opts.visibility } : {}),
    });
  });
}

const OPTIONS = [
  { label: "Use 23:59", recommended: true },
  { label: "Use 18:00" },
  { label: "I'll give the exact time", composerPrefix: "Countdown ends: " },
];

/** Record a question through the actor path (what askUser does). */
async function ask(
  t: T,
  threadId: Id<"agentThreads">,
  actor: Id<"users">,
  extra: Partial<{ multiSelect: boolean; allowOther: boolean; proposalId: string; header: string }> = {},
): Promise<Id<"agentQuestions">> {
  const componentThreadId = (await t.run((ctx) => ctx.db.get(threadId)))!.componentThreadId;
  const { questionId } = await t.mutation(internal.agentQuestions.ask, {
    actor: { orgId: ORG, userId: actor },
    componentThreadId,
    header: extra.header ?? "Countdown",
    question: "What time should the countdown end?",
    why: "Réka wrote Friday, but no time",
    options: OPTIONS,
    multiSelect: extra.multiSelect ?? false,
    allowOther: extra.allowOther ?? true,
    ...(extra.proposalId ? { proposalId: extra.proposalId } : {}),
  });
  return questionId;
}

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

async function runsOf(t: T, threadId: Id<"agentThreads">) {
  return await t.run((ctx) =>
    ctx.db.query("agentRuns").withIndex("by_threadId", (q) => q.eq("threadId", threadId)).collect(),
  );
}

async function userTurns(t: T, threadId: Id<"agentThreads">) {
  const thread = (await t.run((ctx) => ctx.db.get(threadId)))!;
  const res = await t.run((ctx) =>
    ctx.runQuery(components.agent.messages.listMessagesByThreadId, {
      threadId: thread.componentThreadId, order: "asc",
      paginationOpts: { cursor: null, numItems: 50 },
    }),
  );
  return res.page.filter((m) => m.message?.role === "user");
}

function recordingModel(args: Parameters<typeof mockModel>[0]) {
  const model = mockModel(args);
  return model as typeof model & {
    doStreamCalls: Array<Parameters<typeof model.doStream>[0]>;
  };
}

const askCall = (input: Record<string, unknown>) => ({
  type: "tool-call" as const, toolCallId: "call_ask", toolName: "askUser", input: JSON.stringify(input),
});

beforeEach(() => {
  modelSlot.current = null;
});
afterEach(() => {
  vi.useRealTimers();
});

// ─── askUser ends the run ────────────────────────────────────────────────────

describe("askUser (T5)", () => {
  it("records the question as the run's actor and ends the run after the call", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice, tools: ["askUser"] });
    const model = recordingModel({
      contentSteps: [
        [askCall({ header: "Countdown", question: "What time?", options: OPTIONS })],
        [{ type: "text", text: "This must never be generated." }],
      ],
    });
    modelSlot.current = model;

    const { runId } = await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, {
      threadId, message: "Set up the countdown",
    });

    // One model call: the loop stopped on the question, no follow-up step.
    expect(model.doStreamCalls).toHaveLength(1);
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["askUser"]);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain("askUser ends your turn");
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: "succeeded" });
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.status).toBe("idle");

    const questions = await t.run((ctx) => ctx.db.query("agentQuestions").collect());
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      orgId: ORG, agentThreadId: threadId, runId, askedUserId: u.alice, status: "pending",
      header: "Countdown", multiSelect: false, allowOther: true,
    });
    expect(questions[0].options).toHaveLength(3);
  });

  it("a background run's actor is the asked user", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins", tools: ["askUser"] });
    modelSlot.current = mockModel({
      contentSteps: [[askCall({ header: "Owner", question: "Who does it?", options: OPTIONS.slice(0, 2) })]],
    });
    await t.action(internal.agentBackground.start, { threadId, actingUserId: u.admin2, message: "Prepare" });
    const [question] = await t.run((ctx) => ctx.db.query("agentQuestions").collect());
    expect(question.askedUserId).toBe(u.admin2);
  });

  it("a rejected ask (bad input) does not end the run", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice, tools: ["askUser"] });
    const model = recordingModel({
      contentSteps: [
        [askCall({ header: "Countdown", question: "What time?", options: [{ label: "Only one" }] })],
        [{ type: "text", text: "I'll decide: 23:59." }],
      ],
    });
    modelSlot.current = model;
    const { runId } = await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, {
      threadId, message: "Set up the countdown",
    });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: "succeeded" });
    expect(await t.run((ctx) => ctx.db.query("agentQuestions").collect())).toHaveLength(0);
  });

  it("a second ask supersedes the pending one", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const first = await ask(t, threadId, u.alice);
    const second = await ask(t, threadId, u.alice, { header: "Owner" });
    const [a, b] = await t.run(async (ctx) => [await ctx.db.get(first), await ctx.db.get(second)]);
    expect(a?.status).toBe("superseded");
    expect(b?.status).toBe("pending");
    const block = await t.withIdentity(IDENTITY.alice).query(api.agentQuestions.getForBlock, { questionId: first });
    expect(block?.status).toBe("superseded");
  });

  it("refuses an actor without write access to the thread", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    await expect(ask(t, threadId, u.alice)).rejects.toThrow(/Thread not found/);
  });
});

// ─── Answer ──────────────────────────────────────────────────────────────────

describe("answer", () => {
  it("two admins answer at once → exactly one next run; the second answer is refused", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    const model = recordingModel({ content: [{ type: "text", text: "Using 23:59." }] });
    modelSlot.current = model;

    const results = await Promise.allSettled([
      t.withIdentity(IDENTITY.admin).mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
      t.withIdentity(IDENTITY.admin2).mutation(api.agentQuestions.answer, { questionId, optionIndexes: [1] }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(/already answered/);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const runs = await runsOf(t, threadId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "succeeded", questionId, via: "background" });
    const question = (await t.run((ctx) => ctx.db.get(questionId)))!;
    expect(question.status).toBe("answered");
    expect(runs[0].userId).toBe(question.answeredBy);

    // The user turn is the readable answer, posted as the answerer.
    const turns = await userTurns(t, threadId);
    expect(turns).toHaveLength(1);
    expect(turns[0].userId).toBe(question.answeredBy);
    expect(JSON.stringify(turns[0].message)).toContain("Countdown →");
    // The run knows which question it continues from.
    expect(model.doStreamCalls).toHaveLength(1);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain("Question answered");

    // Live block state for the other admin.
    const block = await t.withIdentity(IDENTITY.admin2).query(api.agentQuestions.getForBlock, { questionId });
    expect(block).toMatchObject({ status: "answered", canAnswer: true });
    expect(block?.answeredByName).toBe(question.answeredBy === u.admin ? "admin" : "admin2");
  });

  it("a member cannot answer an admins-thread question", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    const alice = t.withIdentity(IDENTITY.alice);
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
    ).rejects.toThrow(/Question not found/);
    await expect(alice.mutation(api.agentQuestions.later, { questionId })).rejects.toThrow(/Question not found/);
    expect(await alice.query(api.agentQuestions.getForBlock, { questionId })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
    expect(await runsOf(t, threadId)).toHaveLength(0);
  });

  it("an admin auditing a member's private thread cannot answer", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const questionId = await ask(t, threadId, u.alice);
    const admin = t.withIdentity(IDENTITY.admin);
    expect(await admin.query(api.agentQuestions.getForBlock, { questionId })).toMatchObject({
      status: "pending", canAnswer: false,
    });
    await expect(
      admin.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
    ).rejects.toThrow(/Question not found/);
  });

  it("refuses an answer once the bound plan revision moved (I11)", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const proposalId = await t.run((ctx) =>
      ctx.db.insert("agentProposals", {
        orgId: ORG, threadId, userId: u.admin, payload: { kind: "createTask", title: "Plan" },
        status: "pending", revision: 2, createdAt: Date.now(),
      }),
    );
    const questionId = await ask(t, threadId, u.admin, { proposalId });
    // Code stamps the CURRENT revision, never a model-supplied one.
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.proposalRevision).toBe(2);

    await t.withIdentity(IDENTITY.admin).mutation(api.agentProposals.updateDraft, {
      proposalId, revision: 2, editedPayload: { kind: "createTask", title: "Plan, edited" },
    });
    const B = t.withIdentity(IDENTITY.admin2);
    expect((await B.query(api.agentQuestions.getForBlock, { questionId }))?.stale).toBe(true);
    await expect(
      B.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
    ).rejects.toThrow(QUESTION_STALE_MESSAGE);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
    expect(await runsOf(t, threadId)).toHaveLength(0);
  });

  it("validates options: range, free text, single vs multi", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const strict = await ask(t, threadId, u.alice, { allowOther: false });
    const alice = t.withIdentity(IDENTITY.alice);
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId: strict, optionIndexes: [3] }),
    ).rejects.toThrow(/doesn't exist/);
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId: strict, optionIndexes: [0, 1] }),
    ).rejects.toThrow(/Pick one option/);
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId: strict, optionIndexes: [], other: "20:00" }),
    ).rejects.toThrow(/takes one of its options/);
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId: strict, optionIndexes: [] }),
    ).rejects.toThrow(/Pick an option/);
    expect((await t.run((ctx) => ctx.db.get(strict)))?.status).toBe("pending");
    expect(await runsOf(t, threadId)).toHaveLength(0);

    // Multi-select with free text is fine.
    const multi = await ask(t, threadId, u.alice, { multiSelect: true });
    await alice.mutation(api.agentQuestions.answer, { questionId: multi, optionIndexes: [1, 0], other: "either" });
    expect((await t.run((ctx) => ctx.db.get(multi)))?.answer).toEqual({ optionIndexes: [0, 1], other: "either" });
  });

  it("on a busy thread the next run queues and runs once after the active run", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    const active = await markRunning(t, threadId, u.admin);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "On it." }] });

    const { runId } = await t
      .withIdentity(IDENTITY.admin2)
      .mutation(api.agentQuestions.answer, { questionId, optionIndexes: [], other: "20:00 sharp" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      status: "queued", userId: u.admin2, questionId, queuedMessage: "Countdown → 20:00 sharp",
    });
    expect(await userTurns(t, threadId)).toHaveLength(0);

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({ status: "succeeded", userId: u.admin2 });
    const turns = await userTurns(t, threadId);
    expect(turns).toHaveLength(1);
    expect(turns[0].userId).toBe(u.admin2);
    expect((await runsOf(t, threadId)).filter((r) => r.questionId === questionId)).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.status).toBe("idle");
  });
});

// ─── Later, reopen, settle ───────────────────────────────────────────────────

describe("later and settle", () => {
  it("Later starts no run; Answer now reopens it", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const questionId = await ask(t, threadId, u.alice);
    const alice = t.withIdentity(IDENTITY.alice);

    await alice.mutation(api.agentQuestions.later, { questionId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("later");
    expect(await runsOf(t, threadId)).toHaveLength(0);
    // Not answerable while set aside.
    await expect(
      alice.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
    ).rejects.toThrow(/set aside/);

    // Reopen is refused while another question is open.
    const other = await ask(t, threadId, u.alice, { header: "Owner" });
    await expect(alice.mutation(api.agentQuestions.reopen, { questionId })).rejects.toThrow(/Another question/);
    await alice.mutation(api.agentQuestions.later, { questionId: other });
    await alice.mutation(api.agentQuestions.reopen, { questionId });
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
  });

  it("settleQuestion marks the pending question answered from a typed message", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const questionId = await ask(t, threadId, u.alice);
    const model = recordingModel({
      contentSteps: [
        [{
          type: "tool-call", toolCallId: "call_settle", toolName: "settleQuestion",
          input: JSON.stringify({ questionId, outcome: "answered", note: "20:00" }),
        }],
        [{ type: "text", text: "Got it — 20:00." }],
      ],
    });
    modelSlot.current = model;

    await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, {
      threadId, message: "make it 20:00",
    });

    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["settleQuestion"]);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain(`questionId: ${questionId}`);
    expect(await t.run((ctx) => ctx.db.get(questionId))).toMatchObject({
      status: "answered", answeredBy: u.alice, answeredIn: "conversation",
      answer: { optionIndexes: [], other: "20:00" },
    });
    const block = await t.withIdentity(IDENTITY.alice).query(api.agentQuestions.getForBlock, { questionId });
    expect(block?.settledInConversation).toBe(true);
    // Settling starts no extra run.
    expect(await runsOf(t, threadId)).toHaveLength(1);
  });

  it("a background run is never offered settleQuestion or the pending question", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice, tools: ["askUser"] });
    const questionId = await ask(t, threadId, u.alice);
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    await t.action(internal.agentBackground.start, { threadId, actingUserId: u.alice, message: "Nightly check" });
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["askUser"]);
    // (The question id may appear in history — the askUser tool result — but
    // never as the pending-question context.)
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(`Pending question (questionId: ${questionId}`);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
  });

  it("settle applies the answer's actor check", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    // A run whose actor (a member) has no write access to the admins thread.
    const runId = await markRunning(t, threadId, u.alice);
    await expect(
      t.mutation(internal.agentQuestions.settle, { runId, questionId, outcome: "answered" }),
    ).rejects.toThrow(/can't settle/);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
  });

  it("without a pending question there is no settle tool", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice, tools: ["askUser"] });
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    await t.withIdentity(IDENTITY.alice).action(api.agentRunner.startRun, { threadId, message: "hi" });
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["askUser"]);
  });

  it("settle refuses a question of another thread", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.alice });
    const otherThread = await mkThread(t, { owner: u.alice });
    const questionId = await ask(t, otherThread, u.alice);
    const runId = await markRunning(t, threadId, u.alice);
    await expect(
      t.mutation(internal.agentQuestions.settle, { runId, questionId, outcome: "answered" }),
    ).rejects.toThrow(/No question/);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
  });
});

// ─── Job continuity (A5 exception to the designated-actor rule) ──────────────

describe("a question asked inside a job run", () => {
  const ASK_JOB: AgentRunJob = {
    name: "test_ask_job",
    tier: "agent_run",
    systemAgentKey: "assistant",
    visibility: "admins",
    instructions: "ASK-JOB-MARKER: prepare the thread.",
    tools: ["askUser", "listClients"],
    maxSteps: 3,
  };
  const ANCHOR = { type: "emailThread", id: "et_q" };
  let unregister: (() => void) | null = null;
  beforeEach(() => {
    unregister = registerAgentJobForTesting(ASK_JOB);
  });
  afterEach(() => {
    unregister?.();
    unregister = null;
  });

  /** The job runs as the designated actor (admin) and asks. */
  async function jobAsks(t: T, u: Users) {
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("orgSettings", {
        orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
        createdAt: now, updatedAt: now, createdBy: u.admin, agentActorUserId: u.admin,
      });
    });
    modelSlot.current = mockModel({
      contentSteps: [[askCall({ header: "Owner", question: "Who does it?", options: OPTIONS.slice(0, 2) })]],
    });
    const started = await t.action(internal.agentJobs.startAgentJob, {
      job: ASK_JOB.name, orgId: ORG, anchor: ANCHOR, input: "Prepare this email",
    });
    if (started.status !== "started") throw new Error("job did not start");
    const [question] = await t.run((ctx) => ctx.db.query("agentQuestions").collect());
    expect(question).toMatchObject({ askedUserId: u.admin, runId: started.runId });
    return { threadId: started.threadId, askingRunId: started.runId, questionId: question._id };
  }

  it("an admin who is not the designated actor answers → the same job continues as the answerer", async () => {
    const t = createT();
    const u = await setup(t);
    const { threadId, askingRunId, questionId } = await jobAsks(t, u);
    vi.useFakeTimers();
    const model = recordingModel({ content: [{ type: "text", text: "Continuing." }] });
    modelSlot.current = model;

    const { runId } = await t
      .withIdentity(IDENTITY.admin2)
      .mutation(api.agentQuestions.answer, { questionId, optionIndexes: [1] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      status: "succeeded", job: ASK_JOB.name, userId: u.admin2, actorIsAdmin: true, questionId,
    });
    // Same job: its instructions and tool list, not the system agent's.
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain("ASK-JOB-MARKER");
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual(["askUser", "listClients"]);
    expect((await runsOf(t, threadId)).map((r) => r._id).sort()).toEqual([askingRunId, runId].sort());
  });

  it("a non-admin cannot continue the job", async () => {
    const t = createT();
    const u = await setup(t);
    const { threadId, questionId } = await jobAsks(t, u);
    await expect(
      t.withIdentity(IDENTITY.alice).mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] }),
    ).rejects.toThrow(/Question not found/);
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
    expect(await runsOf(t, threadId)).toHaveLength(1);
  });

  it("the claim re-checks the answerer: demoted before it starts → fails closed", async () => {
    const t = createT();
    const u = await setup(t);
    const { threadId, questionId } = await jobAsks(t, u);
    vi.useFakeTimers();
    const active = await markRunning(t, threadId, u.admin);
    const { runId } = await t
      .withIdentity(IDENTITY.admin2)
      .mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    await t.mutation(internal.orgMembers.upsertMembership, {
      orgId: ORG, clerkUserId: IDENTITY.admin2.subject, role: "org:member",
    });
    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("failed");
    // The answer led nowhere → the question is open again.
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("pending");
  });

  it("a later job run on the thread is not offered settleQuestion", async () => {
    const t = createT();
    const u = await setup(t);
    const { questionId } = await jobAsks(t, u);
    const model = recordingModel({ content: [{ type: "text", text: "ok" }] });
    modelSlot.current = model;
    await t.action(internal.agentJobs.startAgentJob, {
      job: ASK_JOB.name, orgId: ORG, anchor: ANCHOR, input: "Prepare again",
    });
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name).sort()).toEqual(["askUser", "listClients"]);
    // (The question id may appear in history — the askUser tool result — but
    // never as the pending-question context.)
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).not.toContain(`Pending question (questionId: ${questionId}`);
  });

  it("listRuns flags the answer run so its queued line is hidden", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    await markRunning(t, threadId, u.admin);
    const { runId } = await t
      .withIdentity(IDENTITY.admin)
      .mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    const runs = await t.withIdentity(IDENTITY.admin).query(api.agentThreads.listRuns, { threadId });
    expect(runs.find((r) => r._id === runId)).toMatchObject({ answersQuestion: true });
    expect(runs.find((r) => r._id !== runId)).toMatchObject({ answersQuestion: false });
  });
});

// ─── An answer run that never starts reopens its question ────────────────────

describe("answer run lost before it starts", () => {
  it("start re-check fails → the question is pending again, the error stays", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    const active = await markRunning(t, threadId, u.admin);
    const { runId } = await t
      .withIdentity(IDENTITY.admin2)
      .mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    await t.mutation(internal.orgMembers.upsertMembership, {
      orgId: ORG, clerkUserId: IDENTITY.admin2.subject, role: "org:member",
    });
    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = (await t.run((ctx) => ctx.db.get(runId)))!;
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Queued run not started/);
    const question = (await t.run((ctx) => ctx.db.get(questionId)))!;
    expect(question.status).toBe("pending");
    expect(question.answer).toBeUndefined();
    expect(question.answeredBy).toBeUndefined();
    expect(question.answeredAt).toBeUndefined();
  });

  it("cancelled while queued → the question is pending again", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    await markRunning(t, threadId, u.admin);
    const admin2 = t.withIdentity(IDENTITY.admin2);
    const { runId } = await admin2.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [1] });
    await admin2.mutation(api.agentRunner.stopRun, { runId });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("cancelled");
    expect(await t.run((ctx) => ctx.db.get(questionId))).toMatchObject({ status: "pending" });
    // …and can be answered again.
    await admin2.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("answered");
  });

  it("stays answered when another question is pending by then", async () => {
    const t = createT();
    const u = await setup(t);
    const threadId = await mkThread(t, { owner: u.admin, visibility: "admins" });
    const questionId = await ask(t, threadId, u.admin);
    await markRunning(t, threadId, u.admin);
    const admin = t.withIdentity(IDENTITY.admin);
    const { runId } = await admin.mutation(api.agentQuestions.answer, { questionId, optionIndexes: [0] });
    await ask(t, threadId, u.admin, { header: "Owner" });
    await admin.mutation(api.agentRunner.stopRun, { runId });
    expect((await t.run((ctx) => ctx.db.get(questionId)))?.status).toBe("answered");
  });
});

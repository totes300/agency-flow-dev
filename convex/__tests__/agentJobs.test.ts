// @vitest-environment edge-runtime
//
// Agent job registry + system agents + designated agent actor
// (docs/prd-email-triage-implementation-plan.md §3 P2, phase A2b; E2):
//   - llm_step: structured output, one retry on a schema failure, audit row
//   - agent_run: system agent + anchored thread created once, then reused;
//     runs as the designated admin with only the job's tools / instructions /
//     maxSteps / model; fails closed without a valid actor; queues when busy
//   - system agents are hidden from rail, builder and picker queries
//   - job.model and agents.model reach resolveModel; a bad slug fails clearly

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, mockModel } from "@convex-dev/agent";
import { MockLanguageModelV3 } from "ai/test";
import agentComponentTest from "@convex-dev/agent/test";
import { z } from "zod";
import type { FunctionArgs, FunctionReference } from "convex/server";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { APICallError } from "ai";
import {
  getJobStages,
  LlmStepError,
  registerAgentJobForTesting,
  runLlmStep,
  validateAgentJob,
  type AgentRunJob,
  type LlmStepJob,
} from "../lib/agentJobs";
import { SYSTEM_AGENTS } from "../lib/systemAgents";
import { NO_AGENT_ACTOR_MESSAGE } from "../agentJobs";

// resolveModel → the component's mock model, recording the model override it
// was asked for. A set override is still parsed by the REAL resolver, so a bad
// slug throws exactly as in production.
const modelSlot = vi.hoisted(() => ({
  current: null as unknown,
  overrides: [] as Array<string | null>,
}));
vi.mock("../lib/worksheetAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/worksheetAi")>();
  return {
    ...actual,
    resolveModel: (apiKey?: string | null, model?: string | null) => {
      modelSlot.overrides.push(model ?? null);
      if (model) actual.resolveModel("sk-ant-test-key", model);
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

const ORG = "org_jobs";

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

type Users = { admin: Id<"users">; admin2: Id<"users">; alice: Id<"users"> };

async function setup(t: T, opts: { actor?: "admin" | "none" } = {}): Promise<Users> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const mkUser = async (name: string, externalId: string) =>
      await ctx.db.insert("users", { name, externalId, email: `${externalId}@x.test`, createdAt: now, updatedAt: now });
    const admin = await mkUser("Admin", "clerk_admin");
    const admin2 = await mkUser("Admin Two", "clerk_admin2");
    const alice = await mkUser("Alice", "clerk_alice");
    for (const [userId, clerkUserId, role] of [
      [admin, "clerk_admin", "admin"],
      [admin2, "clerk_admin2", "admin"],
      [alice, "clerk_alice", "member"],
    ] as const) {
      await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId, userId, role, joinedAt: now });
    }
    await ctx.db.insert("orgSettings", {
      orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15,
      createdAt: now, updatedAt: now, createdBy: admin,
      ...(opts.actor === "none" ? {} : { agentActorUserId: admin }),
    });
    await ctx.db.insert("clients", {
      orgId: ORG, name: "Arlow", currency: "EUR", createdAt: now, updatedAt: now, createdBy: admin,
    });
    return { admin, admin2, alice };
  });
}

/** The component's mock model, typed with the call logs it records. */
function recordingModel(args: Parameters<typeof mockModel>[0]) {
  const model = mockModel(args);
  return model as typeof model & {
    doStreamCalls: Array<Parameters<typeof model.doStream>[0]>;
    doGenerateCalls: Array<Parameters<typeof model.doGenerate>[0]>;
  };
}

/**
 * A structured-output model for llm_step tests: answers the i-th call with
 * texts[i] (the last one repeats). `ai/test`'s V3 mock, because llm_step goes
 * through plain `generateText`, which needs the V3 finish-reason shape.
 */
function structuredModel(texts: string[], finish: "stop" | "length" = "stop") {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const text = texts[Math.min(call++, texts.length - 1)];
      return {
        content: [{ type: "text", text }],
        finishReason: { unified: finish, raw: finish },
        usage: {
          inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/** A fake ActionCtx over convexTest — all `runLlmStep` needs. */
function actionCtx(t: T): ActionCtx {
  type Ref<K extends "query" | "mutation"> = FunctionReference<K, "public" | "internal">;
  const ctx = {
    runQuery: (ref: Ref<"query">, args: FunctionArgs<Ref<"query">>) => t.query(ref, args),
    runMutation: (ref: Ref<"mutation">, args: FunctionArgs<Ref<"mutation">>) => t.mutation(ref, args),
  };
  return ctx as unknown as ActionCtx;
}

const ANCHOR = { type: "emailThread", id: "et_1" };

const TRIAGE_JOB: AgentRunJob = {
  name: "test_triage",
  tier: "agent_run",
  systemAgentKey: "assistant",
  visibility: "admins",
  instructions: "JOB-INSTRUCTIONS-MARKER: triage the thread.",
  tools: ["listClients"],
  model: "anthropic/claude-haiku-4.5",
};
const ONE_STEP_JOB: AgentRunJob = {
  ...TRIAGE_JOB,
  name: "test_one_step",
  maxSteps: 1,
  model: undefined,
};
const PRIVATE_JOB: AgentRunJob = {
  ...TRIAGE_JOB,
  name: "test_private",
  visibility: "private",
  model: undefined,
};

const unregister: Array<() => void> = [];
beforeEach(() => {
  modelSlot.current = null;
  modelSlot.overrides = [];
  for (const job of [TRIAGE_JOB, ONE_STEP_JOB, PRIVATE_JOB]) {
    unregister.push(registerAgentJobForTesting(job));
  }
});
afterEach(() => {
  while (unregister.length) unregister.pop()!();
  vi.useRealTimers();
});

// ─── llm_step ────────────────────────────────────────────────────────────────

const CLASSIFY_JOB: LlmStepJob<{ intent: "question" | "request"; confidence: number }> = {
  name: "test_classify",
  tier: "llm_step",
  instructions: "Classify the message.",
  outputSchema: z.object({
    intent: z.enum(["question", "request"]),
    confidence: z.number(),
  }),
  model: "anthropic/claude-haiku-4.5",
};

async function jobRuns(t: T) {
  return await t.run((ctx) =>
    ctx.db.query("agentJobRuns").withIndex("by_orgId_job", (q) => q.eq("orgId", ORG)).collect(),
  );
}

describe("runLlmStep", () => {
  it("returns the validated structured output and records an audit row", async () => {
    const t = createT();
    await setup(t);
    const model = structuredModel(['{"intent":"request","confidence":0.9}']);
    modelSlot.current = model;

    const out = await runLlmStep(actionCtx(t), {
      job: CLASSIFY_JOB, orgId: ORG, input: { subject: "Can you add a banner?" }, anchor: ANCHOR,
    });
    expect(out).toEqual({ intent: "request", confidence: 0.9 });
    expect(model.doGenerateCalls).toHaveLength(1);
    // The job model reached resolveModel; the input became the prompt.
    expect(modelSlot.overrides).toEqual(["anthropic/claude-haiku-4.5"]);
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Can you add a banner?");
    expect(JSON.stringify(model.doGenerateCalls[0].prompt)).toContain("Classify the message.");

    const rows = await jobRuns(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orgId: ORG, job: "test_classify", tier: "llm_step", anchor: ANCHOR,
      status: "succeeded", attempts: 1, totalTokens: 13,
    });
    expect(rows[0].finishedAt).toBeGreaterThanOrEqual(rows[0].startedAt);
  });

  it("retries once on a schema failure and succeeds", async () => {
    const t = createT();
    await setup(t);
    const model = structuredModel(['{"intent":"maybe"}', '{"intent":"question","confidence":0.4}']);
    modelSlot.current = model;
    const out = await runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" });
    expect(out.intent).toBe("question");
    expect(model.doGenerateCalls).toHaveLength(2);
    expect((await jobRuns(t))[0]).toMatchObject({ status: "succeeded", attempts: 2, totalTokens: 26 });
  });

  it("fails with a clear error after the retry, and audits the failure", async () => {
    const t = createT();
    await setup(t);
    modelSlot.current = structuredModel(["Sure! It is a request."]);
    const run = runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" });
    await expect(run).rejects.toThrow(LlmStepError);
    await expect(
      runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/test_classify.*did not match the job's schema after 2 attempts/);
    const rows = await jobRuns(t);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 2, tier: "llm_step" });
    expect(rows[0].error).toMatch(/schema/);
  });

  it("without an AI key: no model call, a failed row with the reason", async () => {
    const t = createT();
    await setup(t);
    await expect(
      runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/No AI key is configured/);
    expect((await jobRuns(t))[0]).toMatchObject({ status: "failed", attempts: 0 });
  });

  it("an invalid or non-Claude job model fails clearly", async () => {
    const t = createT();
    await setup(t);
    modelSlot.current = structuredModel(["{}"]);
    await expect(
      runLlmStep(actionCtx(t), { job: { ...CLASSIFY_JOB, model: "gpt-5" }, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/not a Claude model/);
    await expect(
      runLlmStep(actionCtx(t), { job: { ...CLASSIFY_JOB, model: "openai/gpt-5" }, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/only Anthropic Claude models/);
  });

  it("an output cut off at the token limit fails at once as too long (no retry)", async () => {
    const t = createT();
    await setup(t);
    const model = structuredModel(['{"intent":"req'], "length");
    modelSlot.current = model;
    await expect(
      runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/output was too long/);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await jobRuns(t))[0]).toMatchObject({ status: "failed", attempts: 1, totalTokens: 13 });
  });

  it("makes exactly one provider call per attempt (SDK retries off)", async () => {
    const t = createT();
    await setup(t);
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new APICallError({
          message: "Overloaded", url: "https://api.test", requestBodyValues: {},
          statusCode: 529, isRetryable: true,
        });
      },
    });
    modelSlot.current = model;
    await expect(
      runLlmStep(actionCtx(t), { job: CLASSIFY_JOB, orgId: ORG, input: "hi" }),
    ).rejects.toThrow(/Overloaded/);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect((await jobRuns(t))[0]).toMatchObject({ status: "failed", attempts: 1 });
  });
});

// ─── agent_run ───────────────────────────────────────────────────────────────

async function systemAgents(t: T) {
  return await t.run((ctx) =>
    ctx.db.query("agents").withIndex("by_orgId_systemKey", (q) => q.eq("orgId", ORG).eq("systemKey", "assistant")).collect(),
  );
}
async function anchorThreads(t: T) {
  return await t.run((ctx) =>
    ctx.db
      .query("agentThreads")
      .withIndex("by_orgId_anchorType_anchorId_agentId_visibility_userId", (q) =>
        q.eq("orgId", ORG).eq("anchor.type", ANCHOR.type).eq("anchor.id", ANCHOR.id),
      )
      .collect(),
  );
}

describe("startAgentJob", () => {
  it("creates the system agent + anchored thread once, runs as the designated admin with the job's tools", async () => {
    const t = createT();
    const u = await setup(t);
    const model = recordingModel({
      contentSteps: [
        [{ type: "tool-call", toolCallId: "call_1", toolName: "listClients", input: "{}" }],
        [{ type: "text", text: "Read the clients." }],
      ],
    });
    modelSlot.current = model;

    const first = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage this email",
    });
    expect(first.status).toBe("started");
    if (first.status === "failed") throw new Error("unreachable");

    const agents = await systemAgents(t);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ name: SYSTEM_AGENTS.assistant.name, systemKey: "assistant" });
    const threads = await anchorThreads(t);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ _id: first.threadId, visibility: "admins", agentId: agents[0]._id, userId: u.admin });

    const run = await t.run((ctx) => ctx.db.get(first.runId));
    expect(run).toMatchObject({
      job: "test_triage", userId: u.admin, via: "background", actorIsAdmin: true, status: "succeeded",
    });
    // Only the JOB's tools (the system agent's default tools are wider).
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["listClients"]);
    // Agent base instructions + job instructions in the system prompt.
    const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(prompt).toContain("JOB-INSTRUCTIONS-MARKER");
    expect(prompt).toContain("You are the built-in assistant inside Agency Flow");
    expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain("Arlow");
    // job.model reached resolveModel.
    expect(modelSlot.overrides).toEqual(["anthropic/claude-haiku-4.5"]);

    // Second start on the same anchor reuses agent + thread.
    modelSlot.current = mockModel({ content: [{ type: "text", text: "Again." }] });
    const second = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage again",
    });
    expect(second.status).toBe("started");
    if (second.status === "failed") throw new Error("unreachable");
    expect(second.threadId).toBe(first.threadId);
    expect(await systemAgents(t)).toHaveLength(1);
    expect(await anchorThreads(t)).toHaveLength(1);
    expect(await jobRuns(t)).toHaveLength(0);
  });

  it("honours the job's maxSteps", async () => {
    const t = createT();
    await setup(t);
    const model = recordingModel({
      contentSteps: [
        [{ type: "tool-call", toolCallId: "call_1", toolName: "listClients", input: "{}" }],
        [{ type: "text", text: "never reached" }],
      ],
    });
    modelSlot.current = model;
    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_one_step", orgId: ORG, anchor: ANCHOR, input: "Go",
    });
    expect(res.status).toBe("started");
    expect(model.doStreamCalls).toHaveLength(1);
    // No job model → the agent's (unset) model → platform default.
    expect(modelSlot.overrides).toEqual([null]);
  });

  it("fails closed without a designated actor: failed job row, nothing runs", async () => {
    const t = createT();
    await setup(t, { actor: "none" });
    modelSlot.current = mockModel({ content: [{ type: "text", text: "should not run" }] });
    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage",
    });
    expect(res).toMatchObject({ status: "failed", error: NO_AGENT_ACTOR_MESSAGE });
    const rows = await jobRuns(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job: "test_triage", tier: "agent_run", status: "failed", anchor: ANCHOR, error: NO_AGENT_ACTOR_MESSAGE });
    expect(await t.run((ctx) => ctx.db.query("agentRuns").collect())).toHaveLength(0);
    expect(await anchorThreads(t)).toHaveLength(0);
    expect(modelSlot.overrides).toEqual([]);
  });

  it("fails closed when the designated actor is no longer an admin", async () => {
    const t = createT();
    const u = await setup(t);
    await t.run(async (ctx) => {
      const m = await ctx.db.query("orgMembers").withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", ORG).eq("clerkUserId", "clerk_admin")).unique();
      await ctx.db.patch(m!._id, { role: "member" });
    });
    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage",
    });
    expect(res.status).toBe("failed");
    if (res.status !== "failed") throw new Error("unreachable");
    expect(res.error).toContain(NO_AGENT_ACTOR_MESSAGE);
    expect(await t.run((ctx) => ctx.db.query("agentRuns").collect())).toHaveLength(0);

    // A removed member fails closed the same way.
    await t.run(async (ctx) => {
      const s = await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique();
      await ctx.db.patch(s!._id, { agentActorUserId: u.alice });
    });
    const again = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage",
    });
    expect(again.status).toBe("failed");
  });

  it("setAgentActorUser only accepts a current admin", async () => {
    const t = createT();
    const u = await setup(t, { actor: "none" });
    await expect(
      t.mutation(internal.agentJobs.setAgentActorUser, { orgId: ORG, userId: u.alice }),
    ).rejects.toThrow(/must be an admin/);
    await t.mutation(internal.agentJobs.setAgentActorUser, { orgId: ORG, userId: u.admin2 });
    const settings = await t.run((ctx) => ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique());
    expect(settings?.agentActorUserId).toBe(u.admin2);
    await t.mutation(internal.agentJobs.setAgentActorUser, { orgId: ORG, userId: null });
    const cleared = await t.run((ctx) => ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique());
    expect(cleared?.agentActorUserId).toBeUndefined();
  });

  it("a second start while one is running queues, then runs the job after it", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR,
    });
    if (!prepared.ok) throw new Error("prepare failed");
    // Another run is active on the thread.
    const active = await t.run(async (ctx) => {
      const thread = (await ctx.db.get(prepared.threadId))!;
      const runId = await ctx.db.insert("agentRuns", {
        orgId: ORG, threadId: thread._id, agentId: thread.agentId, userId: u.admin2,
        via: "user", status: "running", startedAt: Date.now(),
      });
      await ctx.db.patch(thread._id, { status: "running" });
      return runId;
    });
    const model = recordingModel({ content: [{ type: "text", text: "Queued answer." }] });
    modelSlot.current = model;

    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Queued triage",
    });
    expect(res.status).toBe("queued");
    if (res.status === "failed") throw new Error("unreachable");
    expect(await t.run((ctx) => ctx.db.get(res.runId))).toMatchObject({
      status: "queued", job: "test_triage", userId: u.admin, queuedMessage: "Queued triage",
    });
    expect(model.doStreamCalls).toHaveLength(0);

    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.run((ctx) => ctx.db.get(res.runId))).toMatchObject({ status: "succeeded", job: "test_triage" });
    // The claimed queued run is still a JOB run: job tools + instructions.
    expect(model.doStreamCalls).toHaveLength(1);
    expect((model.doStreamCalls[0].tools ?? []).map((tool) => tool.name)).toEqual(["listClients"]);
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain("JOB-INSTRUCTIONS-MARKER");
  });

  /** Prepare the job's thread, make it busy, and queue a job start on it. */
  async function queueJob(t: T, u: Users) {
    const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR,
    });
    if (!prepared.ok) throw new Error("prepare failed");
    const active = await t.run(async (ctx) => {
      const thread = (await ctx.db.get(prepared.threadId))!;
      const runId = await ctx.db.insert("agentRuns", {
        orgId: ORG, threadId: thread._id, agentId: thread.agentId, userId: u.admin2,
        via: "user", status: "running", startedAt: Date.now(),
      });
      await ctx.db.patch(thread._id, { status: "running" });
      return runId;
    });
    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Queued triage",
    });
    if (res.status !== "queued") throw new Error(`expected queued, got ${res.status}`);
    return { active, queuedRunId: res.runId };
  }

  it.each([
    ["switched to another admin", "admin2"],
    ["cleared", "none"],
  ] as const)("a queued job fails closed when the designated actor is %s before it starts", async (_label, next) => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    const model = recordingModel({ content: [{ type: "text", text: "should not run" }] });
    modelSlot.current = model;
    const { active, queuedRunId } = await queueJob(t, u);

    await t.run(async (ctx) => {
      const s = await ctx.db.query("orgSettings").withIndex("by_orgId", (q) => q.eq("orgId", ORG)).unique();
      await ctx.db.patch(s!._id, { agentActorUserId: next === "none" ? undefined : u.admin2 });
    });
    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const run = await t.run((ctx) => ctx.db.get(queuedRunId));
    expect(run).toMatchObject({ status: "failed", job: "test_triage", userId: u.admin });
    expect(run?.error).toContain(NO_AGENT_ACTOR_MESSAGE);
    if (next === "none") expect(run?.error).toBe(NO_AGENT_ACTOR_MESSAGE);
    expect(run?.errorHint).toMatch(/agent actor in Settings/);
    expect(model.doStreamCalls).toHaveLength(0);
  });

  it("a queued run whose job no longer exists fails with its own hint", async () => {
    vi.useFakeTimers();
    const t = createT();
    const u = await setup(t);
    modelSlot.current = recordingModel({ content: [{ type: "text", text: "should not run" }] });
    const { active, queuedRunId } = await queueJob(t, u);
    // The job is removed from code while its row waits.
    while (unregister.length) unregister.pop()!();
    await t.mutation(internal.agentRunner.finishRun, { runId: active, status: "succeeded" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const run = await t.run((ctx) => ctx.db.get(queuedRunId));
    expect(run).toMatchObject({ status: "failed", errorHint: "This job no longer exists" });
    expect(run?.error).toMatch(/unknown agent job "test_triage"/);
  });

  it("a background job start must act as the current designated actor", async () => {
    const t = createT();
    const u = await setup(t);
    const prepared = await t.mutation(internal.agentJobs.prepareAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR,
    });
    if (!prepared.ok) throw new Error("prepare failed");
    await expect(
      t.mutation(internal.agentRunner.beginBackgroundRun, {
        threadId: prepared.threadId, actingUserId: u.admin2, message: "Go", job: "test_triage",
      }),
    ).rejects.toThrow(/No agent actor configured.*changed/);
    expect(await t.run((ctx) => ctx.db.query("agentRuns").collect())).toHaveLength(0);
  });

  it("a private job runs as the named owner in their own thread; admins jobs refuse an owner", async () => {
    const t = createT();
    const u = await setup(t);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "Hi Alice." }] });
    const res = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_private", orgId: ORG, anchor: { type: "task", id: "task_1" }, input: "Help", ownerUserId: u.alice,
    });
    expect(res.status).toBe("started");
    if (res.status === "failed") throw new Error("unreachable");
    expect(await t.run((ctx) => ctx.db.get(res.runId))).toMatchObject({ userId: u.alice, actorIsAdmin: false, status: "succeeded" });
    expect(await t.run((ctx) => ctx.db.get(res.threadId))).toMatchObject({ userId: u.alice, visibility: "private" });

    await expect(
      t.action(internal.agentJobs.startAgentJob, {
        job: "test_private", orgId: ORG, anchor: { type: "task", id: "task_1" }, input: "Help",
      }),
    ).rejects.toThrow(/needs the thread owner/);
    await expect(
      t.action(internal.agentJobs.startAgentJob, {
        job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Help", ownerUserId: u.alice,
      }),
    ).rejects.toThrow(/only accepted for private jobs/);
    await expect(
      t.action(internal.agentJobs.startAgentJob, { job: "nope", orgId: ORG, anchor: ANCHOR, input: "Help" }),
    ).rejects.toThrow(/Unknown agent_run job/);
  });

  it("registering a job with an unknown or interactive-only tool or a bad model throws; other tools are fine (A7)", () => {
    expect(() => registerAgentJobForTesting({ ...TRIAGE_JOB, name: "bad1", tools: ["sudo"] })).toThrow(/unknown tool/);
    // Connector tools are interactive-only: a job run could never use them.
    expect(() => registerAgentJobForTesting({ ...TRIAGE_JOB, name: "bad2", tools: ["echo"] })).toThrow(/interactive-only/);
    // Every registry tool runs on the actor path now — formerly ctx.auth-only ones too.
    const unregister = registerAgentJobForTesting({
      ...TRIAGE_JOB, name: "any_tool", tools: ["countTasksByStatus", "collectOrgFinanceSnapshot", "createSheet"],
    });
    unregister();
    expect(() => registerAgentJobForTesting({ ...TRIAGE_JOB, name: "bad3", model: "openai/gpt-5" })).toThrow(/Claude/);
  });

  it("stages have one source (JOB_STAGES), and must fit the job's tools", () => {
    // Not in JOB_STAGES → no stages; the job type has no `stages` field at all.
    expect(getJobStages("test_triage")).toEqual([]);
    expect(() => validateAgentJob(TRIAGE_JOB, [{ key: "read", label: "Reading", tools: ["listClients"] }])).not.toThrow();
    expect(() => validateAgentJob(TRIAGE_JOB, [{ key: "x", label: "X", tools: ["findTasks"] }])).toThrow(/doesn't have/);
    expect(() =>
      validateAgentJob(TRIAGE_JOB, [
        { key: "a", label: "A", tools: [] },
        { key: "a", label: "A2", tools: [] },
      ]),
    ).toThrow(/duplicate stage/);
    expect(() => validateAgentJob(CLASSIFY_JOB, [{ key: "a", label: "A", tools: [] }])).toThrow(/no stages/);
  });
});

// ─── System agents hidden ────────────────────────────────────────────────────

describe("system agents", () => {
  it("are hidden from the rail, the builder and the picker, and locked", async () => {
    const t = createT();
    const u = await setup(t);
    const agentId = await t.mutation(internal.agentJobs.ensureSystemAgent, { orgId: ORG, key: "assistant" });
    // The system thread is owned by the admin (the designated actor).
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const started = await t.action(internal.agentJobs.startAgentJob, {
      job: "test_triage", orgId: ORG, anchor: ANCHOR, input: "Triage",
    });
    const userAgent = await t.run(async (ctx) => {
      const now = Date.now();
      return await ctx.db.insert("agents", {
        orgId: ORG, name: "User agent", description: "", instructions: "Hi.", tools: [],
        runPermission: "everyone", trigger: "manual", createdBy: u.admin, createdAt: now, updatedAt: now,
      });
    });
    const admin = t.withIdentity(IDENTITY.admin);
    const alice = t.withIdentity(IDENTITY.alice);

    for (const viewer of [admin, alice]) {
      expect((await viewer.query(api.agents.listRunnable, {})).map((a) => a._id)).toEqual([userAgent]);
      expect(await viewer.query(api.agents.get, { agentId })).toBeNull();
      await expect(viewer.mutation(api.agentThreads.create, { agentId })).rejects.toThrow(/Agent not found/);
    }
    expect((await admin.query(api.agents.listAll, {})).map((a) => a._id)).toEqual([userAgent]);
    expect((await admin.query(api.agents.listAll, { includeSystem: true })).map((a) => a._id).sort()).toEqual(
      [agentId, userAgent].sort(),
    );
    expect((await admin.query(api.agents.listWithSkills, {})).map((a) => a._id)).toEqual([userAgent]);
    expect(await admin.query(api.agents.getForEdit, { agentId })).toBeNull();
    // The rail's Recent list leaves the system thread out, even for its owner.
    expect(await admin.query(api.agentThreads.listMine, {})).toEqual([]);
    // The audit view still shows the system agent's run.
    if (started.status === "failed") throw new Error("unreachable");
    const audit = await admin.query(api.agentAudit.listRuns, {});
    expect(audit.map((r) => r._id)).toContain(started.runId);

    await expect(admin.mutation(api.agents.archive, { agentId })).rejects.toThrow(/System agents/);
    await expect(admin.mutation(api.agents.restore, { agentId })).rejects.toThrow(/System agents/);
    await expect(admin.mutation(api.agents.setSkills, { agentId, skillIds: [] })).rejects.toThrow(/System agents/);
    await expect(
      admin.mutation(api.agents.update, {
        agentId, name: "Hijack", description: "", instructions: "x", tools: [], skillIds: [], runPermission: "everyone",
      }),
    ).rejects.toThrow(/System agents/);
  });

  it("ensureSystemAgent is idempotent and re-syncs a drifted row to the code definition", async () => {
    const t = createT();
    await setup(t);
    const a = await t.mutation(internal.agentJobs.ensureSystemAgent, { orgId: ORG, key: "assistant" });
    await t.run((ctx) => ctx.db.patch(a, { instructions: "drifted", archivedAt: 1 }));
    const b = await t.mutation(internal.agentJobs.ensureSystemAgent, { orgId: ORG, key: "assistant" });
    expect(b).toBe(a);
    const row = await t.run((ctx) => ctx.db.get(a));
    expect(row).toMatchObject({ instructions: SYSTEM_AGENTS.assistant.instructions, tools: SYSTEM_AGENTS.assistant.tools });
    expect(row?.archivedAt).toBeUndefined();
    await expect(t.mutation(internal.agentJobs.ensureSystemAgent, { orgId: ORG, key: "nope" })).rejects.toThrow(/Unknown system agent/);
  });
});

// ─── agents.model ────────────────────────────────────────────────────────────

describe("agents.model", () => {
  async function userAgentThread(t: T, owner: Id<"users">, model: string) {
    return await t.run(async (ctx) => {
      const now = Date.now();
      const agentId = await ctx.db.insert("agents", {
        orgId: ORG, name: "Modelled", description: "", instructions: "Be brief.", tools: ["listClients"],
        runPermission: "everyone", trigger: "manual", model, createdBy: owner, createdAt: now, updatedAt: now,
      });
      const componentThreadId = await createThread(ctx, components.agent, { userId: owner });
      return await ctx.db.insert("agentThreads", {
        orgId: ORG, componentThreadId, agentId, userId: owner, title: "New chat", status: "idle",
        lastActivityAt: now, createdAt: now,
      });
    });
  }

  it("reaches resolveModel for a plain run", async () => {
    const t = createT();
    const u = await setup(t);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "ok" }] });
    const threadId = await userAgentThread(t, u.alice, "anthropic/claude-opus-4.1");
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.alice, message: "hi" });
    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe("succeeded");
    expect(modelSlot.overrides).toEqual(["anthropic/claude-opus-4.1"]);
  });

  it("a bad slug fails the run with a clear hint instead of crashing", async () => {
    const t = createT();
    const u = await setup(t);
    modelSlot.current = mockModel({ content: [{ type: "text", text: "unused" }] });
    const threadId = await userAgentThread(t, u.alice, "gpt-5");
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: u.alice, message: "hi" });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "failed" });
    expect(run?.error).toMatch(/not a Claude model/);
    expect(run?.errorHint).toMatch(/agent builder/);
  });

  it("the builder rejects an unparseable model slug", async () => {
    const t = createT();
    await setup(t);
    await expect(
      t.withIdentity(IDENTITY.admin).mutation(api.agents.create, {
        name: "Bad model", description: "d", instructions: "Do things.", tools: [], skillIds: [],
        runPermission: "everyone", model: "not a model",
      }),
    ).rejects.toThrow(/not a Claude model/);
    await expect(
      t.withIdentity(IDENTITY.admin).mutation(api.agents.create, {
        name: "Other provider", description: "d", instructions: "Do things.", tools: [], skillIds: [],
        runPermission: "everyone", model: "openai/gpt-5",
      }),
    ).rejects.toThrow(/only Anthropic Claude models/);
  });
});

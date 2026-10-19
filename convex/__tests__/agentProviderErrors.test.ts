// @vitest-environment edge-runtime
//
// A provider rejection mid-run (credit balance, invalid key …) settles as a
// clean, classified in-thread error block — never a raw stack — and the
// error never reaches the component's delta stream (where the client stream
// reader would re-throw it as "Uncaught Error: … at node_modules/ai/…").

import { beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { createThread, listStreams, mockModel } from "@convex-dev/agent";
import agentComponentTest from "@convex-dev/agent/test";
import { APICallError } from "ai";
import schema from "../schema";
import { api, components, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";

const modelSlot = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../lib/worksheetAi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/worksheetAi")>();
  return {
    ...actual,
    resolveModel: () => {
      if (!modelSlot.current) throw new actual.WorksheetAiUnavailableError("no mock model set");
      if (modelSlot.current instanceof Error) throw modelSlot.current;
      return modelSlot.current;
    },
  };
});

const modules = (
  import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }
).glob("../**/*.ts");

const ORG = "org_provider_errors";
const CREDIT =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

const createT = () => {
  const t = convexTest(schema, modules);
  agentComponentTest.register(t);
  return t;
};
type T = ReturnType<typeof createT>;

async function setup(t: T): Promise<{ admin: Id<"users">; threadId: Id<"agentThreads"> }> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const admin = await ctx.db.insert("users", { name: "Admin", externalId: "clerk_admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("orgMembers", { orgId: ORG, clerkUserId: "clerk_admin", userId: admin, role: "admin", joinedAt: now });
    await ctx.db.insert("orgSettings", {
      orgId: ORG, defaultCurrency: "EUR", timezone: "UTC", roundingMinutes: 15, createdAt: now, updatedAt: now, createdBy: admin,
    });
    const agentId = await ctx.db.insert("agents", {
      orgId: ORG, name: "Tester", description: "", instructions: "Be brief.", tools: [],
      runPermission: "everyone", trigger: "manual", createdBy: admin, createdAt: now, updatedAt: now,
    });
    const componentThreadId = await createThread(ctx, components.agent, { userId: admin });
    const threadId = await ctx.db.insert("agentThreads", {
      orgId: ORG, componentThreadId, agentId, userId: admin, title: "New chat", status: "idle",
      lastActivityAt: now, createdAt: now,
    });
    return { admin, threadId };
  });
}

/** A model whose stream call is rejected by the provider. */
function rejectingModel(error: unknown) {
  return mockModel({
    doGenerate: async () => {
      throw error;
    },
    doStream: async () => {
      throw error;
    },
  });
}

function providerError(statusCode: number, type: string, message: string) {
  return new APICallError({
    message,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
    responseBody: JSON.stringify({ type: "error", error: { type, message } }),
    isRetryable: false,
  });
}

beforeEach(() => {
  modelSlot.current = null;
});

describe("provider errors settle as classified error blocks", () => {
  it("credit balance too low: clean message + top-up hint, thread continuable", async () => {
    const t = createT();
    const { threadId } = await setup(t);
    modelSlot.current = rejectingModel(providerError(400, "invalid_request_error", CREDIT));

    const { runId } = await t
      .withIdentity({ subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" })
      .action(api.agentRunner.startRun, { threadId, message: "hi" });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "failed", error: "The AI provider has no credit left." });
    expect(run?.errorHint).toContain("Top up the key");
    expect(run?.error).not.toMatch(/Uncaught|node_modules|\bat\s/);
    expect((await t.run((ctx) => ctx.db.get(threadId)))?.status).toBe("error");

    // Nothing in the delta stream carries an `error` chunk for the client to re-throw.
    const thread = (await t.run((ctx) => ctx.db.get(threadId)))!;
    const parts = await t.run(async (ctx) => {
      const streams = await listStreams(ctx, components.agent, {
        threadId: thread.componentThreadId,
        includeStatuses: ["streaming", "finished", "aborted"],
      });
      if (streams.length === 0) return [];
      const deltas = await ctx.runQuery(components.agent.streams.listDeltas, {
        threadId: thread.componentThreadId,
        cursors: streams.map((s) => ({ streamId: s.streamId, cursor: 0 })),
      });
      return deltas.flatMap((d) => d.parts as Array<{ type?: string }>);
    });
    expect(parts.filter((p) => p.type === "error")).toEqual([]);
    await t.finishAllScheduledFunctions(() => {});
  });

  it("an invalid key in a background run gets the key hint", async () => {
    const t = createT();
    const { admin, threadId } = await setup(t);
    modelSlot.current = rejectingModel(providerError(401, "authentication_error", "invalid x-api-key"));
    const { runId } = await t.action(internal.agentBackground.start, { threadId, actingUserId: admin, message: "hi" });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "failed", error: "The AI provider rejected the API key." });
    await t.finishAllScheduledFunctions(() => {});
  });

  it("a non-model error is never classified as a provider error, even if it reads like one", async () => {
    const t = createT();
    const { threadId } = await setup(t);
    modelSlot.current = new Error(`Uncaught Error: ${CREDIT}\n    at resolve (convex/lib/x.ts:1:1)`);
    const { runId } = await t
      .withIdentity({ subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" })
      .action(api.agentRunner.startRun, { threadId, message: "hi" });
    expect(await t.run((ctx) => ctx.db.get(runId))).toMatchObject({
      status: "failed",
      error: CREDIT,
      errorHint: "You can send a follow-up message in this thread to retry.",
    });
  });

  it("a Stop that raced the provider error settles the run as cancelled", async () => {
    const t = createT();
    const { threadId } = await setup(t);
    modelSlot.current = mockModel({
      doGenerate: async () => {
        throw new Error("unused");
      },
      doStream: async () => {
        await t.run(async (ctx) => {
          const run = (await ctx.db.query("agentRuns").collect())[0];
          await ctx.db.patch(run._id, { cancelRequested: true });
        });
        throw providerError(400, "invalid_request_error", CREDIT);
      },
    });
    const { runId } = await t
      .withIdentity({ subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" })
      .action(api.agentRunner.startRun, { threadId, message: "hi" });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({ status: "cancelled" });
    expect(run?.error).toBeUndefined();
    await t.finishAllScheduledFunctions(() => {});
  });

  it("a generic failure keeps its message without stack frames", async () => {
    const t = createT();
    const { threadId } = await setup(t);
    modelSlot.current = rejectingModel(new Error("Uncaught Error: model exploded\n    at x (node_modules/ai/dist/index.mjs:1:1)"));
    const { runId } = await t
      .withIdentity({ subject: "clerk_admin", orgId: ORG, orgRole: "org:admin" })
      .action(api.agentRunner.startRun, { threadId, message: "hi" });
    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run).toMatchObject({
      status: "failed",
      error: "model exploded",
      errorHint: "You can send a follow-up message in this thread to retry.",
    });
    await t.finishAllScheduledFunctions(() => {});
  });
});

import { v, ConvexError } from "convex/values";
import { gateway, type LanguageModel } from "ai";
import { Agent, stepCountIs } from "@convex-dev/agent";
import { action, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { requireOwnedThread, UNTITLED_THREAD } from "./agentThreads";
import { getToolsForAgent } from "./lib/agentToolRegistry";
import {
  resolveModel,
  WorksheetAiUnavailableError,
} from "./lib/worksheetAi";

/**
 * Agent Runtime (PRD module 1) — everything between "user sends a message"
 * and "blocks appear".
 *
 * `startRun` is a PUBLIC ACTION invoked directly by the client (not via
 * the scheduler) so `ctx.auth` inside the whole run — including every
 * tool's `ctx.runQuery` — carries the running user's identity. That is
 * D6 (permission intersection) implemented structurally: wrapped domain
 * functions re-run their own `getAuthContext`/`requireAdmin` per call.
 *
 * Streaming: `saveStreamDeltas` persists prose deltas through the
 * component; the UI subscribes reactively via `agentThreads.listMessages`
 * (+ `useUIMessages`), so nothing depends on this action's return value.
 */

/** Max tool-loop steps per response cycle (tracer-scale; revisit later). */
const MAX_STEPS = 5;

const TITLE_MAX_LEN = 60;

/** Derive the thread's auto-title from its first user message. */
function deriveTitle(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TITLE_MAX_LEN) return oneLine || UNTITLED_THREAD;
  return `${oneLine.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…`;
}

// ─── Run lifecycle (internal mutations, auth re-checked inside) ─────────────

/**
 * Validate + open a run. Runs INSIDE the caller's auth context (internal
 * mutations invoked via ctx.runMutation inherit the action's identity),
 * and re-checks everything so the action layer can't be mis-trusted:
 * thread ownership, agent run permission, no concurrent run.
 */
export const beginRun = internalMutation({
  args: {
    // Plain string — arrives from the URL via the composer; normalized here.
    threadId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const threadId = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!threadId) throw new ConvexError("Thread not found");
    const thread = await requireOwnedThread(ctx, auth, threadId);
    if (thread.status === "running") {
      throw new ConvexError("A run is already in progress on this thread");
    }
    const agent = await ctx.db.get(thread.agentId);
    if (!agent || agent.orgId !== auth.orgId) {
      throw new ConvexError("Agent not found");
    }
    if (agent.archivedAt) {
      throw new ConvexError("This agent has been archived");
    }
    if (agent.runPermission === "admins" && !auth.isAdmin) {
      throw new ConvexError("You don't have permission to run this agent");
    }

    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      orgId: auth.orgId,
      threadId: thread._id,
      agentId: agent._id,
      userId: auth.userId,
      status: "running",
      startedAt: now,
    });
    await ctx.db.patch(thread._id, {
      status: "running",
      lastActivityAt: now,
      // First message auto-titles the thread (US: auto-generated titles).
      ...(thread.title === UNTITLED_THREAD
        ? { title: deriveTitle(args.message) }
        : {}),
    });

    return {
      runId,
      componentThreadId: thread.componentThreadId,
      userId: auth.userId,
      isAdmin: auth.isAdmin,
      agent: {
        name: agent.name,
        instructions: agent.instructions,
        tools: agent.tools,
      },
    };
  },
});

/** Accumulate per-step token usage onto the run row (usageHandler target). */
export const recordUsage = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    inputTokens: v.number(),
    outputTokens: v.number(),
    totalTokens: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    await ctx.db.patch(args.runId, {
      inputTokens: (run.inputTokens ?? 0) + args.inputTokens,
      outputTokens: (run.outputTokens ?? 0) + args.outputTokens,
      totalTokens: (run.totalTokens ?? 0) + args.totalTokens,
    });
  },
});

/** Close a run and settle the thread status. */
export const finishRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: now,
      error: args.error,
    });
    const thread = await ctx.db.get(run.threadId);
    if (thread) {
      await ctx.db.patch(run.threadId, {
        status: args.status === "failed" ? "error" : "idle",
        lastActivityAt: now,
      });
    }
  },
});

// ─── The runner action ──────────────────────────────────────────────────────

export const startRun = action({
  args: {
    threadId: v.string(),
    message: v.string(),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const trimmed = args.message.trim();
    if (!trimmed) throw new ConvexError("Message is empty");

    // Permission gate + run row + thread status, all in one transaction.
    const run = await ctx.runMutation(internal.agentRunner.beginRun, {
      threadId: args.threadId,
      message: trimmed,
    });

    try {
      // Phase 9 BYOK chain: per-org key → gateway env → direct env.
      // Throws WorksheetAiUnavailableError when nothing is configured.
      const orgKey = await ctx.runQuery(
        internal.aiIntegration.loadDecryptedKeyForRun,
        {},
      );
      // resolveModel returns a bare gateway slug on the gateway path;
      // the component requires a LanguageModel instance, so wrap it.
      const resolved = resolveModel(orgKey);
      const languageModel: LanguageModel =
        typeof resolved === "string" ? gateway(resolved) : resolved;

      const { tools, dropped } = getToolsForAgent(
        run.agent.tools,
        run.isAdmin,
      );
      if (dropped.length > 0) {
        console.warn(
          `[agentRunner] Agent references unknown tools: ${dropped.join(", ")}`,
        );
      }

      const agent = new Agent(components.agent, {
        name: run.agent.name,
        languageModel,
        instructions: run.agent.instructions,
        tools,
        stopWhen: stepCountIs(MAX_STEPS),
        usageHandler: async (handlerCtx, { usage }) => {
          await handlerCtx.runMutation(internal.agentRunner.recordUsage, {
            runId: run.runId,
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          });
        },
      });

      const result = await agent.streamText(
        ctx,
        { threadId: run.componentThreadId, userId: run.userId },
        { prompt: trimmed },
        { saveStreamDeltas: true },
      );
      // Drain the stream so the action stays alive until the response
      // (including tool steps) fully lands in the component's storage.
      await result.consumeStream();

      await ctx.runMutation(internal.agentRunner.finishRun, {
        runId: run.runId,
        status: "succeeded",
      });
      return { runId: run.runId };
    } catch (err) {
      const message =
        err instanceof WorksheetAiUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      await ctx.runMutation(internal.agentRunner.finishRun, {
        runId: run.runId,
        status: "failed",
        error: message.slice(0, 500),
      });
      if (err instanceof WorksheetAiUnavailableError) {
        throw new ConvexError(
          "No AI key configured. Add one in Settings → Integrations.",
        );
      }
      throw new ConvexError(
        "The agent run failed. Check the thread and try again.",
      );
    }
  },
});

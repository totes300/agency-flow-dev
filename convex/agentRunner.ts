import { v, ConvexError } from "convex/values";
import { z } from "zod";
import { gateway, type LanguageModel, type Tool } from "ai";
import {
  Agent,
  abortStream,
  createTool,
  listStreams,
  saveMessage,
  stepCountIs,
} from "@convex-dev/agent";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { getAuthContext } from "./lib/auth";
import { requireOwnedThread, UNTITLED_THREAD } from "./agentThreads";
import { getToolsForAgent } from "./lib/agentToolRegistry";
import {
  assembleSkillPrompt,
  matchClientForRun,
  resolveSkills,
  STOP_CONDITION_TOOL_NAME,
  type ResolvableSkill,
} from "../lib/agents/skills";
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
 *
 * Also SAVES the user message here (not in the action): the message lands
 * transactionally with the run row, appears in the thread immediately, and
 * survives a later failure (e.g. missing AI key) so the error block has
 * its question above it.
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

    // ─── Skills (slice 04) ───────────────────────────────────────────────
    // Resolve the agent's attached skills for THIS run: global skills always
    // load; client-scoped skills load only when the opening message names
    // their client. Ordering + prompt assembly are the pure lib/agents/skills.
    const skills = await loadAgentSkills(ctx, auth.orgId, agent.skillIds ?? []);
    let clientId: string | null = null;
    if (skills.some((s) => s.scope === "client")) {
      const clients = await ctx.db
        .query("clients")
        .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
        .collect();
      clientId = matchClientForRun(
        args.message,
        clients
          .filter((c) => !c.archivedAt)
          .map((c) => ({ _id: c._id, name: c.name, prefix: c.prefix })),
      );
    }
    const resolved = resolveSkills(skills, clientId);
    const skillPrompt = assembleSkillPrompt(resolved);
    const instructions = skillPrompt
      ? `${agent.instructions}\n\n${skillPrompt}`
      : agent.instructions;

    // Save the user message FIRST, so its component _creationTime precedes the
    // run's startedAt — the "skill loaded" notes then sort AFTER the question
    // and before the answer in the thread timeline.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: thread.componentThreadId,
      userId: auth.userId,
      prompt: args.message,
    });

    const now = Date.now();
    const runId = await ctx.db.insert("agentRuns", {
      orgId: auth.orgId,
      threadId: thread._id,
      agentId: agent._id,
      userId: auth.userId,
      status: "running",
      startedAt: now,
      ...(resolved.loaded.length > 0
        ? {
            loadedSkills: resolved.loaded.map((s) => ({
              name: s.name,
              isStopCondition: s.isStopCondition,
            })),
          }
        : {}),
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
      promptMessageId: messageId,
      componentThreadId: thread.componentThreadId,
      userId: auth.userId,
      isAdmin: auth.isAdmin,
      agent: {
        name: agent.name,
        instructions,
        tools: agent.tools,
      },
      // The runner adds the stop tool + honours halts only when a loaded skill
      // declares a stop-condition.
      hasStopConditions: resolved.stopConditions.length > 0,
    };
  },
});

/**
 * Fetch an agent's attached skills as resolver input (slice 04). Skips any
 * archived or cross-org id defensively — an attachment must never smuggle a
 * foreign or dead skill into a run's prompt.
 */
async function loadAgentSkills(
  ctx: MutationCtx,
  orgId: string,
  skillIds: Id<"skills">[],
): Promise<ResolvableSkill[]> {
  const skills: ResolvableSkill[] = [];
  for (const skillId of skillIds) {
    const skill = await ctx.db.get(skillId);
    if (!skill || skill.orgId !== orgId || skill.archivedAt) continue;
    skills.push({
      _id: skill._id,
      name: skill.name,
      instruction: skill.instruction,
      scope: skill.scope,
      clientId: skill.clientId ?? null,
      isStopCondition: skill.isStopCondition,
      createdAt: skill.createdAt,
    });
  }
  return skills;
}

/**
 * The stop tool, built per-run so its `execute` closes over the run id (the
 * component's tool ctx exposes the thread, not the run). The model calls it
 * when a loaded stop-condition fires; it records the halt on the run row and
 * the loop aborts at the next step boundary (see `getRunControl`).
 */
function makeStopConditionTool(runId: Id<"agentRuns">): Tool {
  return createTool({
    description:
      "Halt this run because a loaded stop-condition skill was met. Call this " +
      "the moment a stop-condition applies; provide the skill's name and a " +
      "one-sentence reason. The run stops immediately — do NOT also write a " +
      "summary, a table, or any other output.",
    inputSchema: z.object({
      skillName: z
        .string()
        .describe("The name of the stop-condition skill that fired"),
      reason: z
        .string()
        .describe("One sentence: why the stop-condition applies"),
    }),
    execute: async (toolCtx, input): Promise<{ halted: true }> => {
      await toolCtx.runMutation(internal.agentRunner.raiseStopCondition, {
        runId,
        skillName: input.skillName,
        reason: input.reason,
      });
      return { halted: true };
    },
  });
}

/**
 * Run control flags read by the loop between steps: the user-Stop flag and
 * the skill stop-condition (set by `raiseStopCondition`). Either aborts the
 * stream before the next model call; the two settle to different statuses.
 */
export const getRunControl = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    return {
      cancelRequested: run?.cancelRequested === true,
      stoppedBySkill: run?.stoppedBySkill ?? null,
    };
  },
});

/**
 * Record a skill stop-condition hit on the run (called by the flagStopCondition
 * tool during a step). The loop reads it in onStepFinish and aborts; the run
 * settles as `stopped_by_skill`. No-op if the run already left "running".
 */
export const raiseStopCondition = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    skillName: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running" || run.stoppedBySkill) return;
    await ctx.db.patch(args.runId, {
      stoppedBySkill: {
        skillName: args.skillName.slice(0, 120),
        reason: args.reason.slice(0, 500),
      },
    });
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
      v.literal("stopped_by_skill"),
    ),
    error: v.optional(v.string()),
    errorHint: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: args.status,
      finishedAt: now,
      error: args.error,
      errorHint: args.errorHint,
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

    // Permission gate + run row + user message + thread status, all in one
    // transaction. Validation failures throw BEFORE anything is recorded —
    // those still surface as a toast; anything after this settles as an
    // in-thread error block instead of a rejected promise.
    const run = await ctx.runMutation(internal.agentRunner.beginRun, {
      threadId: args.threadId,
      message: trimmed,
    });

    // Cooperative Stop (PRD error/stop model): stopRun sets a flag on the
    // run row; we re-check it after every step and abort before the next
    // model call. Mid-prose stops are covered separately — stopRun also
    // aborts the component's delta stream, which the DeltaStreamer detects
    // on its next write and aborts this same signal.
    const cancel = new AbortController();
    const checkControl = () =>
      ctx.runQuery(internal.agentRunner.getRunControl, {
        runId: run.runId,
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

      // The stop tool exists only when a loaded skill declares a
      // stop-condition — otherwise the model has no way (and no reason) to
      // halt the run itself.
      const agentTools: Record<string, Tool> = { ...tools };
      if (run.hasStopConditions) {
        agentTools[STOP_CONDITION_TOOL_NAME] = makeStopConditionTool(run.runId);
      }

      const agent = new Agent(components.agent, {
        name: run.agent.name,
        languageModel,
        instructions: run.agent.instructions,
        tools: agentTools,
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
        {
          promptMessageId: run.promptMessageId,
          abortSignal: cancel.signal,
          // Runs AFTER the component saved the step's messages — partial
          // output is already persisted when we pull the plug here.
          onStepFinish: async () => {
            if (cancel.signal.aborted) return;
            const ctl = await checkControl();
            if (ctl.cancelRequested || ctl.stoppedBySkill) cancel.abort();
          },
        },
        { saveStreamDeltas: true },
      );
      // Drain the stream so the action stays alive until the response
      // (including tool steps) fully lands in the component's storage.
      await result.consumeStream();

      // The mid-prose stop path aborts the streamer, not our signal — ask
      // the DB, not the controller, how this run ended. A skill stop-condition
      // outranks a user Stop when both somehow raced.
      const ctl = await checkControl();
      const status = ctl.stoppedBySkill
        ? "stopped_by_skill"
        : cancel.signal.aborted || ctl.cancelRequested
          ? "cancelled"
          : "succeeded";
      await ctx.runMutation(internal.agentRunner.finishRun, {
        runId: run.runId,
        status,
      });
      return { runId: run.runId };
    } catch (err) {
      // An abort that escapes as an exception is a deliberate halt — a skill
      // stop-condition or a user Stop, not a failure.
      const ctl = await checkControl();
      if (ctl.stoppedBySkill || ctl.cancelRequested) {
        await ctx.runMutation(internal.agentRunner.finishRun, {
          runId: run.runId,
          status: ctl.stoppedBySkill ? "stopped_by_skill" : "cancelled",
        });
        return { runId: run.runId };
      }
      const aiUnavailable = err instanceof WorksheetAiUnavailableError;
      const message = aiUnavailable
        ? "No AI key is configured for this organization."
        : err instanceof Error
          ? err.message
          : "Unknown error";
      // Settle as an in-thread error block (agentThreads.listRuns) rather
      // than a rejected promise — the thread stays continuable.
      await ctx.runMutation(internal.agentRunner.finishRun, {
        runId: run.runId,
        status: "failed",
        error: message.slice(0, 500),
        errorHint: aiUnavailable
          ? "Add an Anthropic API key in Settings → Integrations, then try again."
          : "You can send a follow-up message in this thread to retry.",
      });
      return { runId: run.runId };
    }
  },
});

/**
 * Stop the active run (owner-only). Two levers, per the PRD's cooperative
 * model: (1) the cancel flag — the loop checks it between steps; (2) abort
 * the component's live delta stream so mid-prose generation halts on its
 * next delta write instead of finishing the step. Partial output stays;
 * the thread returns to idle when the runner action settles.
 */
export const stopRun = mutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== auth.orgId || run.userId !== auth.userId) {
      throw new ConvexError("Run not found");
    }
    if (run.status !== "running" || run.cancelRequested) return null;
    await ctx.db.patch(run._id, { cancelRequested: true });

    const thread = await ctx.db.get(run.threadId);
    if (thread) {
      const streams = await listStreams(ctx, components.agent, {
        threadId: thread.componentThreadId,
      });
      for (const stream of streams) {
        if (stream.status === "streaming") {
          await abortStream(ctx, components.agent, {
            streamId: stream.streamId,
            reason: "Stopped by user",
          });
        }
      }
    }
    return null;
  },
});

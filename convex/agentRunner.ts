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
  type ActionCtx,
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
import { PLATFORM_FORMATTING_PROMPT } from "../lib/agents/platformPrompt";
import {
  resolveModel,
  WorksheetAiUnavailableError,
} from "./lib/worksheetAi";
import {
  ATTACHMENT_TOTAL_CHAR_LIMIT,
  buildComposerContext,
  capAttachmentText,
  isSupportedAttachment,
  serializeMentionToken,
  type ExtractedAttachment,
  type MentionRef,
  type MentionType,
} from "../lib/agents/composer";

/** Wire validators for a composer @-mention reference. */
const mentionTypeValidator = v.union(
  v.literal("task"),
  v.literal("project"),
  v.literal("client"),
  v.literal("user"),
);
const mentionRefValidator = v.object({
  type: mentionTypeValidator,
  id: v.string(),
  label: v.string(),
});
/** A composer attachment reference on the wire (storage id + metadata). */
const attachmentRefValidator = v.object({
  storageId: v.id("_storage"),
  name: v.string(),
  mimeType: v.string(),
  size: v.number(),
});

/** Which table backs each mention type (for server-side re-resolution). */
const MENTION_TABLE: Record<MentionType, "tasks" | "projects" | "clients" | "users"> = {
  task: "tasks",
  project: "projects",
  client: "clients",
  user: "users",
};

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

/**
 * Max tool-loop steps per response cycle. Raised 5 → 12 with the read-tool
 * expansion round (owner decision 2026-07-12): collectors are batch-shaped
 * so loops stay server-side, but resolve-ids → collect → cross-check →
 * createSheet chains plus error retries need the headroom.
 */
const MAX_STEPS = 12;

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
    // Composer @-mentions (slice 07) — re-resolved + injected as authoritative
    // context so the model uses exact ids, never client-typed names.
    mentions: v.optional(v.array(mentionRefValidator)),
    // Text already extracted from uploaded files by the action (storage blobs
    // aren't readable inside a mutation).
    attachments: v.optional(
      v.array(v.object({ name: v.string(), text: v.string() })),
    ),
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
    // Agent identity first, then the platform's rendering-surface
    // capabilities (markdown/tables), then per-run skill prompts.
    const baseInstructions = [
      agent.instructions,
      PLATFORM_FORMATTING_PROMPT,
      skillPrompt,
    ]
      .filter(Boolean)
      .join("\n\n");

    // ─── Composer context (slice 07) ─────────────────────────────────────
    // Re-resolve @-mentions to verified refs + fold in extracted file text,
    // then append one authoritative block below the skills. Empty when the
    // message carried neither, so a plain run's prompt is unchanged.
    const resolvedMentions = await resolveMentions(
      ctx,
      auth.orgId,
      args.mentions ?? [],
    );
    const composerContext = buildComposerContext({
      mentions: resolvedMentions,
      attachments: args.attachments ?? [],
    });
    const instructions = composerContext
      ? `${baseInstructions}\n\n${composerContext}`
      : baseInstructions;

    // Save the user message FIRST, so its component _creationTime precedes the
    // run's startedAt — the "skill loaded" notes then sort AFTER the question
    // and before the answer in the thread timeline.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: thread.componentThreadId,
      userId: auth.userId,
      prompt: args.message,
    });

    // Flag tool names the registry no longer knows (renamed/removed in code)
    // for THIS runner: recorded on the run row so the thread surfaces a
    // `system` block, and dropped again at model-call time (getToolsForAgent
    // in the action is the single source of truth — never executed).
    const { dropped: droppedTools } = getToolsForAgent(
      agent.tools,
      auth.isAdmin,
    );

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
      ...(droppedTools.length > 0 ? { droppedTools } : {}),
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
 * Re-resolve composer @-mentions server-side (slice 07). The client sends
 * {type,id,label}; we trust NEITHER the id (could point cross-tenant) NOR the
 * label (could be stale) and re-read each record org-scoped, dropping anything
 * invalid. Users are validated against org membership (they carry no orgId).
 * The result feeds the authoritative-context block, so the model always uses
 * verified ids and canonical names — never a name the client typed.
 */
async function resolveMentions(
  ctx: MutationCtx,
  orgId: string,
  refs: { type: MentionType; id: string; label: string }[],
): Promise<MentionRef[]> {
  if (refs.length === 0) return [];

  // Org membership set — loaded once, only when a user is mentioned.
  let memberUserIds: Set<string> | null = null;
  const loadMembers = async () => {
    if (memberUserIds) return memberUserIds;
    const memberships = await ctx.db
      .query("orgMembers")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
    memberUserIds = new Set(
      memberships.map((m) => m.userId?.toString()).filter(Boolean) as string[],
    );
    return memberUserIds;
  };

  const resolved: MentionRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const id = ctx.db.normalizeId(MENTION_TABLE[ref.type], ref.id);
    if (!id) continue;

    if (ref.type === "user") {
      const members = await loadMembers();
      if (!members.has(ref.id)) continue;
      const user = await ctx.db.get(id as Id<"users">);
      if (!user || user.deletedAt) continue;
      resolved.push({ type: "user", id: ref.id, label: user.name });
      continue;
    }

    const doc = await ctx.db.get(id);
    // Every domain table here carries orgId + a name/title — verify tenancy.
    if (!doc || (doc as { orgId?: string }).orgId !== orgId) continue;
    if ((doc as { archivedAt?: number }).archivedAt) continue;
    const label =
      ref.type === "task"
        ? (doc as { title: string }).title
        : (doc as { name: string }).name;
    resolved.push({ type: ref.type, id: ref.id, label });
  }
  return resolved;
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
    mentions: v.optional(v.array(mentionRefValidator)),
    attachments: v.optional(v.array(attachmentRefValidator)),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const trimmed = args.message.trim();
    // A message is optional when files/mentions carry the intent (e.g. "here's
    // the transcript" is the attachment itself). Require at least one signal.
    const hasAttachments = (args.attachments?.length ?? 0) > 0;
    const hasMentions = (args.mentions?.length ?? 0) > 0;
    if (!trimmed && !hasAttachments && !hasMentions) {
      throw new ConvexError("Message is empty");
    }

    // Extract attachment text HERE (storage blobs are unreadable in a
    // mutation). Unsupported types were rejected client-side; re-check
    // defensively and skip anything unreadable rather than failing the run.
    const attachmentTexts = args.attachments
      ? await extractAttachmentTexts(ctx, args.attachments)
      : [];

    // An attachment/mention-only send needs a non-empty prompt so the saved
    // user message (and the model's prompt) isn't blank — synthesize one from
    // the mention tokens + file names. Mentions keep their inline token form so
    // the sent bubble still styles them.
    const message = trimmed || synthesizePrompt(args.mentions, attachmentTexts);

    // Permission gate + run row + user message + thread status, all in one
    // transaction. Validation failures throw BEFORE anything is recorded —
    // those still surface as a toast; anything after this settles as an
    // in-thread error block instead of a rejected promise.
    const run = await ctx.runMutation(internal.agentRunner.beginRun, {
      threadId: args.threadId,
      message,
      mentions: args.mentions,
      attachments: attachmentTexts,
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
 * Read each uploaded file's text from storage and cap it (slice 07). Runs in
 * the action because `ctx.storage.get` only yields a Blob there. Per-file and
 * running-total char caps keep a huge paste from blowing the model context or
 * the mutation arg size; anything unsupported or unreadable is skipped, never
 * fatal — the run proceeds with whatever extracted cleanly.
 */
async function extractAttachmentTexts(
  ctx: ActionCtx,
  attachments: {
    storageId: Id<"_storage">;
    name: string;
    mimeType: string;
    size: number;
  }[],
): Promise<ExtractedAttachment[]> {
  const out: ExtractedAttachment[] = [];
  let total = 0;
  for (const att of attachments) {
    if (total >= ATTACHMENT_TOTAL_CHAR_LIMIT) break;
    if (!isSupportedAttachment(att.name, att.mimeType)) continue;
    let raw: string;
    try {
      const blob = await ctx.storage.get(att.storageId);
      if (!blob) continue;
      raw = await blob.text();
    } catch {
      continue; // unreadable/binary — skip rather than fail the whole run
    }
    const capped = capAttachmentText(raw);
    let text = capped.text;
    if (total + text.length > ATTACHMENT_TOTAL_CHAR_LIMIT) {
      text = text.slice(0, ATTACHMENT_TOTAL_CHAR_LIMIT - total);
    }
    total += text.length;
    out.push({
      name: att.name,
      text: capped.truncated ? `${text}\n…[truncated]` : text,
    });
  }
  return out;
}

/**
 * Build a stand-in prompt when the user sent only mentions/files and no text,
 * so the saved message and model prompt aren't blank. Mentions keep their
 * inline `@[label](type:id)` token so the bubble renders them as chips.
 */
function synthesizePrompt(
  mentions: { type: MentionType; id: string; label: string }[] | undefined,
  attachments: ExtractedAttachment[],
): string {
  const parts: string[] = [];
  if (mentions && mentions.length > 0) {
    parts.push(mentions.map(serializeMentionToken).join(" "));
  }
  if (attachments.length > 0) {
    parts.push(`(attached: ${attachments.map((a) => a.name).join(", ")})`);
  }
  return parts.join(" ").trim() || "(no message)";
}

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

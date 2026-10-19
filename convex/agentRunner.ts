import { v, ConvexError, type ObjectType } from "convex/values";
import { z } from "zod";
import {
  gateway,
  type LanguageModel,
  type StopCondition,
  type Tool,
  type ToolSet,
} from "ai";
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
import type { Doc, Id } from "./_generated/dataModel";
import {
  actorRef,
  getAuthContext,
  loadAuthContextForActor,
  type AgentActor,
  type AuthContext,
} from "./lib/auth";
import { loadTaskForReadOrNull } from "./tasks/access";
import { requireThreadAccess, threadAccess, UNTITLED_THREAD } from "./agentThreads";
import { getToolsForAgent } from "./lib/agentToolRegistry";
import {
  getAgentRunJob,
  NO_AGENT_ACTOR_MESSAGE,
  resolveJobActor,
  type AgentRunJob,
} from "./lib/agentJobs";
import { InvalidModelSlugError } from "../lib/agents/modelSlug";
import {
  assembleSkillPrompt,
  matchClientForRun,
  resolveSkills,
  STOP_CONDITION_TOOL_NAME,
  type ResolvableSkill,
} from "../lib/agents/skills";
import {
  PLATFORM_ASK_USER_PROMPT,
  PLATFORM_FORMATTING_PROMPT,
} from "../lib/agents/platformPrompt";
import {
  ASK_USER_TOOL_NAME,
  buildAnsweredQuestionContext,
  buildPendingQuestionContext,
  formatAnswerTurn,
  isQuestionRefOutput,
  SETTLE_QUESTION_TOOL_NAME,
} from "../lib/agents/questions";
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
 * `startRun` is the ONLY public entry point: a public action invoked by the
 * client, whose actor is the signed-in caller. `agentBackground.start` is
 * the internal (server-only) entry for runs without a signed-in user (A1);
 * it acts as a named org member whose membership is re-checked from the DB.
 * Both share `checkRunStart` + `openRun` + `executeRun`; a background start
 * on a busy thread is queued instead of rejected (A2a, I11).
 *
 * D6 (permission intersection): the run carries an `AgentActor`. Actor-path
 * tools receive it through a run-scoped closure and call internal variants
 * that re-derive the AuthContext per call (`loadAuthContextForActor`);
 * legacy tools (interactive runs only) still rely on the action's inherited
 * `ctx.auth`, re-running their own `getAuthContext`/`requireAdmin` per call.
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

/** Composer + message args shared by both run entry points. */
const beginRunArgs = {
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
};

/** What an opened run hands the runner loop (`executeRun`). */
export type BeginRunResult = {
  runId: Id<"agentRuns">;
  promptMessageId: string;
  componentThreadId: string;
  /** Who the run acts as — tools get it via a run-scoped closure. */
  actor: AgentActor;
  agent: { name: string; instructions: string; tools: string[] };
  hasStopConditions: boolean;
  /**
   * Model slug override for `resolveModel` (A2b): `job.model ?? agent.model`;
   * null = the platform default.
   */
  model: string | null;
  /** Tool-loop step cap: the job's `maxSteps`, else MAX_STEPS. */
  maxSteps: number;
  /** The agent job this run executes, if any (`agentRuns.job`). */
  job: string | null;
  /**
   * A question still pending in the thread when the run began (A5, §6.6):
   * the run gets it as context plus the per-run `settleQuestion` tool.
   */
  pendingQuestionId: Id<"agentQuestions"> | null;
};

/**
 * Every check that gates starting a run, for an already-established
 * AuthContext: write access to the thread (`threadAccess` — the owner on a
 * private thread, any admin on an `admins` thread), and the agent is live
 * and runnable by the actor's role. READ-ONLY by design: callers rely on a
 * throw here leaving nothing written (the queued-run claim catches it and
 * settles the queued row instead).
 */
export async function checkRunStart(
  ctx: MutationCtx,
  auth: AuthContext,
  rawThreadId: string,
): Promise<{ thread: Doc<"agentThreads">; agent: Doc<"agents"> }> {
  const threadId = ctx.db.normalizeId("agentThreads", rawThreadId);
  if (!threadId) throw new ConvexError("Thread not found");
  const { thread } = await requireThreadAccess(ctx, auth, threadId, "write");
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
  return { thread, agent };
}

/** Shown when a run is attempted while another one is active (I11). */
const RUN_IN_PROGRESS_MESSAGE = "A run is already in progress on this thread";

/**
 * Validate + open a run for an already-established AuthContext — the shared
 * core of the interactive entry (`beginRun`). Interactive runs never queue:
 * a busy thread rejects with "a run is in progress" (I11).
 */
async function beginRunCore(
  ctx: MutationCtx,
  auth: AuthContext,
  via: AgentActor["via"],
  args: ObjectType<typeof beginRunArgs>,
): Promise<BeginRunResult> {
  const { thread, agent } = await checkRunStart(ctx, auth, args.threadId);
  if (thread.status === "running") {
    throw new ConvexError(RUN_IN_PROGRESS_MESSAGE);
  }
  return await openRun(ctx, auth, via, thread, agent, args);
}

/**
 * Open a run on a checked thread: resolve skills + composer context, SAVE the
 * user message, record the run row (insert, or claim `queuedRunId`) and flip
 * the thread to running.
 *
 * The user message is saved here (not in the action): it lands
 * transactionally with the run row, appears in the thread immediately, and
 * survives a later failure (e.g. missing AI key) so the error block has
 * its question above it.
 */
async function openRun(
  ctx: MutationCtx,
  auth: AuthContext,
  via: AgentActor["via"],
  thread: Doc<"agentThreads">,
  agent: Doc<"agents">,
  args: Omit<ObjectType<typeof beginRunArgs>, "threadId">,
  opts: {
    /** Claim this queued row instead of inserting a new run row. */
    queuedRunId?: Id<"agentRuns">;
    /** An agent job run (A2b): job instructions, tools, steps, model. */
    job?: AgentRunJob;
    /** The question an answer run continues from (A5, `agentRuns.questionId`). */
    questionId?: Id<"agentQuestions">;
  } = {},
): Promise<BeginRunResult> {
  const { queuedRunId, job } = opts;
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
  // A job run uses the JOB's tool list (background-capable by
  // construction, validateAgentJob); a plain turn uses the agent's.
  const toolNames = job ? job.tools : agent.tools;
  // Agent identity first (+ the job's instructions for a job run, A2b), then
  // the platform's rendering-surface capabilities (markdown/tables) and —
  // when the run can ask — the asking rules (D18), then per-run skill prompts.
  const baseInstructions = [
    agent.instructions,
    job?.instructions,
    PLATFORM_FORMATTING_PROMPT,
    toolNames.includes(ASK_USER_TOOL_NAME) ? PLATFORM_ASK_USER_PROMPT : null,
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
    auth,
    args.mentions ?? [],
  );
  const composerContext = buildComposerContext({
    mentions: resolvedMentions,
    attachments: args.attachments ?? [],
  });
  // ─── Question context (A5, PRD §6.6) ─────────────────────────────────
  // The run an answer started learns which question it continues from. A
  // message TYPED in the composer (`via: "user"`, no job) while a question is
  // pending gets that question (+ the settleQuestion tool, wired in
  // executeRun) — never a background, job or answer run: only a human's own
  // words may settle a question.
  const questionContext = await loadQuestionContext(ctx, thread._id, {
    answeredQuestionId: opts.questionId,
    includePending: via === "user" && !job && !opts.questionId,
  });
  const instructions = [baseInstructions, composerContext, ...questionContext.lines]
    .filter(Boolean)
    .join("\n\n");

  // Save the user message FIRST, so its component _creationTime precedes the
  // run's startedAt — the "skill loaded" notes then sort AFTER the question
  // and before the answer in the thread timeline.
  const { messageId } = await saveMessage(ctx, components.agent, {
    threadId: thread.componentThreadId,
    userId: auth.userId,
    prompt: args.message,
  });

  // Flag tool names the registry no longer knows (renamed/removed in code),
  // plus — for a background actor — tools not yet on the actor path: recorded
  // on the run row so the thread surfaces a `system` block, and dropped again
  // at model-call time (getToolsForAgent in the action is the single source
  // of truth — never executed).
  const actor: AgentActor = {
    orgId: auth.orgId,
    userId: auth.userId,
    isAdmin: auth.isAdmin,
    via,
  };
  const { dropped: droppedTools } = getToolsForAgent(toolNames, actor);

  const now = Date.now();
  const runFields = {
    // The actor this run acts as (A1): role at begin + entry mode. Tools
    // re-derive the role from orgMembers per call; this is the audit record.
    actorIsAdmin: auth.isAdmin,
    via,
    ...(job ? { job: job.name } : {}),
    status: "running" as const,
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
  };
  let runId: Id<"agentRuns">;
  if (queuedRunId) {
    // Claim the queued row in place: one audit row per run, queued → running.
    await ctx.db.patch(queuedRunId, { ...runFields, queuedMessage: undefined });
    runId = queuedRunId;
  } else {
    runId = await ctx.db.insert("agentRuns", {
      orgId: auth.orgId,
      threadId: thread._id,
      agentId: agent._id,
      userId: auth.userId,
      ...runFields,
    });
  }
  await ctx.db.patch(thread._id, {
    status: "running",
    lastActivityAt: now,
    // First message auto-titles the thread (US: auto-generated titles).
    ...(thread.title === UNTITLED_THREAD
      ? { title: deriveTitle(args.message) }
      : {}),
  });

  const result: BeginRunResult = {
    runId,
    promptMessageId: messageId,
    componentThreadId: thread.componentThreadId,
    actor,
    agent: {
      name: agent.name,
      instructions,
      tools: toolNames,
    },
    // The runner adds the stop tool + honours halts only when a loaded skill
    // declares a stop-condition.
    hasStopConditions: resolved.stopConditions.length > 0,
    // job.model ?? agent.model ?? platform default (resolveModel). The slug
    // is parsed at model-resolution time; a bad one fails the run with a hint.
    model: job?.model ?? agent.model ?? null,
    maxSteps: job?.maxSteps ?? MAX_STEPS,
    job: job?.name ?? null,
    pendingQuestionId: questionContext.pendingQuestionId,
  };
  return result;
}

/**
 * The question lines for a run's instructions (A5): the answered question
 * an answer run continues from, and the thread's pending question (newest —
 * there is at most one, `agentQuestions.ask` supersedes older ones).
 */
async function loadQuestionContext(
  ctx: MutationCtx,
  threadId: Id<"agentThreads">,
  opts: { answeredQuestionId?: Id<"agentQuestions">; includePending: boolean },
): Promise<{ lines: string[]; pendingQuestionId: Id<"agentQuestions"> | null }> {
  const { answeredQuestionId } = opts;
  const lines: string[] = [];
  if (answeredQuestionId) {
    const answered = await ctx.db.get(answeredQuestionId);
    if (answered && answered.agentThreadId === threadId && answered.answer) {
      lines.push(
        buildAnsweredQuestionContext(answered, formatAnswerTurn(answered, answered.answer)),
      );
    }
  }
  if (!opts.includePending) return { lines, pendingQuestionId: null };
  const pending = await ctx.db
    .query("agentQuestions")
    .withIndex("by_agentThreadId_status", (q) =>
      q.eq("agentThreadId", threadId).eq("status", "pending"),
    )
    .order("desc")
    .first();
  if (pending) lines.push(buildPendingQuestionContext(pending._id, pending));
  return { lines, pendingQuestionId: pending?._id ?? null };
}

/** Toasted by the composer when the caller's membership row isn't there yet. */
export const MEMBERSHIP_NOT_SYNCED_MESSAGE =
  "Your organization membership hasn't synced yet — try again in a moment.";

/**
 * Interactive entry: the actor is the signed-in caller. Identity + org come
 * from the JWT (`getAuthContext`, inherited from the public `startRun`
 * action); the core then requires the JWT org to be the thread's org.
 *
 * The ROLE comes from `orgMembers` (`loadAuthContextForActor`), exactly as in
 * background runs — one role source per run, so the admin-scope tool filter,
 * the `runPermission` check and every actor-path read always agree. Resolved
 * BEFORE anything is recorded: a missing membership row (Clerk webhook lag,
 * preview deployments) rejects here with a clear toast instead of failing
 * mid-run with no user message / run row written.
 */
export const beginRun = internalMutation({
  args: beginRunArgs,
  handler: async (ctx, args): Promise<BeginRunResult> => {
    const jwtAuth = await getAuthContext(ctx);
    let auth: AuthContext;
    try {
      auth = await loadAuthContextForActor(ctx, {
        orgId: jwtAuth.orgId,
        userId: jwtAuth.userId,
      });
    } catch {
      throw new ConvexError(MEMBERSHIP_NOT_SYNCED_MESSAGE);
    }
    return await beginRunCore(ctx, auth, "user", args);
  },
});

/** What a background start opened: a live run, or a queued one (I11). */
export type BackgroundBeginResult =
  | { queued: false; run: BeginRunResult }
  | { queued: true; runId: Id<"agentRuns"> };

/**
 * Background entry (A1, A2a): no `ctx.auth`. The thread's org is the run's
 * org; the acting user's membership + role are re-derived from `orgMembers`
 * NOW (`loadAuthContextForActor` throws for a non-member), and
 * `checkRunStart` requires write access under the thread policy — the owner
 * on a private thread, a CURRENT admin on an `admins` thread. Internal only —
 * reached solely through `internal.agentBackground.start`.
 *
 * Per-thread serialization (I11): when the thread is busy — a run is active
 * or earlier background runs are still queued — the run is recorded as
 * `queued` (FIFO) instead of rejected; `finishRun` pumps the queue.
 */
export const beginBackgroundRun = internalMutation({
  args: {
    threadId: v.string(),
    actingUserId: v.id("users"),
    message: v.string(),
    // An agent job (A2b, convex/lib/agentJobs.ts) — by name, so a queued row
    // can re-resolve it when it starts. Must be an `agent_run` job of the
    // thread's system agent.
    job: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BackgroundBeginResult> => {
    const threadId = ctx.db.normalizeId("agentThreads", args.threadId);
    const found = threadId ? await ctx.db.get(threadId) : null;
    if (!found) throw new ConvexError("Thread not found");
    const auth = await loadAuthContextForActor(ctx, {
      orgId: found.orgId,
      userId: args.actingUserId,
    });
    const { thread, agent } = await checkRunStart(ctx, auth, args.threadId);
    const job = args.job ? requireJobForAgent(args.job, agent) : undefined;
    if (job) await requireJobActor(ctx, job, thread, auth.userId);

    const ahead = await nextQueuedRun(ctx, thread._id);
    if (thread.status === "running" || ahead) {
      const runId = await enqueueBackgroundRun(ctx, {
        thread,
        agentId: agent._id,
        auth,
        message: args.message,
        job: job?.name,
      });
      return { queued: true, runId };
    }
    const run = await openRun(
      ctx,
      auth,
      "background",
      thread,
      agent,
      { message: args.message },
      { job },
    );
    return { queued: false, run };
  },
});

/**
 * A job run that must not start, with the error + hint its row settles with
 * (a queued claim) — thrown by the job checks below.
 */
class JobRunRejection extends ConvexError<string> {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

/**
 * Resolve a job name for a run on `agent`: it must be a known `agent_run`
 * job (a removed job's queued row fails cleanly) whose system agent is the
 * thread's agent — a job never runs on someone else's agent.
 */
function requireJobForAgent(name: string, agent: Doc<"agents">): AgentRunJob {
  const job = getAgentRunJob(name);
  if (!job) {
    throw new JobRunRejection(
      `Queued run not started: unknown agent job "${name}"`,
      "This job no longer exists",
    );
  }
  if (agent.systemKey !== job.systemAgentKey) {
    throw new ConvexError(`Agent job "${name}" doesn't run on this agent`);
  }
  return job;
}

/**
 * E2 at (re)start: a job run may only start as the actor the job resolves to
 * NOW (`resolveJobActor`, shared with the job start) — the designated agent
 * actor for an `admins` job, the thread owner for a `private` one. A queued
 * job whose designated actor was replaced, cleared or demoted meanwhile fails
 * closed with NO_AGENT_ACTOR_MESSAGE.
 */
async function requireJobActor(
  ctx: MutationCtx,
  job: AgentRunJob,
  thread: Doc<"agentThreads">,
  runUserId: Id<"users">,
): Promise<void> {
  const hint = "Set the agent actor in Settings, then run the job again.";
  const actor = await resolveJobActor(
    ctx,
    job,
    thread.orgId,
    job.visibility === "private" ? thread.userId : undefined,
  );
  if (!actor.ok) throw new JobRunRejection(actor.error, hint);
  if (actor.userId !== runUserId) {
    throw new JobRunRejection(
      job.visibility === "admins"
        ? `${NO_AGENT_ACTOR_MESSAGE} (the designated agent actor changed since this run was queued)`
        : "This job runs as its thread owner",
      hint,
    );
  }
}

/**
 * Record a `queued` background run (A2a, I11) and make sure the queue moves:
 * on an idle thread the pump is scheduled now; on a busy one the active
 * run's settle pumps it. The claim (`beginNextQueuedRun`) re-checks the
 * actor and posts `message` as the run's user turn. Shared by a background
 * start on a busy thread and the ONE run a question answer starts (A5) —
 * which always enqueues, so the answer and its run land in one transaction.
 */
export async function enqueueBackgroundRun(
  ctx: MutationCtx,
  args: {
    thread: Doc<"agentThreads">;
    agentId: Id<"agents">;
    auth: Pick<AuthContext, "userId" | "isAdmin">;
    message: string;
    job?: string;
    questionId?: Id<"agentQuestions">;
  },
): Promise<Id<"agentRuns">> {
  const { thread } = args;
  const now = Date.now();
  const runId = await ctx.db.insert("agentRuns", {
    orgId: thread.orgId,
    threadId: thread._id,
    agentId: args.agentId,
    userId: args.auth.userId,
    actorIsAdmin: args.auth.isAdmin,
    via: "background",
    ...(args.job ? { job: args.job } : {}),
    ...(args.questionId ? { questionId: args.questionId } : {}),
    status: "queued",
    startedAt: now,
    queuedAt: now,
    queuedMessage: args.message,
  });
  // Idle thread (with or without a backlog): schedule the pump. A busy
  // thread's settle (`settleRun`) pumps it instead.
  if (thread.status !== "running") {
    await ctx.scheduler.runAfter(0, internal.agentBackground.runNextQueued, {
      threadId: thread._id,
    });
  }
  return runId;
}

/**
 * A5 job continuity — the ONE exception to the A2b designated-actor rule: the
 * run a question answer starts (`agentRuns.questionId`) continues the asking
 * run's job, acting as the human who ANSWERED. Allowed only for a current
 * admin with write access to an `admins` job thread, or the owner of a
 * `private` job thread. Every other job run keeps `requireJobActor`.
 */
function requireAnswerRunActor(
  job: AgentRunJob,
  thread: Doc<"agentThreads">,
  auth: AuthContext,
): void {
  const visibility = thread.visibility ?? "private";
  const allowed =
    job.visibility === "admins"
      ? visibility === "admins" && auth.isAdmin && threadAccess(thread, auth).canWrite
      : visibility === "private" && thread.userId === auth.userId;
  if (!allowed) {
    throw new JobRunRejection(
      job.visibility === "admins"
        ? "Only an admin of this shared thread can continue this job"
        : "Only the thread owner can continue this job",
      "Ask an admin who can see this thread to answer.",
    );
  }
}

/**
 * The job an answer run continues (A5): the asking run's job, checked for the
 * answerer now (`requireAnswerRunActor`). Null when the question was asked
 * outside a job run. Called by `agentQuestions.answer` so a refusal is
 * immediate; the queued claim re-checks it.
 */
export async function resolveAnswerRunJob(
  ctx: MutationCtx,
  args: {
    askingRunId: Id<"agentRuns"> | undefined;
    thread: Doc<"agentThreads">;
    agent: Doc<"agents">;
    auth: AuthContext;
  },
): Promise<string | undefined> {
  const asking = args.askingRunId ? await ctx.db.get(args.askingRunId) : null;
  if (!asking?.job || asking.threadId !== args.thread._id) return undefined;
  const job = requireJobForAgent(asking.job, args.agent);
  requireAnswerRunActor(job, args.thread, args.auth);
  return job.name;
}

/**
 * A5: the run an answer started never started (its start re-check failed, or
 * it was cancelled while queued) — the answer would otherwise be recorded with
 * nothing happening. Put the question back to `pending` (answer cleared) when
 * it is still `answered` and no other question is pending in the thread
 * (one at a time). The run's error / cancelled line stays.
 */
export async function restoreQuestionOfLostRun(
  ctx: MutationCtx,
  run: Pick<Doc<"agentRuns">, "questionId">,
): Promise<void> {
  if (!run.questionId) return;
  const question = await ctx.db.get(run.questionId);
  if (!question || question.status !== "answered") return;
  const otherPending = await ctx.db
    .query("agentQuestions")
    .withIndex("by_agentThreadId_status", (q) =>
      q.eq("agentThreadId", question.agentThreadId).eq("status", "pending"),
    )
    .first();
  if (otherPending) return;
  await ctx.db.patch(question._id, {
    status: "pending",
    answer: undefined,
    answeredBy: undefined,
    answeredAt: undefined,
    answeredIn: undefined,
  });
}

/** The oldest queued run of a thread (FIFO by creation time), if any. */
async function nextQueuedRun(
  ctx: MutationCtx,
  threadId: Id<"agentThreads">,
): Promise<Doc<"agentRuns"> | null> {
  return await ctx.db
    .query("agentRuns")
    .withIndex("by_threadId_status", (q) =>
      q.eq("threadId", threadId).eq("status", "queued"),
    )
    .first();
}

/**
 * Claim the thread's next queued run (A2a) — called by
 * `agentBackground.runNextQueued`, which `finishRun` schedules. Returns null
 * when there is nothing to do: the thread is busy again (an interactive run
 * slipped in — its finish pumps the queue) or the queue is empty.
 *
 * Exactly-once: the claim flips the row queued → running in this
 * transaction; a concurrent claim conflicts (OCC) and re-runs to find the
 * thread running. The actor is RE-CHECKED now (membership, role, thread
 * write access, agent permission): a queued run whose actor lost access
 * settles as `failed` with the reason — an in-thread error block — and the
 * next queued run is tried.
 */
export const beginNextQueuedRun = internalMutation({
  args: { threadId: v.id("agentThreads") },
  handler: async (ctx, args): Promise<BeginRunResult | null> => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status === "running") return null;
    for (;;) {
      const next = await nextQueuedRun(ctx, thread._id);
      if (!next) return null;
      let auth: AuthContext;
      let agent: Doc<"agents">;
      let job: AgentRunJob | undefined;
      try {
        auth = await loadAuthContextForActor(ctx, {
          orgId: thread.orgId,
          userId: next.userId,
        });
        ({ agent } = await checkRunStart(ctx, auth, thread._id));
        job = next.job ? requireJobForAgent(next.job, agent) : undefined;
        if (job) {
          // A5: an answer run continues the job as the answerer.
          if (next.questionId) requireAnswerRunActor(job, thread, auth);
          else await requireJobActor(ctx, job, thread, next.userId);
        }
      } catch (err) {
        // Nothing was written by the checks. Post the queued message so the
        // error block has its context, then settle the queued row.
        if (next.queuedMessage) {
          await saveMessage(ctx, components.agent, {
            threadId: thread.componentThreadId,
            userId: next.userId,
            prompt: next.queuedMessage,
          });
        }
        // Job checks carry their own error + hint (unknown job, actor
        // changed); everything else is an access re-check failure.
        const rejection = err instanceof JobRunRejection ? err : null;
        await ctx.db.patch(next._id, {
          status: "failed",
          finishedAt: Date.now(),
          queuedMessage: undefined,
          error: (rejection
            ? rejection.data
            : `Queued run not started: ${errorText(err)}`
          ).slice(0, 500),
          errorHint: rejection
            ? rejection.hint
            : "The run's acting user no longer has access to this thread or agent.",
        });
        await restoreQuestionOfLostRun(ctx, next);
        continue;
      }
      return await openRun(
        ctx,
        auth,
        "background",
        thread,
        agent,
        { message: next.queuedMessage ?? "" },
        { queuedRunId: next._id, job, questionId: next.questionId },
      );
    }
  },
});

/**
 * Fallback for a queued head whose OPEN threw after its checks passed (the
 * claim transaction rolled back, so the row is still `queued`): settle it as
 * `failed` with the error so a bad head never blocks the queue. Called by
 * `agentBackground.runNextQueued` in its own transaction; a no-op when the
 * thread is busy again.
 */
export const failQueuedHead = internalMutation({
  args: { threadId: v.id("agentThreads"), error: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.status === "running") return false;
    const head = await nextQueuedRun(ctx, thread._id);
    if (!head) return false;
    await ctx.db.patch(head._id, {
      status: "failed",
      finishedAt: Date.now(),
      queuedMessage: undefined,
      error: `Queued run not started: ${args.error}`.slice(0, 500),
      errorHint: "Something went wrong starting this run.",
    });
    await restoreQuestionOfLostRun(ctx, head);
    return true;
  },
});

/** Plain text of a thrown ConvexError / Error. */
export function errorText(err: unknown): string {
  if (err instanceof ConvexError) return String(err.data);
  if (err instanceof Error) return err.message;
  return "unknown error";
}

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
 * invalid. Users are validated against org membership (they carry no orgId);
 * tasks go through `tasks/access.ts` (T1: a member only gets tasks they can
 * read) and are labelled with their identifier.
 * The result feeds the authoritative-context block, so the model always uses
 * verified ids and canonical names — never a name the client typed.
 */
async function resolveMentions(
  ctx: MutationCtx,
  auth: AuthContext,
  refs: { type: MentionType; id: string; label: string }[],
): Promise<MentionRef[]> {
  if (refs.length === 0) return [];
  const { orgId } = auth;

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

    if (ref.type === "task") {
      const access = await loadTaskForReadOrNull(ctx, id as Id<"tasks">, auth);
      if (!access || access.task.archivedAt) continue;
      const { identifier, title } = access.task;
      resolved.push({ type: "task", id: ref.id, label: identifier ? `${identifier} ${title}` : title });
      continue;
    }

    const doc = await ctx.db.get(id);
    // Every domain table here carries orgId + a name/title — verify tenancy.
    if (!doc || (doc as { orgId?: string }).orgId !== orgId) continue;
    if ((doc as { archivedAt?: number }).archivedAt) continue;
    resolved.push({ type: ref.type, id: ref.id, label: (doc as { name: string }).name });
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
 * Stop condition for `askUser` — this version's `hasToolCall`, narrowed to a
 * SUCCESSFUL call: the last step returned the question marker. A rejected
 * ask (bad input → tool error) lets the model correct and retry instead of
 * ending the run with no question on screen.
 */
export const questionAsked: StopCondition<ToolSet> = ({ steps }) =>
  steps
    .at(-1)
    ?.toolResults.some(
      (r) => r.toolName === ASK_USER_TOOL_NAME && isQuestionRefOutput(r.output),
    ) ?? false;

/**
 * The settle tool for a question pending in the run's thread (A5, PRD §6.6),
 * built per run so it closes over the run id (the mutation checks the
 * question belongs to the run's thread). Offered only while one is pending.
 */
function makeSettleQuestionTool(runId: Id<"agentRuns">): Tool {
  return createTool({
    description:
      "Settle the pending question you asked earlier in this conversation. " +
      'Use outcome "answered" when the user\'s typed message answers it (put ' +
      'their answer in note), or "superseded" when their message replaces ' +
      "the plan it was about. Do not call it when the message is a question " +
      "to you or an unrelated instruction — the question then stays open.",
    inputSchema: z.object({
      questionId: z.string().describe("The pending question's id"),
      outcome: z.enum(["answered", "superseded"]),
      note: z
        .string()
        .max(500)
        .optional()
        .describe("For answered: the user's answer in a few words"),
    }),
    execute: async (toolCtx, input): Promise<{ settled: true; status: string }> => {
      await toolCtx.runMutation(internal.agentQuestions.settle, {
        runId,
        questionId: input.questionId,
        outcome: input.outcome,
        note: input.note,
      });
      return { settled: true, status: input.outcome };
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

type SettleStatus = "succeeded" | "failed" | "cancelled" | "stopped_by_skill";

/**
 * Settle a running run: close the row, free the thread, and — I11 — start
 * the thread's next queued background run. Shared by `finishRun` (every
 * settle path of `executeRun`) and the stale-run sweep, so the queue can't
 * stall behind a finished or dead run.
 */
async function settleRun(
  ctx: MutationCtx,
  run: Doc<"agentRuns">,
  args: { status: SettleStatus; error?: string; errorHint?: string },
): Promise<void> {
  const now = Date.now();
  await ctx.db.patch(run._id, {
    status: args.status,
    finishedAt: now,
    error: args.error,
    errorHint: args.errorHint,
  });
  const thread = await ctx.db.get(run.threadId);
  if (!thread) return;
  await ctx.db.patch(run.threadId, {
    status: args.status === "failed" ? "error" : "idle",
    lastActivityAt: now,
  });
  if (await nextQueuedRun(ctx, run.threadId)) {
    await ctx.scheduler.runAfter(0, internal.agentBackground.runNextQueued, {
      threadId: run.threadId,
    });
  }
}

/**
 * Close a run and settle the thread status. A no-op for a run that already
 * left `running` (e.g. the stale-run sweep timed it out first), so a late
 * finish never resurrects it or clobbers a newer run's thread status.
 */
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
    if (!run || run.status !== "running") return;
    await settleRun(ctx, run, {
      status: args.status,
      error: args.error,
      errorHint: args.errorHint,
    });
  },
});

/** A run still `running` after this long is dead (actions cap at 10 min). */
export const STALE_RUN_MS = 15 * 60 * 1000;
const STALE_SWEEP_BATCH = 100;

/**
 * Stale-run sweep (crons.ts, every 5 min): a run stuck in `running` past
 * STALE_RUN_MS — its action died without settling — is failed as "Run timed
 * out", its live stream is aborted, the thread is freed and its queue
 * pumped. Index range on (status, startedAt), bounded batch; a larger
 * backlog drains on the following ticks.
 */
export const sweepStaleRuns = internalMutation({
  args: {},
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - STALE_RUN_MS;
    const stale = await ctx.db
      .query("agentRuns")
      .withIndex("by_status_startedAt", (q) =>
        q.eq("status", "running").lt("startedAt", cutoff),
      )
      .take(STALE_SWEEP_BATCH);
    for (const run of stale) {
      const thread = await ctx.db.get(run.threadId);
      if (thread) await abortThreadStreams(ctx, thread, "Run timed out");
      await settleRun(ctx, run, {
        status: "failed",
        error: "Run timed out",
        errorHint: "You can send a follow-up message in this thread to retry.",
      });
    }
    return stale.length;
  },
});

/** Abort the component's live delta streams of a thread (Stop, timeout). */
async function abortThreadStreams(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  reason: string,
): Promise<void> {
  const streams = await listStreams(ctx, components.agent, {
    threadId: thread.componentThreadId,
  });
  for (const stream of streams) {
    if (stream.status === "streaming") {
      await abortStream(ctx, components.agent, {
        streamId: stream.streamId,
        reason,
      });
    }
  }
}

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
    const run: BeginRunResult = await ctx.runMutation(internal.agentRunner.beginRun, {
      threadId: args.threadId,
      message,
      mentions: args.mentions,
      attachments: attachmentTexts,
    });

    return await executeRun(ctx, run);
  },
});

/**
 * The run loop, shared by the interactive `startRun` and the background
 * `agentBackground.start` (A1) — same model resolution, tool set, stop
 * handling, settle/finish and audit rows. Nothing here reads `ctx.auth`:
 * the BYOK key loads via the actor path, migrated tools carry the actor in
 * their closure, and run bookkeeping goes through internal mutations keyed
 * by run id. (Legacy `ctx.auth` tools only exist in interactive runs.)
 */
export async function executeRun(
  ctx: ActionCtx,
  run: BeginRunResult,
): Promise<{ runId: Id<"agentRuns"> }> {
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
    // Actor path: membership re-checked from the DB, no ctx.auth needed.
    const orgKey = await ctx.runQuery(
      internal.aiIntegration.loadDecryptedKeyForActor,
      { actor: actorRef(run.actor) },
    );
    // resolveModel returns a bare gateway slug on the gateway path;
    // the component requires a LanguageModel instance, so wrap it.
    // Model override: job.model ?? agent.model (A2b); null → default.
    const resolved = resolveModel(orgKey, run.model);
    const languageModel: LanguageModel =
      typeof resolved === "string" ? gateway(resolved) : resolved;

    const { tools, dropped } = getToolsForAgent(run.agent.tools, run.actor);
    if (dropped.length > 0) {
      console.warn(
        `[agentRunner] Tools unavailable for this ${run.actor.via} run: ${dropped.join(", ")}`,
      );
    }

    // The stop tool exists only when a loaded skill declares a
    // stop-condition — otherwise the model has no way (and no reason) to
    // halt the run itself.
    const agentTools: Record<string, Tool> = { ...tools };
    if (run.hasStopConditions) {
      agentTools[STOP_CONDITION_TOOL_NAME] = makeStopConditionTool(run.runId);
    }
    // A question pending in the thread (A5, §6.6): the model may settle it
    // when the user's typed message answers or replaces it.
    if (run.pendingQuestionId) {
      agentTools[SETTLE_QUESTION_TOOL_NAME] = makeSettleQuestionTool(run.runId);
    }

    const agent = new Agent(components.agent, {
      name: run.agent.name,
      languageModel,
      instructions: run.agent.instructions,
      tools: agentTools,
      // `askUser` ENDS the run (A5, I7): the loop stops after the step in
      // which a question was recorded — no further model call — and the run
      // settles normally (succeeded), the thread goes idle. The answer
      // starts the next run.
      stopWhen: [stepCountIs(run.maxSteps), questionAsked],
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
      { threadId: run.componentThreadId, userId: run.actor.userId },
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
    const badModel = err instanceof InvalidModelSlugError;
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
        : badModel
          ? "Fix this agent's model in the agent builder (for example anthropic/claude-sonnet-4.6), or clear it to use the platform default."
          : "You can send a follow-up message in this thread to retry.",
    });
    return { runId: run.runId };
  }
}

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
 * Stop the active run — or cancel a queued one — (thread write access: the
 * owner of a private thread, any admin in an `admins` thread). Two levers, per the PRD's cooperative
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
    if (!run || run.orgId !== auth.orgId) {
      throw new ConvexError("Run not found");
    }
    try {
      await requireThreadAccess(ctx, auth, run.threadId, "write");
    } catch {
      throw new ConvexError("Run not found"); // don't leak existence
    }
    if (run.status === "queued") {
      // Never started: cancel it in place. Its message is not posted to the
      // thread; `queuedMessage` stays on the row as the never-started marker.
      await ctx.db.patch(run._id, {
        status: "cancelled",
        finishedAt: Date.now(),
      });
      // A cancelled answer run (A5): the question is open again.
      await restoreQuestionOfLostRun(ctx, run);
      return null;
    }
    if (run.status !== "running" || run.cancelRequested) return null;
    await ctx.db.patch(run._id, { cancelRequested: true });

    const thread = await ctx.db.get(run.threadId);
    if (thread) await abortThreadStreams(ctx, thread, "Stopped by user");
    return null;
  },
});

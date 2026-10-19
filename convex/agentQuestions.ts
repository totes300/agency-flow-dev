import { v, ConvexError } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  agentActorRefValidator,
  getAuthContext,
  loadAuthContextForActor,
  type AuthContext,
} from "./lib/auth";
import { requireThreadAccess, threadAccess } from "./agentThreads";
import { loadThreadByComponentId, proposalRevision } from "./agentProposals";
import {
  checkRunStart,
  enqueueBackgroundRun,
  MEMBERSHIP_NOT_SYNCED_MESSAGE,
  resolveAnswerRunJob,
} from "./agentRunner";
import { resolveTaskRef } from "./tasks/agent";
import { internal } from "./_generated/api";
import { answerRunJobFor, noteAnswerFollowUpFailure } from "./email/create";
import { loadTaskForReadOrNull } from "./tasks/access";
import {
  formatAnswerTurn,
  QUESTION_COMPOSER_PREFIX_MAX,
  QUESTION_HEADER_MAX,
  QUESTION_OPTION_DESCRIPTION_MAX,
  QUESTION_OPTION_LABEL_MAX,
  QUESTION_OPTIONS_MAX,
  QUESTION_OPTIONS_MIN,
  QUESTION_STALE_MESSAGE,
  QUESTION_TEXT_MAX,
  QUESTION_WHY_MAX,
  validateAnswer,
  type QuestionAnswer,
  type QuestionOption,
  type QuestionStatus,
} from "../lib/agents/questions";

/**
 * The question block (A5; PRD D16, D18, §6.6, I7, I11).
 *
 * There is no pause/resume: `askUser` (T5) writes one row here and ENDS its
 * run (the runner's stop condition). The block renders from this record.
 *   - answer → one transaction: the row flips pending → answered (a second
 *     answer then finds it answered and is refused, I7) AND exactly one
 *     next run is recorded as a queued background run in the same thread,
 *     acting as the answerer (`enqueueBackgroundRun` — it waits behind a
 *     busy thread, I11). Its user turn is the readable answer. A question
 *     asked inside a job run continues that job, as the answerer.
 *   - later → no run; the question stays visible as a muted line.
 *   - a composer turn while a question is pending gets the question as
 *     context + `settleQuestion` (runner); a new ask supersedes it.
 *
 * Who answers: write access to the thread (`requireThreadAccess`) AND the
 * asked user or an org admin. Shapes + validation: lib/agents/questions.ts.
 */

const optionValidator = v.object({
  label: v.string(),
  description: v.optional(v.string()),
  recommended: v.optional(v.boolean()),
  effect: v.optional(v.union(v.literal("email_client"), v.literal("answer_here"))),
  composerPrefix: v.optional(v.string()),
});

const NOT_FOUND = "Question not found";

// ─── Ask (internal, from the askUser tool) ──────────────────────────────────

/** Trim + require + cap a model-supplied string (model-actionable errors). */
function text(value: string, max: number, what: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`The ${what} is empty.`);
  if (trimmed.length > max) throw new Error(`The ${what} is longer than ${max} characters.`);
  return trimmed;
}

function optionalText(value: string | undefined, max: number, what: string): string | undefined {
  return value?.trim() ? text(value, max, what) : undefined;
}

function normalizeOptions(options: QuestionOption[]): QuestionOption[] {
  if (options.length < QUESTION_OPTIONS_MIN || options.length > QUESTION_OPTIONS_MAX) {
    throw new Error(`Give ${QUESTION_OPTIONS_MIN}–${QUESTION_OPTIONS_MAX} options.`);
  }
  return options.map((o) => ({
    label: text(o.label, QUESTION_OPTION_LABEL_MAX, "option label"),
    ...(o.description?.trim()
      ? { description: text(o.description, QUESTION_OPTION_DESCRIPTION_MAX, "option description") }
      : {}),
    ...(o.recommended ? { recommended: true } : {}),
    ...(o.effect ? { effect: o.effect } : {}),
    // A prefix is typed into the composer as-is (trailing space kept).
    ...(o.composerPrefix?.trim()
      ? { composerPrefix: o.composerPrefix.slice(0, QUESTION_COMPOSER_PREFIX_MAX) }
      : {}),
  }));
}

/** A model task reference (identifier or id) readable by the actor. */
async function resolveBlockingTask(
  ctx: MutationCtx,
  auth: AuthContext,
  ref: string,
): Promise<Id<"tasks">> {
  const id = await resolveTaskRef(ctx, auth.orgId, ref);
  const access = id ? await loadTaskForReadOrNull(ctx, id, auth) : null;
  if (!access) throw new Error(`Unknown task "${ref}" — use an identifier from findTasks.`);
  return access.task._id;
}

/**
 * Record the question `askUser` asked (actor path). The actor needs write
 * access to the thread; the actor is the asked user. Any question still
 * pending in the thread is superseded (one question at a time). A bound
 * proposal must be in this thread; its CURRENT revision is stamped by code.
 */
export const ask = internalMutation({
  args: {
    actor: agentActorRefValidator,
    componentThreadId: v.string(),
    header: v.string(),
    question: v.string(),
    why: v.optional(v.string()),
    options: v.array(optionValidator),
    multiSelect: v.boolean(),
    allowOther: v.boolean(),
    proposalId: v.optional(v.string()),
    blocks: v.optional(
      v.object({
        task: v.optional(v.string()),
        subtask: v.optional(v.string()),
        requestId: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{ questionId: Id<"agentQuestions"> }> => {
    const auth = await loadAuthContextForActor(ctx, args.actor);
    const found = await loadThreadByComponentId(ctx, args.componentThreadId);
    const { thread } = await requireThreadAccess(ctx, auth, found._id, "write");

    const header = text(args.header, QUESTION_HEADER_MAX, "header");
    const question = text(args.question, QUESTION_TEXT_MAX, "question");
    const why = optionalText(args.why, QUESTION_WHY_MAX, "why line");
    const options = normalizeOptions(args.options);

    let proposal: Doc<"agentProposals"> | null = null;
    if (args.proposalId) {
      const id = ctx.db.normalizeId("agentProposals", args.proposalId);
      proposal = id ? await ctx.db.get(id) : null;
      if (!proposal || proposal.threadId !== thread._id) {
        throw new Error(`No proposal ${args.proposalId} in this conversation.`);
      }
    }

    let blocks: Doc<"agentQuestions">["blocks"];
    if (args.blocks) {
      const { task, subtask, requestId } = args.blocks;
      blocks = {
        ...(task ? { taskId: await resolveBlockingTask(ctx, auth, task) } : {}),
        ...(subtask ? { subtaskId: await resolveBlockingTask(ctx, auth, subtask) } : {}),
        ...(requestId?.trim() ? { requestId: requestId.trim().slice(0, 120) } : {}),
      };
      if (Object.keys(blocks).length === 0) blocks = undefined;
    }

    // The asking run (runs on a thread are serialized, I11) — audit only.
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId_status", (q) =>
        q.eq("threadId", thread._id).eq("status", "running"),
      )
      .order("desc")
      .first();

    // One question at a time: the new one replaces any still pending.
    const pending = await ctx.db
      .query("agentQuestions")
      .withIndex("by_agentThreadId_status", (q) =>
        q.eq("agentThreadId", thread._id).eq("status", "pending"),
      )
      .take(50);
    for (const old of pending) {
      await ctx.db.patch(old._id, { status: "superseded" });
    }

    const questionId = await ctx.db.insert("agentQuestions", {
      orgId: thread.orgId,
      agentThreadId: thread._id,
      ...(run ? { runId: run._id } : {}),
      askedUserId: auth.userId,
      header,
      question,
      ...(why ? { why } : {}),
      options,
      multiSelect: args.multiSelect,
      allowOther: args.allowOther,
      ...(proposal
        ? { proposalId: proposal._id, proposalRevision: proposalRevision(proposal) }
        : {}),
      ...(blocks ? { blocks } : {}),
      status: "pending",
      createdAt: Date.now(),
    });
    return { questionId };
  },
});

// ─── Settle (internal, from the runner's settleQuestion tool) ───────────────

/**
 * The model settles the pending question from a typed message (PRD §6.6):
 * `answered` (the note is the answer, answered by the run's actor) or
 * `superseded`. Only a pending question of the run's own thread, while the
 * run is running.
 */
export const settle = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    questionId: v.string(),
    outcome: v.union(v.literal("answered"), v.literal("superseded")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "running") throw new Error("This run is no longer active.");
    const id = ctx.db.normalizeId("agentQuestions", args.questionId);
    const question = id ? await ctx.db.get(id) : null;
    if (!question || question.agentThreadId !== run.threadId) {
      throw new Error(`No question ${args.questionId} in this conversation.`);
    }
    if (question.status !== "pending") {
      throw new Error("That question is no longer pending.");
    }
    // The same actor check as `answer`: the run's actor (role from
    // orgMembers) must have write access to the thread and be the asked user
    // or an admin.
    const auth = await loadAuthContextForActor(ctx, { orgId: run.orgId, userId: run.userId });
    const thread = await ctx.db.get(question.agentThreadId);
    if (!thread || !threadAccess(thread, auth).canWrite || !canActOn(question, auth)) {
      throw new Error("You can't settle this question.");
    }
    if (args.outcome === "superseded") {
      await ctx.db.patch(question._id, { status: "superseded" });
      return null;
    }
    const note = args.note?.trim().slice(0, 500);
    await ctx.db.patch(question._id, {
      status: "answered",
      answer: { optionIndexes: [], ...(note ? { other: note } : {}) },
      answeredBy: run.userId,
      answeredAt: Date.now(),
      answeredIn: "conversation",
    });
    return null;
  },
});

// ─── Read (the block) ───────────────────────────────────────────────────────

export type QuestionBlockData = {
  _id: Id<"agentQuestions">;
  header: string;
  question: string;
  why: string | null;
  options: QuestionOption[];
  multiSelect: boolean;
  allowOther: boolean;
  status: QuestionStatus;
  answer: QuestionAnswer | null;
  /** The answerer's name; null when unanswered. */
  answeredByName: string | null;
  answeredByViewer: boolean;
  /** Settled by the agent from a typed message (no picks recorded). */
  settledInConversation: boolean;
  /** I11: a pending question whose plan revision moved — inert. */
  stale: boolean;
  /** The viewer may answer / Later / reopen it. */
  canAnswer: boolean;
};

/** May `auth` act on a question in this thread (answer, Later, reopen)? */
function canActOn(
  question: Doc<"agentQuestions">,
  auth: Pick<AuthContext, "userId" | "isAdmin">,
): boolean {
  return question.askedUserId === auth.userId || auth.isAdmin;
}

/** I11: the bound plan revision moved (or the proposal is gone). */
async function isStale(ctx: QueryCtx, question: Doc<"agentQuestions">): Promise<boolean> {
  if (!question.proposalId) return false;
  const proposal = await ctx.db.get(question.proposalId);
  return !proposal || proposalRevision(proposal) !== question.proposalRevision;
}

/**
 * Live data for one question block (reactive — answered / later /
 * superseded flip in place). Readable under the thread policy; a missing,
 * foreign or unreadable id is null (the block renders nothing).
 */
export const getForBlock = query({
  args: { questionId: v.string() },
  handler: async (ctx, args): Promise<QuestionBlockData | null> => {
    const auth = await getAuthContext(ctx);
    const id = ctx.db.normalizeId("agentQuestions", args.questionId);
    const question = id ? await ctx.db.get(id) : null;
    if (!question || question.orgId !== auth.orgId) return null;
    const thread = await ctx.db.get(question.agentThreadId);
    if (!thread) return null;
    const access = threadAccess(thread, auth);
    if (!access.canRead) return null;

    const answerer = question.answeredBy ? await ctx.db.get(question.answeredBy) : null;
    const answer = question.answer ?? null;
    return {
      _id: question._id,
      header: question.header,
      question: question.question,
      why: question.why ?? null,
      options: question.options,
      multiSelect: question.multiSelect,
      allowOther: question.allowOther,
      status: question.status,
      answer,
      answeredByName: answerer?.name ?? null,
      answeredByViewer: question.answeredBy === auth.userId,
      settledInConversation: question.answeredIn === "conversation",
      stale: question.status === "pending" && (await isStale(ctx, question)),
      canAnswer: access.canWrite && canActOn(question, auth),
    };
  },
});

// ─── Decisions (public) ─────────────────────────────────────────────────────

/**
 * Load a question the caller may act on (answer, Later, reopen), or 404
 * alike (no existence leak). Identity + org from the JWT; the ROLE from
 * `orgMembers` (`loadAuthContextForActor`) — the same role source the answer
 * run will act with, so the check and the run always agree.
 */
async function requireActionableQuestion(
  ctx: MutationCtx,
  questionId: string,
): Promise<{
  question: Doc<"agentQuestions">;
  thread: Doc<"agentThreads">;
  auth: AuthContext;
}> {
  const jwtAuth = await getAuthContext(ctx);
  let auth: AuthContext;
  try {
    auth = await loadAuthContextForActor(ctx, { orgId: jwtAuth.orgId, userId: jwtAuth.userId });
  } catch {
    throw new ConvexError(MEMBERSHIP_NOT_SYNCED_MESSAGE);
  }
  const id = ctx.db.normalizeId("agentQuestions", questionId);
  const question = id ? await ctx.db.get(id) : null;
  if (!question || question.orgId !== auth.orgId) throw new ConvexError(NOT_FOUND);
  let thread: Doc<"agentThreads">;
  try {
    ({ thread } = await requireThreadAccess(ctx, auth, question.agentThreadId, "write"));
  } catch {
    throw new ConvexError(NOT_FOUND);
  }
  if (!canActOn(question, auth)) {
    throw new ConvexError("Only the person it was asked of, or an admin, can answer this.");
  }
  return { question, thread, auth };
}

function requirePending(question: Doc<"agentQuestions">): void {
  if (question.status === "pending") return;
  throw new ConvexError(
    question.status === "answered"
      ? "This question was already answered."
      : question.status === "superseded"
        ? "This question was replaced by a newer one."
        : "This question was set aside — choose Answer now first.",
  );
}

const answerArgs = {
  questionId: v.string(),
  optionIndexes: v.array(v.number()),
  other: v.optional(v.string()),
};

/**
 * Answer a pending question (I7, I11). In ONE transaction: validate the
 * answer, refuse an outdated plan revision ("This changed — see the new
 * plan"), mark the row answered, and record exactly one next run in the same
 * thread acting as the answerer — queued behind a busy thread. Concurrent
 * answers conflict on the row (OCC); the loser re-runs, finds it answered,
 * and is refused, so there is never a second run.
 */
export const answer = mutation({
  args: answerArgs,
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const { question, thread, auth: runAuth } = await requireActionableQuestion(ctx, args.questionId);
    requirePending(question);
    if (await isStale(ctx, question)) throw new ConvexError(QUESTION_STALE_MESSAGE);

    const validated = validateAnswer(question, {
      optionIndexes: args.optionIndexes,
      other: args.other,
    });
    if (!validated.ok) throw new ConvexError(validated.error);

    // The next run acts as the answerer (role from orgMembers, as checked
    // above) and gets the same start checks a run gets (thread write access,
    // live agent, run permission) — read-only, so a refusal here leaves the
    // question pending.
    const { agent } = await checkRunStart(ctx, runAuth, thread._id);
    // Asked inside a job run → the answer run continues THAT job, acting as
    // the answerer (the A5 exception to the designated-actor rule).
    // Email triage B6b: after Create, a plan question's answer goes into the
    // kickoff (draftReply) instead of re-planning a created plan.
    const job = await answerRunJobFor(
      ctx,
      thread,
      await resolveAnswerRunJob(ctx, {
        askingRunId: question.runId,
        thread,
        agent,
        auth: runAuth,
      }),
    );

    await ctx.db.patch(question._id, {
      status: "answered",
      answer: validated.answer,
      answeredBy: runAuth.userId,
      answeredAt: Date.now(),
    });
    // B6b: a subtask Create made blocked by this question is unblocked and its
    // row covered (§6.6) — a nested step whose failure never fails the answer.
    try {
      await ctx.runMutation(internal.email.create.afterQuestionAnswered, {
        questionId: question._id,
        actor: { orgId: runAuth.orgId, userId: runAuth.userId },
      });
    } catch (err) {
      await noteAnswerFollowUpFailure(ctx, question, err);
    }
    const runId = await enqueueBackgroundRun(ctx, {
      thread,
      agentId: agent._id,
      auth: runAuth,
      message: formatAnswerTurn(question, validated.answer),
      job,
      questionId: question._id,
    });
    return { runId };
  },
});

/** "Later": set the pending question aside. No run starts. */
export const later = mutation({
  args: { questionId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const { question } = await requireActionableQuestion(ctx, args.questionId);
    requirePending(question);
    await ctx.db.patch(question._id, { status: "later" });
    return null;
  },
});

/**
 * "Answer now" on a question set aside: back to pending — unless another
 * question is pending in the thread (one question at a time).
 */
export const reopen = mutation({
  args: { questionId: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const { question, thread } = await requireActionableQuestion(ctx, args.questionId);
    if (question.status !== "later") throw new ConvexError("This question isn't set aside.");
    const open = await ctx.db
      .query("agentQuestions")
      .withIndex("by_agentThreadId_status", (q) =>
        q.eq("agentThreadId", thread._id).eq("status", "pending"),
      )
      .first();
    if (open) throw new ConvexError("Another question is open — answer that one first.");
    await ctx.db.patch(question._id, { status: "pending" });
    return null;
  },
});

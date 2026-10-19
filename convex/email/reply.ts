import { v, ConvexError } from "convex/values";
import type { ModelMessage } from "ai";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import { closeEmailItem, findLiveItem } from "../agentItems";
import { postEventLine } from "../agentEvents";
import { startAgentJobCore, type PrepareResult, type StartAgentJobResult } from "../agentJobs";
import { isClosedCategory } from "../tasks/model";
import { AGENT_EMAIL_DRAFT_MARKER } from "../../lib/agents/emailDrafts";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { conversationThreads, markConversationDraftsStale } from "./drafts";
import { DRAFT_REPLY_JOB } from "./jobs";
import { saveFakeJobTurn } from "./fakeRun";
import {
  checkReplyDraft,
  detectLanguage,
  firstNameOf,
  internalTeamNames,
  memberFirstName,
  returnWording,
  type KickoffFacts,
  type ReplyLanguage,
} from "./kickoff";
import { fakeKickoffBody, fakeReplyBody, type FakeQuestion } from "./fakeDrafts";
import { conversationInbound, requestPlanning } from "./prepare";
import { isUnresolved } from "./items";

/**
 * draftReply — the kickoff reply and the Triage reply (docs/prd-email-triage.md
 * §6.1 "After Create", D19, D20, D21, D26, Q7; implementation plan B6b).
 *
 *   startKickoffAfterCreate  scheduled by Create for the end of its undo
 *                            window (D30); no-ops when the Create was undone
 *   requestPlanning(…draftReply)  email/prepare.ts routes it (dedupe, the
 *                            designated actor, plan issue, fake seed path)
 *   startDraftReply          the job's input — the facts CODE computed
 *                            (`gatherReplyFacts`) — then `startAgentJobCore`
 *   submitDraftCore          THE draft write, shared by the `submitDraft` tool
 *                            and the dev fake: `checkReplyDraft` (return phrase
 *                            verbatim, every answerable ask row answered, the
 *                            owner's client questions as a numbered list, no
 *                            price / estimate / internal name), then a new
 *                            `emailDrafts` row (createDraftInternal: recipients
 *                            from the thread per I2, subject locked) or a new
 *                            version of the item's own draft (D20,
 *                            reviseDraftInternal); the item links it
 *   onDraftRunSettled        a run that stored no draft → plan issue (Retry)
 *
 * Discarding the kickoff closes the item (email/drafts.ts discardDraft);
 * sending it closes it too (email/send.ts "item" effect).
 */

export type ReplyMode = "kickoff" | "reply";

/** The mode an item drafts in now: kickoff after a commit (D21), reply for a reply plan (Q7). */
export function replyModeOf(item: Doc<"agentItems">): ReplyMode | null {
  if (item.commit) return "kickoff";
  if (item.plan?.reply && !item.forbidReply) return "reply";
  return null;
}

/** Draft states the agent may still revise (D20) — otherwise a new draft. */
const REVISABLE: ReadonlySet<string> = new Set(["draft", "failed", "queued"]);

// ─── Facts (code decides what the email may state) ───────────────────────────

export type ReplyFacts = {
  mode: ReplyMode;
  language: ReplyLanguage;
  contactFirstName: string | null;
  senderFirstName: string | null;
  /** kickoff only. */
  kickoff: KickoffFacts | null;
  /** The owner's client questions with their header (fake drafts word them). */
  questions: FakeQuestion[];
  /** reply only: the ask rows the reply answers. */
  required: Array<{ requestId: string; text: string }>;
  replyIntent: string | null;
  linkedTask: { id: Id<"tasks">; title: string; dueDate: string | null; status: string | null } | null;
  /** The task the draft is on (kickoff: the created / changed task; reply: the linked task when linked). */
  draftTaskId: Id<"tasks"> | null;
  inboundTexts: string[];
  internalIdentifiers: string[];
  internalNames: string[];
  tz: string;
};

async function conversationRows(ctx: QueryCtx | MutationCtx, thread: Doc<"emailThreads">): Promise<Doc<"clientRequests">[]> {
  const threads = await conversationThreads(ctx, thread);
  const out: Doc<"clientRequests">[] = [];
  for (const th of threads) {
    out.push(
      ...(await ctx.db
        .query("clientRequests")
        .withIndex("by_orgId_threadId", (q) => q.eq("orgId", thread.orgId).eq("threadId", th._id))
        .take(200)),
    );
  }
  return out;
}

async function subtasksOf(ctx: QueryCtx | MutationCtx, task: Doc<"tasks">): Promise<Doc<"tasks">[]> {
  return await ctx.db
    .query("tasks")
    .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", task.orgId).eq("parentTaskId", task._id))
    .take(100);
}

/** The owner's questions the client must answer: answered with an `email_client` option (D21). */
async function clientQuestionsOf(ctx: QueryCtx | MutationCtx, item: Doc<"agentItems">): Promise<FakeQuestion[]> {
  if (!item.agentThreadId) return [];
  const answered = await ctx.db
    .query("agentQuestions")
    .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", item.agentThreadId!).eq("status", "answered"))
    .take(50);
  return answered
    .filter((q) => q.createdAt >= item.createdAt)
    .filter((q) => (q.answer?.optionIndexes ?? []).some((i) => q.options[i]?.effect === "email_client"))
    .map((q) => ({ questionId: q._id, header: q.header, text: q.question }));
}

/** Everything a draft of this item may state — and the names / ids it may not. */
export async function gatherReplyFacts(
  ctx: QueryCtx | MutationCtx,
  item: Doc<"agentItems">,
  thread: Doc<"emailThreads">,
  nowMs: number,
): Promise<ReplyFacts | null> {
  const mode = replyModeOf(item);
  if (!mode) return null;
  const settings = await getOrgSettings(ctx, item.orgId);
  const tz = settings?.timezone || ORG_TIMEZONE_FALLBACK;
  const threads = await conversationThreads(ctx, thread);
  const inbound = await conversationInbound(ctx, item.orgId, threads);
  const latest = inbound[0] ?? null;
  const language = detectLanguage(latest ? `${latest.subject}\n${latest.bodyText}` : thread.subject);
  const contact = thread.contactId ? await ctx.db.get(thread.contactId) : null;
  const contactName = contact && contact.orgId === item.orgId ? contact.name : (latest?.from.name ?? null);
  const senderId = settings?.agentActorUserId ?? null;
  const sender = senderId ? await ctx.db.get(senderId) : null;
  const rows = await conversationRows(ctx, thread);

  // Tasks of the draft: the commit's (kickoff) or the linked one (reply).
  const taskIds = mode === "kickoff" ? (item.commit?.taskIds ?? []) : item.taskId ? [item.taskId] : [];
  const tasks: Doc<"tasks">[] = [];
  for (const id of taskIds) {
    const task = await ctx.db.get(id);
    if (task && task.orgId === item.orgId && !task.archivedAt) tasks.push(task);
  }
  const internalIdentifiers: string[] = [];
  const dues: string[] = [];
  for (const task of tasks) {
    if (task.identifier) internalIdentifiers.push(task.identifier);
    const subs = await subtasksOf(ctx, task);
    for (const sub of subs) if (sub.identifier) internalIdentifiers.push(sub.identifier);
    const open = subs.filter((s) => !s.archivedAt && !isClosedCategory(s.statusCategory) && s.dueDate);
    if (open.length > 0) dues.push(...open.map((s) => s.dueDate!));
    else if (task.dueDate) dues.push(task.dueDate);
  }

  // Team member names the email must not carry: full / first / last name of
  // every member (structured Clerk parts), the sender's own forms and single
  // names the client's people share excepted (internalTeamNames).
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", item.orgId))
    .take(200);
  const teamUsers: Doc<"users">[] = [];
  for (const m of members) {
    if (!m.userId || m.userId === senderId) continue;
    const user = await ctx.db.get(m.userId);
    if (user?.name && !user.deletedAt) teamUsers.push(user);
  }
  const names = internalTeamNames({
    members: teamUsers,
    sender,
    clientNames: [...thread.participants.map((p) => p.name ?? ""), ...inbound.map((m) => m.from.name ?? ""), contactName ?? ""],
  });

  const linked = item.taskId ? await ctx.db.get(item.taskId) : null;
  const linkedStatus = linked ? await ctx.db.get(linked.statusId) : null;
  const linkedTask =
    linked && linked.orgId === item.orgId
      ? { id: linked._id, title: linked.title, dueDate: linked.dueDate ?? null, status: linkedStatus?.name ?? null }
      : null;

  let kickoff: KickoffFacts | null = null;
  const questions = mode === "kickoff" ? await clientQuestionsOf(ctx, item) : [];
  if (mode === "kickoff") {
    const earliest = dues.sort()[0];
    kickoff = {
      language,
      contactFirstName: firstNameOf(contactName, language),
      started: tasks.map((t) => t.title),
      returnBy: earliest ? returnWording({ earliestDue: earliest, nowMs, tz, language }) : null,
      answerable: rows
        .filter((r) => r.disposition === "open" && r.answerInKickoff)
        .map((r) => ({ requestId: r._id, text: r.text, answerHint: r.planned?.reason ?? null })),
      clientQuestions: questions.map((q) => ({ questionId: q.questionId, text: q.text })),
    };
  }
  const required =
    mode === "reply"
      ? rows.filter((r) => isUnresolved(r) && r.planned?.disposition === "answered").map((r) => ({ requestId: r._id, text: r.text }))
      : [];

  // The draft's task must be linked to the conversation (I2 — createDraft checks it).
  let draftTaskId: Id<"tasks"> | null = null;
  const candidate = mode === "kickoff" ? tasks[0]?._id : linkedTask?.id;
  if (candidate) {
    const links = await ctx.db
      .query("emailThreadTasks")
      .withIndex("by_orgId_taskId", (q) => q.eq("orgId", item.orgId).eq("taskId", candidate))
      .take(20);
    const ids = new Set<string>(threads.map((t) => t._id));
    if (links.some((l) => ids.has(l.threadId))) draftTaskId = candidate;
  }

  return {
    mode,
    language,
    contactFirstName: firstNameOf(contactName, language),
    // A team member's given name comes from their structured Clerk name —
    // never a language-guessed split of the display name ("Adam Toth" → "Adam").
    senderFirstName: memberFirstName(sender),
    kickoff,
    questions,
    required,
    replyIntent: item.plan?.reply?.intent ?? null,
    linkedTask,
    draftTaskId,
    inboundTexts: inbound.map((m) => `${m.subject}\n${m.bodyText}`),
    internalIdentifiers,
    internalNames: names,
    tz,
  };
}

/** The run's input: the item, the mode and the facts (JSON) — the model may state only these. */
function buildDraftInput(item: Doc<"agentItems">, thread: Doc<"emailThreads">, facts: ReplyFacts): string {
  const forModel = {
    mode: facts.mode,
    clientLanguage: facts.language === "hu" ? "Hungarian" : "English",
    contactFirstName: facts.contactFirstName,
    senderFirstName: facts.senderFirstName,
    ...(facts.kickoff
      ? {
          started: facts.kickoff.started,
          returnPhrase: facts.kickoff.returnBy?.text ?? null,
          returnDate: facts.kickoff.returnBy?.date ?? null,
          answerNow: facts.kickoff.answerable,
          clientQuestions: facts.kickoff.clientQuestions,
        }
      : {}),
    ...(facts.mode === "reply"
      ? { answerNow: facts.required, replyIntent: facts.replyIntent, linkedTask: facts.linkedTask }
      : {}),
    doNotMention: { taskIdentifiers: facts.internalIdentifiers, teamMembers: facts.internalNames },
  };
  return [
    `Draft the ${facts.mode === "kickoff" ? "kickoff reply (D21)" : "reply"} for this client email conversation.`,
    `- Triage item ${item._id}; email conversation (threadId for getEmailThread): ${thread._id} — "${thread.subject}".`,
    item.draftId ? `- The item already has draft ${item.draftId}: submit the whole new text — it becomes a new version.` : "- There is no draft yet.",
    "- FACTS (computed by code — state nothing beyond them):",
    JSON.stringify(forModel, null, 2),
  ].join("\n");
}

// ─── Start ───────────────────────────────────────────────────────────────────

/**
 * Create's kickoff job, scheduled for the end of the undo window (D30). A
 * Create that was undone (or re-done) has another `commit.at` → no-op.
 */
export const startKickoffAfterCreate = internalMutation({
  args: { itemId: v.id("agentItems"), commitAt: v.number() },
  handler: async (ctx, args): Promise<{ started: boolean }> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.commit?.at !== args.commitAt || item.commit.outcome !== "created") return { started: false };
    if (item.status !== "open" && item.status !== "snoozed") return { started: false };
    if (!(await isEmailTriageEnabled(ctx, item.orgId))) return { started: false };
    await ctx.db.patch(item._id, { commit: { ...item.commit, kickoffFnId: undefined } });
    // The undo window ended: the conversation records what Create did (B8b, §7.2).
    await postCreatedEventLine(ctx, item, item.commit);
    const result = await requestPlanning(ctx, item._id, { trigger: "kickoff", messageIds: [], job: DRAFT_REPLY_JOB });
    return { started: result === "scheduled" || result === "already_queued" };
  },
});

/** "Created PRG-132 · Frances, Lili notified" (pure — unit-tested). */
export function createdEventText(identifiers: readonly string[], notified: readonly string[]): string {
  const created = `Created ${identifiers.join(", ")}`;
  return notified.length > 0 ? `${created} · ${notified.join(", ")} notified` : created;
}

/**
 * The event line after Create's undo window (§7.2 "when it ends, … the event
 * line"): the created tasks and who the deferred assignment notifications
 * reached (assignees of the tasks and their subtasks, the deciding admin
 * excluded). Never fails the kickoff start.
 */
async function postCreatedEventLine(
  ctx: MutationCtx,
  item: Doc<"agentItems">,
  commit: NonNullable<Doc<"agentItems">["commit"]>,
): Promise<void> {
  try {
    const agentThread = item.agentThreadId ? await ctx.db.get(item.agentThreadId) : null;
    if (!agentThread || agentThread.orgId !== item.orgId) return;
    const identifiers: string[] = [];
    const assignees = new Set<Id<"users">>();
    for (const taskId of commit.taskIds) {
      const task = await ctx.db.get(taskId);
      if (!task || task.orgId !== item.orgId || task.archivedAt) continue;
      identifiers.push(task.identifier);
      task.assigneeIds.forEach((id) => assignees.add(id));
      const subtasks = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_parentTaskId", (q) => q.eq("orgId", item.orgId).eq("parentTaskId", task._id))
        .take(50);
      for (const sub of subtasks) sub.assigneeIds.forEach((id) => assignees.add(id));
    }
    if (identifiers.length === 0) return;
    assignees.delete(commit.userId);
    const names: string[] = [];
    for (const id of assignees) {
      const user = await ctx.db.get(id);
      const first = user && !user.deletedAt ? memberFirstName(user) : null;
      if (first) names.push(first);
    }
    await postEventLine(ctx, {
      componentThreadId: agentThread.componentThreadId,
      userId: commit.userId,
      text: createdEventText(identifiers, names),
    });
  } catch (err) {
    console.error(`[kickoff] event line for item ${item._id} failed`, err);
  }
}

export type DraftInput = { orgId: string; anchor: { type: string; id: string }; title: string; input: string };

export const loadDraftInput = internalQuery({
  args: { itemId: v.id("agentItems"), nowMs: v.number() },
  handler: async (ctx, args): Promise<DraftInput | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    if (!(await isEmailTriageEnabled(ctx, item.orgId))) return null;
    const threadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (!thread || thread.orgId !== item.orgId) return null;
    // A query may not read the clock (guidelines): the action passes "now".
    const facts = await gatherReplyFacts(ctx, item, thread, args.nowMs);
    if (!facts) return null;
    return { orgId: item.orgId, anchor: { type: "emailThread", id: thread._id }, title: thread.subject, input: buildDraftInput(item, thread, facts) };
  },
});

export const startDraftReply = internalAction({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<StartAgentJobResult | null> => {
    const prepared: DraftInput | null = await ctx.runQuery(internal.email.reply.loadDraftInput, {
      itemId: args.itemId,
      nowMs: Date.now(),
    });
    if (!prepared) return null;
    const result = await startAgentJobCore(
      ctx,
      { job: DRAFT_REPLY_JOB, orgId: prepared.orgId, anchor: prepared.anchor, input: prepared.input, title: prepared.title },
      {
        onThread: async (threadId) => {
          await ctx.runMutation(internal.email.prepare.linkItemThread, { itemId: args.itemId, threadId });
        },
      },
    );
    if (result.status === "failed") {
      await ctx.runMutation(internal.email.prepare.recordPlanIssue, { itemId: args.itemId, message: result.error, job: DRAFT_REPLY_JOB });
    }
    return result;
  },
});

// ─── The draft write (submitDraft) ───────────────────────────────────────────

export type SubmitDraftInput = {
  bodyText: string;
  answersRequestIds: string[];
  sourceSummary: string;
};

export type SubmitDraftOutcome = {
  draftId: Id<"emailDrafts">;
  version: number;
  kind: ReplyMode;
  created: boolean;
};

/**
 * Check and store the kickoff / reply draft of the email conversation the
 * agent thread is anchored on (admins only — I6; behind the flag — I14). A
 * failed check THROWS a model-actionable error; nothing is written.
 */
export async function submitDraftCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; thread: Doc<"agentThreads">; input: SubmitDraftInput; nowMs?: number },
): Promise<SubmitDraftOutcome> {
  const { auth, thread } = args;
  if (thread.orgId !== auth.orgId) throw new ConvexError("Thread not found");
  if (!auth.isAdmin) throw new ConvexError("Only an admin can draft a client email here.");
  if (thread.anchor?.type !== "emailThread") throw new Error("submitDraft works only in the Triage conversation of an email thread.");
  await requireEmailTriageEnabled(ctx, auth.orgId);
  const emailThreadId = ctx.db.normalizeId("emailThreads", thread.anchor.id);
  const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
  if (!emailThread || emailThread.orgId !== auth.orgId) throw new Error("The email conversation no longer exists.");
  const item = await findLiveItem(ctx, auth.orgId, { type: "emailThread", id: emailThread._id });
  if (!item) throw new Error("This conversation has no open Triage item — there is nothing to reply to.");
  const now = args.nowMs ?? Date.now();
  // M2: the kickoff is written only after the undo window (D30) — the job at `undoUntil` does it.
  if (item.commit?.undoUntil !== undefined && now < item.commit.undoUntil) {
    throw new Error("The owner can still undo the Create — the kickoff is drafted when the undo window ends.");
  }
  const facts = await gatherReplyFacts(ctx, item, emailThread, now);
  if (!facts) {
    throw new Error("There is no reply to draft yet: the kickoff comes after Create, a reply after a reply plan.");
  }

  const answersRequestIds: Id<"clientRequests">[] = [];
  for (const raw of args.input.answersRequestIds) {
    const id = ctx.db.normalizeId("clientRequests", raw.trim());
    if (!id) throw new Error(`Unknown request "${raw}" — use an id from getThreadRequests.`);
    if (!answersRequestIds.includes(id)) answersRequestIds.push(id);
  }
  const errors = checkReplyDraft({
    mode: facts.mode,
    bodyText: args.input.bodyText,
    answersRequestIds,
    facts: facts.kickoff,
    requiredAnswers: facts.required,
    inboundTexts: facts.inboundTexts,
    internalIdentifiers: facts.internalIdentifiers,
    internalNames: facts.internalNames,
  });
  if (errors.length > 0) {
    throw new Error(`The draft was NOT saved:\n- ${errors.join("\n- ")}\nFix these and call submitDraft again.`);
  }

  // I8 hint: the "we'll get back by …" sentence (promises are read from the SENT email only).
  const returnBy = facts.kickoff?.returnBy;
  const promiseCandidates = returnBy ? [{ text: returnBy.text, dueDate: returnBy.date }] : [];
  const existing = item.draftId ? await ctx.db.get(item.draftId) : null;
  const kind = facts.mode;
  let draftId: Id<"emailDrafts">;
  let version: number;
  let created = false;
  if (existing && existing.orgId === auth.orgId && existing.kind === kind && REVISABLE.has(existing.status)) {
    ({ version } = await ctx.runMutation(internal.email.drafts.reviseDraftInternal, {
      orgId: auth.orgId,
      draftId: existing._id,
      bodyText: args.input.bodyText,
      answersRequestIds,
      promiseCandidates,
    }));
    draftId = existing._id;
    // The agent re-wrote it against the current facts: an unchanged text is reviewed, not stale (D9).
    const after = await ctx.db.get(existing._id);
    if (after?.stale) await ctx.db.patch(existing._id, { stale: undefined, updatedAt: Date.now() });
  } else {
    draftId = await ctx.runMutation(internal.email.drafts.createDraftInternal, {
      orgId: auth.orgId,
      kind,
      threadId: emailThread._id,
      ...(facts.draftTaskId ? { taskId: facts.draftTaskId } : {}),
      agentThreadId: thread._id,
      bodyText: args.input.bodyText,
      sourceSummary: args.input.sourceSummary.slice(0, 2000),
      ...(answersRequestIds.length > 0 ? { answersRequestIds } : {}),
      ...(promiseCandidates.length > 0 ? { promiseCandidates } : {}),
    });
    version = 1;
    created = true;
  }
  await ctx.db.patch(item._id, {
    draftId,
    ...(item.planIssue?.job === DRAFT_REPLY_JOB ? { planIssue: undefined } : {}),
    updatedAt: Date.now(),
  });
  return { draftId, version, kind, created };
}

export const submitDraftArgs = {
  bodyText: v.string(),
  answersRequestIds: v.array(v.string()),
  sourceSummary: v.string(),
};

// ─── A reply written in Gmail (D33 — B3 calls this) ──────────────────────────

/**
 * D33 (gate review L4): a team member replied from Gmail on a tracked
 * conversation (B3's sync stores the outbound message, then calls this). The
 * conversation's open drafts become stale ("You replied in Gmail at 14:05"),
 * the conversation waits on the client, and a kickoff-pending item closes
 * with its commit's outcome and `kickoffOutcome: "replied_in_gmail"` — unless
 * a change on it is still undecided (its Apply / Not a change ends it).
 */
export const markRepliedInGmail = internalMutation({
  args: { threadId: v.id("emailThreads"), sentAt: v.number() },
  handler: async (ctx, args): Promise<{ staled: number; closed: boolean }> => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !(await isEmailTriageEnabled(ctx, thread.orgId))) return { staled: 0, closed: false };
    const tz = (await getOrgSettings(ctx, thread.orgId))?.timezone || ORG_TIMEZONE_FALLBACK;
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
      new Date(args.sentAt),
    );
    const staled = await markConversationDraftsStale(ctx, thread, `You replied in Gmail at ${time}`);
    const now = Date.now();
    let item: Doc<"agentItems"> | null = null;
    for (const t of await conversationThreads(ctx, thread)) {
      item = await findLiveItem(ctx, thread.orgId, { type: "emailThread", id: t._id });
      if (item) break;
    }
    for (const t of await conversationThreads(ctx, thread)) {
      await ctx.db.patch(t._id, { waitingOn: "client", lastOutboundAt: Math.max(t.lastOutboundAt ?? 0, args.sentAt), updatedAt: now });
    }
    if (!item?.commit || item.kickoffOutcome) return { staled: staled.length, closed: false };
    const changePending = item.kind === "change" && (!item.changePlan || !item.commit.proposalIds.includes(item.changePlan.proposalId));
    if (changePending) return { staled: staled.length, closed: false };
    await closeEmailItem(ctx, item, { outcome: item.commit.outcome, kickoffOutcome: "replied_in_gmail" });
    return { staled: staled.length, closed: true };
  },
});

// ─── Settled ─────────────────────────────────────────────────────────────────

export const DRAFT_INCOMPLETE_MESSAGE = "The assistant couldn't finish the email — Retry";

/** A draftReply run settled without (re)writing the item's draft → the item says so (Retry). */
export const onDraftRunSettled = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<null> => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.job !== DRAFT_REPLY_JOB || run.status === "queued" || run.status === "running") return null;
    const thread = await ctx.db.get(run.threadId);
    if (!thread || thread.anchor?.type !== "emailThread") return null;
    const item = await findLiveItem(ctx, run.orgId, { type: "emailThread", id: thread.anchor.id });
    if (!item || !replyModeOf(item)) return null;
    const draft = item.draftId ? await ctx.db.get(item.draftId) : null;
    if (draft && draft.updatedAt >= run.startedAt) return null;
    await ctx.db.patch(item._id, {
      planIssue: { kind: "run_incomplete", message: DRAFT_INCOMPLETE_MESSAGE, job: DRAFT_REPLY_JOB, at: Date.now() },
    });
    return null;
  },
});

// ─── DEV: canned drafts for the seed scenarios ───────────────────────────────

/**
 * DEV seed mailboxes only (`item.devFakeModel`): the kickoff (Réka, Judit,
 * the change follow-up) or the reply (Péter) built in code from the same
 * facts (email/fakeDrafts.ts), through `submitDraftCore` — the same checks
 * and writes as the tool — and saved into the conversation as the tool calls
 * a real run would make.
 */
export const runFakeDraft = internalMutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ draftId: Id<"emailDrafts"> } | null> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.source !== "email" || item.anchor.type !== "emailThread") return null;
    if (item.status !== "open" && item.status !== "snoozed") return null;
    await requireEmailTriageEnabled(ctx, item.orgId);
    const emailThreadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const emailThread = emailThreadId ? await ctx.db.get(emailThreadId) : null;
    if (!emailThread || emailThread.orgId !== item.orgId) return null;
    const connector = await ctx.db.get(emailThread.connectorId);
    if (connector?.devSeed !== true) throw new ConvexError("The fake draft only runs on seed mailboxes.");
    if (item.planStartScheduledAt !== undefined) await ctx.db.patch(item._id, { planStartScheduledAt: undefined });

    const prepared: PrepareResult = await ctx.runMutation(internal.agentJobs.prepareAgentJob, {
      job: DRAFT_REPLY_JOB,
      orgId: item.orgId,
      anchor: { type: "emailThread", id: emailThread._id },
      title: emailThread.subject,
    });
    if (!prepared.ok) {
      await ctx.db.patch(item._id, { planIssue: { kind: "no_actor", message: prepared.error, job: DRAFT_REPLY_JOB, at: Date.now() } });
      return null;
    }
    const thread = (await ctx.db.get(prepared.threadId))!;
    const auth = await loadAuthContextForActor(ctx, { orgId: item.orgId, userId: prepared.actingUserId });
    const now = Date.now();
    const fresh = (await ctx.db.get(item._id))!;
    const facts = await gatherReplyFacts(ctx, fresh, emailThread, now);
    if (!facts) return null;
    const bodyText =
      facts.mode === "kickoff" && facts.kickoff
        ? fakeKickoffBody({ facts: facts.kickoff, questions: facts.questions, senderFirstName: facts.senderFirstName })
        : fakeReplyBody({
            language: facts.language,
            contactFirstName: facts.contactFirstName,
            senderFirstName: facts.senderFirstName,
            linkedDueDate: facts.linkedTask?.dueDate ?? null,
            nowMs: now,
            tz: facts.tz,
          });
    const input: SubmitDraftInput = {
      bodyText,
      answersRequestIds: facts.mode === "kickoff" ? (facts.kickoff?.answerable ?? []).map((a) => a.requestId) : facts.required.map((r) => r.requestId),
      sourceSummary: facts.mode === "kickoff" ? "Kickoff reply from the created plan (seed demo)" : "Reply from the linked task (seed demo)",
    };
    const outcome = await submitDraftCore(ctx, { auth, thread, input, nowMs: now });

    const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as never;
    const messages: ModelMessage[] = [
      { role: "user", content: buildDraftInput(fresh, emailThread, facts) },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "fake_submit_draft", toolName: "submitDraft", input: json(input) }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "fake_submit_draft",
            toolName: "submitDraft",
            output: { type: "json", value: json({ block: AGENT_EMAIL_DRAFT_MARKER, draftId: outcome.draftId, version: outcome.version }) },
          },
        ],
      },
      { role: "assistant", content: facts.mode === "kickoff" ? "The kickoff reply is ready for you to review." : "The reply is ready for you to review." },
    ];
    await saveFakeJobTurn(ctx, { thread, auth, job: DRAFT_REPLY_JOB, messages });
    return { draftId: outcome.draftId };
  },
});


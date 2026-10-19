import { v, ConvexError, type Infer } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { agentActorRefValidator, loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { generateClientPrefix, ensureUniquePrefix } from "../lib/helpers";
import { getOrgSettings } from "../lib/orgHelpers";
import { agentItemCommitValidator, agentItemConvertedRequestValidator } from "../lib/validators";
import { findLiveItem } from "../agentItems";
import { logActivity } from "../activityLog";
import {
  createTaskTreeFromPayload,
  proposalRevision,
  STALE_REVISION_MESSAGE,
  type BlockedSubtask,
} from "../agentProposals";
import { loadTaskForWrite } from "../tasks/access";
import { defaultStatusFor, removeTask, updateTask } from "../tasks/write";
import { validateProposalPayload, type CreateTaskPayload } from "../../lib/agents/proposals";
import { cancelScheduled, discardUnsentDraft } from "./draftState";
import {
  assertDecidable,
  conversationLedger,
  isUnresolved,
  loadEmailItemForAdmin,
  shortText,
} from "./items";
import { DRAFT_REPLY_JOB, PREPARE_TASK_JOB_NAME } from "./jobs";
import { teamLanguageOf } from "./prepare";

/**
 * Triage's Create and its Undo (docs/prd-email-triage.md §6.1, §6.7 Create
 * column, D6, D21, D26, D30, I2, I3, I12; implementation plan B6b).
 *
 * Create — ONE mutation (any throw rolls everything back):
 *   1. the gate (§6.7): no plan gaps, no open ledger row without a planned
 *      disposition (I12), every proposal at the revision the owner saw
 *      (I11 — "this changed — review again"), no plan issue; a pending
 *      question blocks only the subtask / request it names;
 *   2. `newClient` → the client (with its email domain) + the contact, the
 *      conversation linked to them;
 *   3. each plan proposal's task + subtasks through the A4 execute path
 *      (`createTaskTreeFromPayload`) AS THE ADMIN, assignment notifications
 *      deferred to the end of the 10 s undo window (D30); a subtask blocked
 *      by a pending question is created in the `blocked`-role status with a
 *      note on top (see `blockedSubtaskFor`);
 *   4. `emailThreadTasks` rows (`created`; `split` for a grouped plan — I2);
 *   5. the ledger: planned `covered` → the subtask, `dismissed` → dismissed
 *      with its reason, `answered` stays open marked "answer in kickoff",
 *      `question_pending` stays;
 *   6. the proposals approved, `task_created_from_email` activity (via agent);
 *   7. the item stays OPEN as "kickoff pending" (D26) with the commit record
 *      Undo needs; the kickoff `draftReply` job is scheduled for `undoUntil`.
 *
 * Undo (D30) — before `undoUntil` only: removes the tasks + subtasks through
 * tasks/write.ts (their deferred notifications then find nothing), puts the
 * ledger rows back exactly, the proposals back to pending at revision + 1
 * (questions bound to them follow), deletes the links and the client +
 * contact Create made when nothing else uses them, cancels the kickoff job
 * (which also no-ops on its own: `commitAt` no longer matches) and returns
 * the item to its plan.
 */

/** D30: the Create toast's undo window. */
export const CREATE_UNDO_MS = 10_000;
export const UNDO_EXPIRED_MESSAGE = "Too late to undo — the task is live now.";
export const NOTHING_TO_UNDO_MESSAGE = "There is nothing to undo on this item.";
export const ALREADY_CREATED_MESSAGE = "This item was already created.";
export const REPLY_PLAN_MESSAGE = "This plan is a reply — send the reply, or make it a task first.";
export const REPLAN_PENDING_MESSAGE = "New email arrived — review the updated plan";
export const KIND_CHANGED_MESSAGE = "A new email changed this — review it first";

/** A prepareTask run queued or running in the item's conversation (a re-plan in flight). */
async function replanInFlight(ctx: MutationCtx, item: Doc<"agentItems">): Promise<boolean> {
  if (!item.agentThreadId) return false;
  for (const status of ["queued", "running"] as const) {
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId_status", (q) => q.eq("threadId", item.agentThreadId!).eq("status", status))
      .take(20);
    if (runs.some((r) => r.job === PREPARE_TASK_JOB_NAME)) return true;
  }
  return false;
}

type Converted = Infer<typeof agentItemConvertedRequestValidator>;
type Commit = Infer<typeof agentItemCommitValidator>;
type ProposalRef = { proposalId: Id<"agentProposals">; revision: number };

const proposalRefValidator = v.object({ proposalId: v.id("agentProposals"), revision: v.number() });

/** Where a request is covered in the plan: the proposal (index) and its subtask (index), or the task itself. */
type CoverLocation = { proposal: number; subtask?: number };

function coverIndex(payloads: readonly CreateTaskPayload[]): Map<string, CoverLocation> {
  const out = new Map<string, CoverLocation>();
  payloads.forEach((payload, p) => {
    (payload.subtasks ?? []).forEach((sub, s) => {
      for (const id of sub.requestIds ?? []) if (!out.has(id)) out.set(id, { proposal: p, subtask: s });
    });
  });
  // A task without subtasks covers its requests itself (the source list); with
  // subtasks, only a subtask covers — an owner who removed the subtask uncovered it.
  payloads.forEach((payload, p) => {
    if (payload.source?.kind !== "email" || (payload.subtasks ?? []).length > 0) return;
    for (const id of payload.source.requestIds ?? []) if (!out.has(id)) out.set(id, { proposal: p });
  });
  return out;
}

const OPEN_QUESTION_STATUSES = ["pending", "later"] as const;

/** Questions of the Triage conversation still open (pending, or set aside with Later). */
async function openQuestions(
  ctx: MutationCtx,
  agentThreadId: Id<"agentThreads"> | undefined,
): Promise<Doc<"agentQuestions">[]> {
  if (!agentThreadId) return [];
  const out: Doc<"agentQuestions">[] = [];
  for (const status of OPEN_QUESTION_STATUSES) {
    out.push(
      ...(await ctx.db
        .query("agentQuestions")
        .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", agentThreadId).eq("status", status))
        .take(20)),
    );
  }
  return out;
}

/** The note on top of a blocked subtask's description (team language, D19). */
export const BLOCKED_NOTE_PREFIX: Record<"hu" | "en", string> = {
  hu: "Kérdésre vár:",
  en: "Waiting on a question:",
};

export function blockedNoteDoc(question: string, language: string): string {
  const label = /^en/i.test(language) ? BLOCKED_NOTE_PREFIX.en : BLOCKED_NOTE_PREFIX.hu;
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: label, marks: [{ type: "bold" }] },
          { type: "text", text: ` ${question.replace(/\s+/g, " ").trim().slice(0, 300)}` },
        ],
      },
    ],
  });
}

/** The org's status with the `blocked` role (Stuck), when there is an active one. */
async function blockedStatusOf(ctx: MutationCtx, orgId: string): Promise<Id<"statuses"> | undefined> {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(200);
  return statuses.find((s) => s.workflowRole === "blocked" && !s.archivedAt)?._id;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export type CreateResult = { undoUntil: number; taskIds: Id<"tasks">[] };

/**
 * The Create of one email item (see the module comment). `auth` is the
 * deciding admin (the public mutation's caller, or the dev seed's designated
 * actor); every write runs as them.
 */
export async function createFromTriageCore(
  ctx: MutationCtx,
  args: {
    auth: AuthContext;
    item: Doc<"agentItems">;
    thread: Doc<"emailThreads">;
    proposals: readonly ProposalRef[];
    nowMs?: number;
  },
): Promise<CreateResult> {
  const { auth, item, thread } = args;
  if (!auth.isAdmin) throw new ConvexError("Admin access required");
  assertDecidable(item);
  if (item.commit) throw new ConvexError(ALREADY_CREATED_MESSAGE);
  if (item.kind === "change") throw new ConvexError("This is a change on a linked task — apply it instead.");
  const plan = item.plan;
  if (!plan) throw new ConvexError("There is no plan to create yet.");
  const now = args.nowMs ?? Date.now();

  // ── The gate (§6.7, Create column) ──
  const blocks: string[] = [];
  // A newer email is being planned in: the owner must see the updated plan first (D25).
  if (item.needsReplanSince !== undefined || (await replanInFlight(ctx, item))) {
    throw new ConvexError(REPLAN_PENDING_MESSAGE);
  }
  if (item.planIssue) blocks.push(item.planIssue.message);
  if (plan.reply) blocks.push(REPLY_PLAN_MESSAGE);
  if (plan.gaps.length > 0) blocks.push(`Fix the plan first: ${plan.gaps.map((g) => g.detail).join("; ")}`);

  const live: Array<{ proposal: Doc<"agentProposals">; payload: CreateTaskPayload }> = [];
  for (const id of plan.proposalIds) {
    const proposal = await ctx.db.get(id);
    if (!proposal || proposal.orgId !== auth.orgId || proposal.threadId !== item.agentThreadId) continue;
    if (proposal.status !== "pending" && proposal.status !== "failed") continue;
    const validated = validateProposalPayload(proposal.editedPayload ?? proposal.payload);
    if (!validated.ok) {
      blocks.push(`A task card is incomplete: ${validated.reason}`);
      continue;
    }
    if (validated.payload.kind !== "createTask" || validated.payload.source?.kind !== "email") continue;
    live.push({ proposal, payload: validated.payload });
  }
  const asked = new Map(args.proposals.map((p) => [p.proposalId as string, p.revision] as const));
  const stale =
    live.length === 0 ||
    asked.size !== live.length ||
    live.some(({ proposal }) => asked.get(proposal._id) !== proposalRevision(proposal));
  if (stale) blocks.push(STALE_REVISION_MESSAGE);

  const payloads = live.map((l) => l.payload);
  const covers = coverIndex(payloads);
  const { threads, rows } = await conversationLedger(ctx, thread);
  const unresolved = rows.filter(isUnresolved);
  for (const row of unresolved) {
    if (!row.planned) {
      blocks.push(`Not covered: "${shortText(row.text)}"`); // I12
    } else if (row.planned.disposition === "covered" && !covers.has(row._id)) {
      blocks.push(`Not covered any more: "${shortText(row.text)}"`); // the owner removed its subtask
    }
  }
  if (blocks.length > 0) throw new ConvexError([...new Set(blocks)].join(" · "));

  // ── Pending questions block only what they name (§6.6, §6.7) ──
  const questions = await openQuestions(ctx, item.agentThreadId);
  const questionFor = (requestId: string) => questions.find((q) => q.blocks?.requestId === requestId);
  const blockedRows = new Map<string, string>(); // requestId → the question
  for (const row of unresolved) {
    if (row.disposition !== "question_pending") continue;
    const q = questionFor(row._id);
    const text = q?.question ?? row.planned?.question;
    if (text) blockedRows.set(row._id, text);
  }
  const language = teamLanguageOf(await getOrgSettings(ctx, auth.orgId));
  const blockedStatusId = blockedRows.size > 0 ? await blockedStatusOf(ctx, auth.orgId) : undefined;
  const blockedFor = (payload: CreateTaskPayload): Map<number, BlockedSubtask> => {
    const out = new Map<number, BlockedSubtask>();
    (payload.subtasks ?? []).forEach((sub, s) => {
      const blocking = (sub.requestIds ?? []).map((id) => blockedRows.get(id)).find(Boolean);
      if (blocking) out.set(s, { statusId: blockedStatusId, noteDoc: blockedNoteDoc(blocking, language) });
    });
    return out;
  };

  // ── New client (unknown sender) ──
  let newClient: Commit["newClient"];
  const nc = payloads.find((p) => p.newClient)?.newClient;
  if (nc && !thread.clientId) newClient = await createOrLinkClient(ctx, auth, nc, threads, now);

  // ── Tasks + subtasks (A4 path, as the admin, notifications deferred — D30) ──
  const trees: Array<{ taskId: Id<"tasks">; subtaskIds: Id<"tasks">[] }> = [];
  for (const { proposal, payload } of live) {
    trees.push(
      await createTaskTreeFromPayload(
        ctx,
        auth,
        payload,
        { via: "agent", agentProposalId: proposal._id },
        {
          notifyAfterMs: CREATE_UNDO_MS,
          blockedSubtasks: blockedFor(payload),
          // A task without a project still belongs to the conversation's client (or the new one).
          clientId: newClient?.clientId ?? thread.clientId,
        },
      ),
    );
  }
  const taskIds = trees.map((t) => t.taskId);

  // ── Thread ↔ task links (I2): `created`, or `split` for a grouped plan ──
  const role = live.length > 1 ? "split" : "created";
  const threadTaskIds: Id<"emailThreadTasks">[] = [];
  for (const taskId of taskIds) {
    threadTaskIds.push(await ctx.db.insert("emailThreadTasks", { orgId: auth.orgId, threadId: thread._id, taskId, role, createdAt: now }));
  }

  // ── The ledger: planned → real (I12) ──
  const converted: Converted[] = [];
  for (const row of unresolved) {
    const planned = row.planned;
    if (!planned || planned.disposition === "question_pending") continue;
    const before: Converted = {
      requestId: row._id,
      disposition: row.disposition,
      ...(row.taskId ? { taskId: row.taskId } : {}),
      ...(row.subtaskId ? { subtaskId: row.subtaskId } : {}),
      ...(row.dismissedReason ? { dismissedReason: row.dismissedReason } : {}),
      ...(row.answerInKickoff ? { answerInKickoff: true } : {}),
    };
    if (planned.disposition === "covered") {
      const at = covers.get(row._id)!;
      const tree = trees[at.proposal];
      await ctx.db.patch(row._id, {
        disposition: "covered",
        taskId: tree.taskId,
        subtaskId: at.subtask !== undefined ? tree.subtaskIds[at.subtask] : undefined,
        updatedAt: now,
      });
    } else if (planned.disposition === "dismissed") {
      await ctx.db.patch(row._id, {
        disposition: "dismissed",
        dismissedReason: planned.reason?.trim() || "Dismissed in the plan",
        updatedAt: now,
      });
    } else {
      // answered: stays open until the kickoff reply that answers it is sent.
      await ctx.db.patch(row._id, { answerInKickoff: true, taskId: taskIds[0], updatedAt: now });
    }
    converted.push(before);
  }

  // ── Questions now name the subtask they block (answer → unblock) ──
  const questionIds: Id<"agentQuestions">[] = [];
  for (const q of questions) {
    const requestId = q.blocks?.requestId;
    if (!requestId || !blockedRows.has(requestId)) continue;
    const at = covers.get(requestId);
    if (!at || at.subtask === undefined) continue;
    const tree = trees[at.proposal];
    await ctx.db.patch(q._id, { blocks: { ...q.blocks, taskId: tree.taskId, subtaskId: tree.subtaskIds[at.subtask] } });
    questionIds.push(q._id);
  }

  // ── Proposals approved, activity ──
  for (const [i, { proposal, payload }] of live.entries()) {
    await ctx.db.patch(proposal._id, {
      status: "approved",
      committedRef: taskIds[i],
      failureReason: undefined,
      decidedBy: auth.userId,
      decidedAt: now,
    });
    const messageId = payload.source?.kind === "email" ? ctx.db.normalizeId("emailMessages", payload.source.messageId) : null;
    await logActivity(ctx, {
      taskId: taskIds[i],
      orgId: auth.orgId,
      userId: auth.userId,
      type: "task_created_from_email",
      metadata: { threadId: thread._id, ...(messageId ? { messageId } : {}), subject: thread.subject.slice(0, 300) },
      attribution: { via: "agent", agentProposalId: proposal._id },
    });
  }

  // ── The item: kickoff pending (D21, D26); the kickoff job after the undo window ──
  const undoUntil = now + CREATE_UNDO_MS;
  const kickoffFnId = await ctx.scheduler.runAt(undoUntil, internal.email.reply.startKickoffAfterCreate, {
    itemId: item._id,
    commitAt: now,
  });
  const commit: Commit = {
    outcome: "created",
    at: now,
    userId: auth.userId,
    taskIds,
    proposalIds: live.map((l) => l.proposal._id),
    converted,
    threadTaskIds,
    ...(newClient ? { newClient } : {}),
    ...(questionIds.length > 0 ? { questionIds } : {}),
    ...(item.taskId ? { previousTaskId: item.taskId } : {}),
    kind: item.kind,
    undoUntil,
    kickoffFnId,
  };
  await ctx.db.patch(item._id, {
    status: "open",
    snoozedUntil: undefined,
    commit,
    kickoffOutcome: undefined,
    taskId: taskIds[0],
    updatedAt: now,
  });
  return { undoUntil, taskIds };
}

/**
 * `newClient` (an unknown sender, B6a-checked): the client with the sender's
 * domain and the contact. A client that already has the domain is linked
 * instead (never a duplicate); a name taken by another client is refused.
 */
async function createOrLinkClient(
  ctx: MutationCtx,
  auth: AuthContext,
  nc: NonNullable<CreateTaskPayload["newClient"]>,
  threads: readonly Doc<"emailThreads">[],
  now: number,
): Promise<NonNullable<Commit["newClient"]>> {
  const domain = nc.domain.trim().toLowerCase().replace(/^@/, "");
  const name = nc.name.trim();
  if (!name || name.length > 200) throw new ConvexError("The new client needs a name (200 characters or fewer).");
  const clients = await ctx.db
    .query("clients")
    .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
    .take(1000);
  const byDomain = clients.find((c) => !c.archivedAt && (c.emailDomains ?? []).includes(domain));
  let clientId: Id<"clients">;
  let createdClient = false;
  if (byDomain) {
    clientId = byDomain._id;
  } else {
    const taken = clients.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (taken) throw new ConvexError(`A client named "${name}" already exists — link the email to it first.`);
    const settings = await getOrgSettings(ctx, auth.orgId);
    clientId = await ctx.db.insert("clients", {
      orgId: auth.orgId,
      name,
      currency: settings?.defaultCurrency ?? "USD",
      prefix: await ensureUniquePrefix(ctx, auth.orgId, generateClientPrefix(name)),
      emailDomains: [domain],
      createdAt: now,
      updatedAt: now,
      createdBy: auth.userId,
    });
    createdClient = true;
  }

  const email = nc.contact.email.trim().toLowerCase();
  const existingContact = await ctx.db
    .query("clientContacts")
    .withIndex("by_orgId_email", (q) => q.eq("orgId", auth.orgId).eq("email", email))
    .first();
  let contactId: Id<"clientContacts"> | undefined;
  let linkContact: Id<"clientContacts"> | undefined = existingContact?.clientId === clientId ? existingContact._id : undefined;
  if (!existingContact) {
    const others = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", clientId))
      .take(5);
    contactId = await ctx.db.insert("clientContacts", {
      orgId: auth.orgId,
      clientId,
      name: nc.contact.name.trim().slice(0, 200) || email,
      email,
      isPrimary: others.length === 0,
      createdAt: now,
      updatedAt: now,
      createdBy: auth.userId,
    });
    linkContact = contactId;
  }

  const threadIds: Id<"emailThreads">[] = [];
  for (const th of threads) {
    if (th.clientId) continue;
    await ctx.db.patch(th._id, { clientId, ...(linkContact ? { contactId: linkContact } : {}), updatedAt: now });
    threadIds.push(th._id);
  }
  return { clientId, createdClient, ...(contactId ? { contactId } : {}), threadIds };
}

export const createFromTriage = mutation({
  args: { itemId: v.id("agentItems"), proposals: v.array(proposalRefValidator) },
  handler: async (ctx, args): Promise<{ undoUntil: number; undoMs: number; identifiers: string[] }> => {
    const { auth, item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    const { undoUntil, taskIds } = await createFromTriageCore(ctx, { auth, item, thread, proposals: args.proposals });
    // The toast names what was created ("Created PRG-132 · Undo", D30).
    const identifiers: string[] = [];
    for (const id of taskIds) {
      const task = await ctx.db.get(id);
      if (task) identifiers.push(task.identifier);
    }
    // `undoMs`: what is left of the window by the SERVER clock — the toast's duration.
    return { undoUntil, undoMs: Math.max(0, undoUntil - Date.now()), identifiers };
  },
});

// ─── Undo (D30) ──────────────────────────────────────────────────────────────

export async function undoCreateCore(
  ctx: MutationCtx,
  args: { auth: AuthContext; item: Doc<"agentItems">; nowMs?: number },
): Promise<null> {
  const { auth, item } = args;
  const commit = item.commit;
  if (!commit || commit.outcome !== "created" || commit.undoUntil === undefined) {
    throw new ConvexError(NOTHING_TO_UNDO_MESSAGE);
  }
  if ((args.nowMs ?? Date.now()) >= commit.undoUntil) throw new ConvexError(UNDO_EXPIRED_MESSAGE);
  if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError(NOTHING_TO_UNDO_MESSAGE);
  // L1 (the safer pick): refuse rather than guess — a new email that turned the
  // item into a change (or any other kind) must be reviewed before anything is undone.
  if (commit.kind !== undefined && item.kind !== commit.kind) throw new ConvexError(KIND_CHANGED_MESSAGE);
  const now = Date.now();
  await cancelScheduled(ctx, commit.kickoffFnId);
  // M2: no kickoff survives an Undo (none should exist before `undoUntil`, but never leave one).
  await discardUnsentDraft(ctx, item.draftId);

  // The tasks + subtasks, through tasks/write.ts (deferred notifications then find nothing).
  for (const taskId of commit.taskIds) {
    const task = await ctx.db.get(taskId);
    if (!task || task.orgId !== auth.orgId) continue;
    await removeTask(ctx, await loadTaskForWrite(ctx, taskId, auth));
  }
  for (const id of commit.threadTaskIds) {
    const link = await ctx.db.get(id);
    if (link && link.orgId === auth.orgId) await ctx.db.delete(link._id);
  }
  // The ledger exactly as it was.
  for (const c of commit.converted) {
    const row = await ctx.db.get(c.requestId);
    if (!row || row.orgId !== auth.orgId) continue;
    await ctx.db.patch(row._id, {
      disposition: c.disposition,
      taskId: c.taskId,
      subtaskId: c.subtaskId,
      dismissedReason: c.dismissedReason,
      answerInKickoff: c.answerInKickoff,
      updatedAt: now,
    });
  }
  // The plan's proposals back to pending, one revision on (I11); questions bound to them follow.
  const revisions = new Map<string, { from: number; to: number }>();
  for (const id of commit.proposalIds) {
    const proposal = await ctx.db.get(id);
    if (!proposal || proposal.orgId !== auth.orgId) continue;
    const from = proposalRevision(proposal);
    revisions.set(proposal._id, { from, to: from + 1 });
    await ctx.db.patch(proposal._id, {
      status: "pending",
      revision: from + 1,
      committedRef: undefined,
      failureReason: undefined,
      decidedBy: undefined,
      decidedAt: undefined,
    });
  }
  if (item.agentThreadId) {
    for (const status of [...OPEN_QUESTION_STATUSES, "answered"] as const) {
      const rows = await ctx.db
        .query("agentQuestions")
        .withIndex("by_agentThreadId_status", (q) => q.eq("agentThreadId", item.agentThreadId!).eq("status", status))
        .take(50);
      for (const q of rows) {
        const moved = q.proposalId ? revisions.get(q.proposalId) : undefined;
        const bound = (commit.questionIds ?? []).includes(q._id);
        if (!moved && !bound) continue;
        const blocks = q.blocks?.requestId ? { requestId: q.blocks.requestId } : undefined;
        await ctx.db.patch(q._id, {
          ...(moved && q.proposalRevision === moved.from ? { proposalRevision: moved.to } : {}),
          ...(bound ? { blocks } : {}),
        });
      }
    }
  }
  if (commit.newClient) await undoClient(ctx, auth.orgId, commit.newClient, now);

  await ctx.db.patch(item._id, {
    commit: undefined,
    kickoffOutcome: undefined,
    draftId: undefined,
    taskId: commit.previousTaskId,
    updatedAt: now,
  });
  return null;
}

/** Unlink the threads Create linked; delete the client + contact it created when nothing else uses them. */
async function undoClient(
  ctx: MutationCtx,
  orgId: string,
  nc: NonNullable<Commit["newClient"]>,
  now: number,
): Promise<void> {
  for (const id of nc.threadIds) {
    const th = await ctx.db.get(id);
    if (th && th.orgId === orgId && th.clientId === nc.clientId) {
      await ctx.db.patch(th._id, { clientId: undefined, contactId: undefined, updatedAt: now });
    }
  }
  const contact = nc.contactId ? await ctx.db.get(nc.contactId) : null;
  const contactThreads = contact ? await threadsReferencing(ctx, orgId, { contactId: contact._id }) : 0;
  if (contact && contact.orgId === orgId && contactThreads === 0) await ctx.db.delete(contact._id);
  if (!nc.createdClient) return;
  const client = await ctx.db.get(nc.clientId);
  if (!client || client.orgId !== orgId) return;
  if (await clientIsReferenced(ctx, orgId, client._id)) return;
  await ctx.db.delete(client._id);
}

/** Whether any email thread of the org points at the client or contact (index lookups — never a scan). */
async function threadsReferencing(
  ctx: MutationCtx,
  orgId: string,
  ref: { clientId?: Id<"clients">; contactId?: Id<"clientContacts"> },
): Promise<number> {
  if (ref.clientId) {
    const row = await ctx.db
      .query("emailThreads")
      .withIndex("by_orgId_clientId", (q) => q.eq("orgId", orgId).eq("clientId", ref.clientId))
      .first();
    if (row) return 1;
  }
  if (ref.contactId) {
    const row = await ctx.db
      .query("emailThreads")
      .withIndex("by_orgId_contactId", (q) => q.eq("orgId", orgId).eq("contactId", ref.contactId))
      .first();
    if (row) return 1;
  }
  return 0;
}

/** Anything besides Create's own rows that points at the client (then Undo keeps it). */
async function clientIsReferenced(ctx: MutationCtx, orgId: string, clientId: Id<"clients">): Promise<boolean> {
  if (await ctx.db.query("projects").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).first()) return true;
  if (await ctx.db.query("invoices").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).first()) return true;
  if (await ctx.db.query("clientContacts").withIndex("by_clientId", (q) => q.eq("clientId", clientId)).first()) return true;
  if (await ctx.db.query("skills").withIndex("by_orgId_clientId", (q) => q.eq("orgId", orgId).eq("clientId", clientId)).first()) {
    return true;
  }
  return (await threadsReferencing(ctx, orgId, { clientId })) > 0;
}

export const undoCreate = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<null> => {
    const { auth, item } = await loadEmailItemForAdmin(ctx, args.itemId);
    return await undoCreateCore(ctx, { auth, item });
  },
});

// ─── Questions answered after Create (§6.6) ──────────────────────────────────

/**
 * The run an answer starts in a Triage conversation (agentQuestions.answer):
 * once the plan is created, a prepareTask answer continues as the kickoff
 * `draftReply` instead — the answer goes into the kickoff (e.g. "Ask Réka").
 * Never before the undo window ends (M2): until then the answer starts a
 * plain conversation turn (which may not write the kickoff either), and the
 * kickoff job at `undoUntil` reads the answer.
 */
export async function answerRunJobFor(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  job: string | undefined,
): Promise<string | undefined> {
  if (job !== PREPARE_TASK_JOB_NAME || thread.anchor?.type !== "emailThread") return job;
  const item = await findLiveItem(ctx, thread.orgId, { type: "emailThread", id: thread.anchor.id });
  if (!item?.commit) return job;
  if (item.commit.undoUntil !== undefined && Date.now() < item.commit.undoUntil) return undefined;
  return DRAFT_REPLY_JOB;
}

/**
 * A question Create bound to a blocked subtask was answered (§6.6; gate
 * review M3, M5, L2) — only for the questions in the item's
 * `commit.questionIds`:
 *   - the chosen option emails the client ("Ask Réka") → nothing moves: the
 *     row stays `question_pending`, the subtask stays blocked, and the
 *     kickoff lists the question (reply.ts `clientQuestionsOf`);
 *   - otherwise → the subtask leaves the `blocked` status (when it holds it)
 *     for the default open status, its note goes in any case, and the row
 *     becomes `covered` on that subtask (its previous state joins the
 *     commit's, so an Undo still restores it).
 * Run as a nested mutation by the answer: a failure rolls back only this and
 * never fails the answer (agentQuestions.answer catches it and notes it).
 */
export const afterQuestionAnswered = internalMutation({
  args: { questionId: v.id("agentQuestions"), actor: agentActorRefValidator },
  handler: async (ctx, args): Promise<{ done: "unblocked" | "asked_client" | "skipped" }> => {
    const question = await ctx.db.get(args.questionId);
    if (!question || question.status !== "answered") return { done: "skipped" };
    const thread = await ctx.db.get(question.agentThreadId);
    if (!thread || thread.orgId !== question.orgId || thread.anchor?.type !== "emailThread") return { done: "skipped" };
    const item = await findLiveItem(ctx, thread.orgId, { type: "emailThread", id: thread.anchor.id });
    if (!item?.commit || !(item.commit.questionIds ?? []).includes(question._id)) return { done: "skipped" };
    const emailsClient = (question.answer?.optionIndexes ?? []).some((i) => question.options[i]?.effect === "email_client");
    if (emailsClient) return { done: "asked_client" };

    const auth = await loadAuthContextForActor(ctx, args.actor);
    const now = Date.now();
    const subtaskId = question.blocks?.subtaskId;
    const sub = subtaskId ? await ctx.db.get(subtaskId) : null;
    if (sub && sub.orgId === auth.orgId && !sub.archivedAt) {
      const status = await ctx.db.get(sub.statusId);
      const access = await loadTaskForWrite(ctx, sub._id, auth);
      const patch: { statusId?: Id<"statuses">; description?: string } = {};
      if (status?.workflowRole === "blocked") {
        patch.statusId = (await defaultStatusFor(ctx, auth.orgId, ["unstarted", "backlog"])).status._id;
      }
      const stripped = stripBlockedNote(sub.description);
      if (stripped !== sub.description) patch.description = stripped ?? "";
      if (Object.keys(patch).length > 0) await updateTask(ctx, access, patch);
    }
    const requestId = question.blocks?.requestId ? ctx.db.normalizeId("clientRequests", question.blocks.requestId) : null;
    const row = requestId ? await ctx.db.get(requestId) : null;
    if (row && row.orgId === auth.orgId && row.disposition === "question_pending" && sub) {
      const before: Converted = {
        requestId: row._id,
        disposition: row.disposition,
        ...(row.taskId ? { taskId: row.taskId } : {}),
        ...(row.subtaskId ? { subtaskId: row.subtaskId } : {}),
      };
      await ctx.db.patch(row._id, { disposition: "covered", taskId: question.blocks?.taskId ?? sub.parentTaskId, subtaskId: sub._id, updatedAt: now });
      await ctx.db.patch(item._id, { commit: { ...item.commit, converted: [...item.commit.converted, before] } });
    }
    return { done: "unblocked" };
  },
});

/** The answer's follow-up failed (M3): logged, and a note on the item says what is left to do. */
export async function noteAnswerFollowUpFailure(
  ctx: MutationCtx,
  question: Doc<"agentQuestions">,
  err: unknown,
): Promise<void> {
  console.error(`[email/create] could not unblock after answering question ${question._id}`, err);
  const thread = await ctx.db.get(question.agentThreadId);
  if (!thread || thread.anchor?.type !== "emailThread") return;
  const item = await findLiveItem(ctx, thread.orgId, { type: "emailThread", id: thread.anchor.id });
  if (!item) return;
  await ctx.db.patch(item._id, {
    decisionNote: {
      message: `"${question.header}" was answered, but its blocked subtask could not be unblocked — move it on by hand.`,
      at: Date.now(),
    },
  });
}

/** The description without the blocked note paragraph Create put on top. */
export function stripBlockedNote(description: string | undefined): string | undefined {
  if (!description) return description;
  try {
    const doc = JSON.parse(description) as { type?: string; content?: Array<{ content?: Array<{ text?: string }> }> };
    const first = doc.content?.[0]?.content?.[0]?.text ?? "";
    if (!Object.values(BLOCKED_NOTE_PREFIX).includes(first)) return description;
    const rest = (doc.content ?? []).slice(1);
    return rest.length > 0 ? JSON.stringify({ ...doc, content: rest }) : undefined;
  } catch {
    return description;
  }
}

import { v, ConvexError, type Infer } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
import { proposalPayloadValidator } from "./lib/proposalValidators";
import { resolveTaskRef } from "./tasks/agent";
import { loadTaskForReadOrNull, loadTaskForWrite, type TaskAccess } from "./tasks/access";
import {
  archiveTask,
  createTask,
  defaultStatusFor,
  openSubtasksMessage,
  updateTask as updateTaskWrite,
  type TaskPatch,
} from "./tasks/write";
import { isClosedCategory, isTaskPriority, type TaskPriority } from "./tasks/model";
import type { ActivityAttribution } from "./activityLog";
import { createComment } from "./comments";
import { createSkill } from "./skills";
import { requireThreadAccess, threadAccess } from "./agentThreads";
import {
  commentTextToTiptapDoc,
  mergeEditedPayload,
  plainTextToTiptapDoc,
  PROPOSAL_KIND_META,
  validateProposalPayload,
  type CreateTaskPayload,
  type ProposalPayload,
  type ProposedSubtask,
  type UpdateTaskPayload,
} from "../lib/agents/proposals";

/** Shown on the card for an unexpected (non-ConvexError) failure. */
const UNEXPECTED_FAILURE = "Couldn't apply this change — try again";

/**
 * Card-safe reason from a rejected effect. Domain refusals are ConvexErrors
 * written for people; anything else is internal — logged server-side, never
 * shown on the card.
 */
function rejectionReason(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) return String(err.data ?? fallback);
  console.error("Proposal effect failed unexpectedly", err);
  return UNEXPECTED_FAILURE;
}

/**
 * Proposal engine (PRD Module 3 · slice 08; email-triage A4 / S2) — the ONLY
 * path from agent intent to domain writes.
 *
 * Lifecycle: a propose-kind registry tool inserts a `pending` row via the
 * actor path (`agentActorTools.createProposals`, never touching domain
 * tables); the chat
 * renders the row as an editable card; `approve` validates the (possibly
 * edited) payload and executes the kind's WHOLE effect in ONE nested
 * mutation (`executeEffect`), which calls the domain write paths directly
 * (`tasks/write.ts`, `comments.createComment`, `skills.createSkill`) with the
 * APPROVING USER's AuthContext — same permission checks as the UI, the
 * activity log shows the human (rows carry `via: "agent"` +
 * `agentProposalId`), never the agent. The nested mutation is a
 * subtransaction: any rejection (stale reference, permission, I3 gate) rolls
 * back everything it wrote — a task with N sub-tasks is created whole or not
 * at all — and the row settles as `failed` (retryable). An approveScope miss
 * throws before anything runs and the row STAYS `pending`.
 */

// ─── Kind → domain effect ───────────────────────────────────────────────────

type ExecuteOutcome =
  | { ok: true; committedRef: string }
  | { ok: false; reason: string };

const FAILURE_FALLBACK: Record<ProposalPayload["kind"], string> = {
  createTask: "Task creation failed.",
  updateTask: "Updating the task failed.",
  postComment: "Posting the comment failed.",
  proposeSkill: "Adding the skill failed.",
  archiveTask: "Archiving failed.",
};

/**
 * Execute a validated payload as the caller, atomically. Rejections come
 * back as `{ ok: false, reason }` — the nested mutation's writes are rolled
 * back, the proposal row still settles.
 */
async function executePayload(
  ctx: MutationCtx,
  auth: AuthContext,
  proposalId: Id<"agentProposals">,
  payload: ProposalPayload,
): Promise<ExecuteOutcome> {
  try {
    const committedRef: string = await ctx.runMutation(
      internal.agentProposals.executeEffect,
      { proposalId, approverId: auth.userId, payload },
    );
    return { ok: true, committedRef };
  } catch (err) {
    return { ok: false, reason: rejectionReason(err, FAILURE_FALLBACK[payload.kind]) };
  }
}

/**
 * One proposal's whole effect, in one (sub)transaction. Called only from
 * `approve` / `approveAll` via `ctx.runMutation`, so it runs with the
 * approving user's identity (re-derived here, never taken from args — the
 * `approverId` arg is only a consistency check). Every id read is
 * ownership-checked against the approver's org before it is used.
 */
export const executeEffect = internalMutation({
  args: {
    proposalId: v.id("agentProposals"),
    approverId: v.id("users"),
    payload: proposalPayloadValidator,
  },
  handler: async (ctx, args): Promise<string> => {
    const auth = await getAuthContext(ctx);
    if (auth.userId !== args.approverId) throw new ConvexError("Approver mismatch");
    const validated = validateProposalPayload(args.payload);
    if (!validated.ok) throw new ConvexError(validated.reason);
    const attribution: ActivityAttribution = { via: "agent", agentProposalId: args.proposalId };
    const payload = validated.payload;
    switch (payload.kind) {
      case "createTask":
        return await executeCreateTask(ctx, auth, payload, attribution);
      case "updateTask":
        return await executeUpdateTask(ctx, auth, payload, attribution);
      case "postComment": {
        const access = await loadProposalTask(ctx, auth, payload.taskId);
        await createComment(ctx, access, { content: commentTextToTiptapDoc(payload.body) }, { attribution });
        return access.task._id;
      }
      case "proposeSkill": {
        let clientId: Id<"clients"> | undefined;
        if (payload.scope === "client") {
          clientId = ctx.db.normalizeId("clients", payload.clientId ?? "") ?? undefined;
          if (!clientId) throw new ConvexError("The referenced client no longer exists.");
        }
        return await createSkill(ctx, auth, {
          name: payload.name,
          instruction: payload.instruction,
          scope: payload.scope,
          clientId,
          isStopCondition: false,
        });
      }
      case "archiveTask": {
        const access = await loadProposalTask(ctx, auth, payload.taskId);
        if (access.task.archivedAt) throw new ConvexError("The task is already archived.");
        await archiveTask(ctx, access, { attribution });
        return access.task._id;
      }
    }
  },
});

// ─── Reference resolution (approve time, approver's org) ────────────────────

/** A task the approver may write; missing / foreign / unreadable read alike. */
async function loadProposalTask(ctx: MutationCtx, auth: AuthContext, raw: string): Promise<TaskAccess> {
  const id = ctx.db.normalizeId("tasks", raw);
  const access = id ? await loadTaskForReadOrNull(ctx, id, auth) : null;
  if (!access) throw new ConvexError("The referenced task no longer exists.");
  return await loadTaskForWrite(ctx, access.task._id, auth);
}

async function resolveProject(ctx: MutationCtx, auth: AuthContext, raw: string): Promise<Id<"projects">> {
  const id = ctx.db.normalizeId("projects", raw);
  const project = id ? await ctx.db.get(id) : null;
  if (!project || project.orgId !== auth.orgId || project.archivedAt) {
    throw new ConvexError("The referenced project no longer exists.");
  }
  return project._id;
}

/** Users must exist; org membership is checked by the write path (validateAssignees). */
async function resolveUsers(ctx: MutationCtx, raws: readonly string[]): Promise<Id<"users">[]> {
  const ids: Id<"users">[] = [];
  for (const raw of raws) {
    const id = ctx.db.normalizeId("users", raw);
    const user = id ? await ctx.db.get(id) : null;
    if (!user || user.deletedAt) throw new ConvexError("A proposed assignee is no longer available.");
    ids.push(user._id);
  }
  return ids;
}

async function resolveCategory(ctx: MutationCtx, auth: AuthContext, raw: string): Promise<Id<"workCategories">> {
  const id = ctx.db.normalizeId("workCategories", raw);
  const category = id ? await ctx.db.get(id) : null;
  if (!category || category.orgId !== auth.orgId || category.archivedAt) {
    throw new ConvexError("The referenced work category no longer exists.");
  }
  return category._id;
}

async function resolveStatus(ctx: MutationCtx, auth: AuthContext, raw: string): Promise<Doc<"statuses">> {
  const id = ctx.db.normalizeId("statuses", raw);
  const status = id ? await ctx.db.get(id) : null;
  if (!status || status.orgId !== auth.orgId || status.archivedAt) {
    throw new ConvexError("The referenced status no longer exists.");
  }
  return status;
}

async function resolveLabels(ctx: MutationCtx, auth: AuthContext, raws: readonly string[]): Promise<Id<"labels">[]> {
  const ids: Id<"labels">[] = [];
  for (const raw of raws) {
    const id = ctx.db.normalizeId("labels", raw);
    const label = id ? await ctx.db.get(id) : null;
    if (!label || label.orgId !== auth.orgId || label.archivedAt) {
      throw new ConvexError("A proposed label no longer exists.");
    }
    ids.push(label._id);
  }
  return ids;
}

function toPriority(value: number | undefined): TaskPriority | undefined {
  return value !== undefined && isTaskPriority(value) ? value : undefined;
}

// ─── createTask: the task + its sub-task tree ───────────────────────────────

async function executeCreateTask(
  ctx: MutationCtx,
  auth: AuthContext,
  payload: CreateTaskPayload,
  attribution: ActivityAttribution,
): Promise<string> {
  const projectId = payload.projectId ? await resolveProject(ctx, auth, payload.projectId) : undefined;
  const assigneeIds = payload.assigneeIds?.length ? await resolveUsers(ctx, payload.assigneeIds) : undefined;
  const workCategoryId = payload.workCategoryId
    ? await resolveCategory(ctx, auth, payload.workCategoryId)
    : undefined;
  const status = payload.statusId ? await resolveStatus(ctx, auth, payload.statusId) : undefined;
  const labelIds = payload.labelIds?.length ? await resolveLabels(ctx, auth, payload.labelIds) : undefined;
  const subtasks = payload.subtasks ?? [];
  // I3: a new tree with open sub-tasks can't start in the admin-review role.
  if (status?.workflowRole === "admin_review" && subtasks.length > 0) {
    throw new ConvexError(openSubtasksMessage(subtasks.length));
  }
  const description =
    payload.descriptionJson ?? (payload.description ? plainTextToTiptapDoc(payload.description) : undefined);

  // The real write path, as the approving user: status defaults, sort keys,
  // identifiers, activity ("task_created" by the human, via agent),
  // assignment notifications — all of it, none of it re-implemented here.
  const taskId = await createTask(
    ctx,
    auth,
    {
      title: payload.title,
      description,
      statusId: status?._id,
      projectId,
      assigneeIds,
      workCategoryId,
      dueDate: payload.dueDate,
      priority: toPriority(payload.priority),
      labelIds,
    },
    // The project's default assignee only when no assignees were proposed (= tasks.create).
    { defaultAssignee: assigneeIds === undefined, attribution },
  );
  for (const sub of subtasks) await addSubtask(ctx, auth, taskId, sub, attribution);
  return taskId;
}

/** Sub-tasks with no proposed assignee inherit the parent's (= tasks.createSubtask). */
async function addSubtask(
  ctx: MutationCtx,
  auth: AuthContext,
  parentTaskId: Id<"tasks">,
  sub: ProposedSubtask,
  attribution: ActivityAttribution,
): Promise<Id<"tasks">> {
  const assigneeIds = sub.assigneeIds.length > 0 ? await resolveUsers(ctx, sub.assigneeIds) : undefined;
  return await createTask(
    ctx,
    auth,
    { title: sub.title, parentTaskId, assigneeIds, dueDate: sub.dueDate },
    { defaultAssignee: true, attribution },
  );
}

// ─── updateTask: fields + sub-task ops + reopen, one transaction ────────────

const REVIEW_ROLES = new Set(["admin_review", "client_review"]);

async function executeUpdateTask(
  ctx: MutationCtx,
  auth: AuthContext,
  payload: UpdateTaskPayload,
  attribution: ActivityAttribution,
): Promise<string> {
  const { task } = await loadProposalTask(ctx, auth, payload.taskId);
  if (task.archivedAt) throw new ConvexError("The task is archived — restore it first.");
  const subs = payload.subtasks;
  if (subs && task.parentTaskId) throw new ConvexError("A subtask can't have subtasks.");

  // Every referenced sub-task must be a child of THIS task (same org) —
  // resolved before any write.
  const loadSub = async (raw: string): Promise<TaskAccess> => {
    const id = ctx.db.normalizeId("tasks", raw);
    const sub = id ? await ctx.db.get(id) : null;
    if (!sub || sub.orgId !== auth.orgId || sub.parentTaskId !== task._id) {
      throw new ConvexError("A referenced subtask doesn't belong to this task.");
    }
    if (sub.archivedAt) throw new ConvexError(`The subtask "${sub.title}" is archived.`);
    return await loadTaskForWrite(ctx, sub._id, auth);
  };
  const amend = await Promise.all((subs?.amend ?? []).map(async (a) => ({ op: a, access: await loadSub(a.subtaskId) })));
  const cancel = await Promise.all((subs?.cancel ?? []).map((c) => loadSub(c.subtaskId)));
  const tick = await Promise.all((subs?.tick ?? []).map((t) => loadSub(t.subtaskId)));

  for (const sub of subs?.add ?? []) await addSubtask(ctx, auth, task._id, sub, attribution);
  for (const { op, access } of amend) {
    await updateTaskWrite(
      ctx,
      access,
      {
        title: op.title,
        assigneeIds: op.assigneeIds ? await resolveUsers(ctx, op.assigneeIds) : undefined,
        dueDate: op.dueDate,
      },
      { attribution },
    );
  }
  if (cancel.length > 0) {
    // "Canceled" = the canceled category (closed: counts as finished work in
    // subtaskDoneCount, derived.ts) — not archiving, which hides the row.
    const canceled = await defaultStatusFor(ctx, auth.orgId, ["canceled"]);
    for (const access of cancel) {
      await updateTaskWrite(ctx, access, { statusId: canceled.status._id }, { attribution });
    }
  }
  if (tick.length > 0) {
    const done = await defaultStatusFor(ctx, auth.orgId, ["completed"]);
    for (const access of tick) {
      await updateTaskWrite(ctx, access, { statusId: done.status._id }, { attribution });
    }
  }

  // Parent fields last, on a fresh read: the I3 gate in updateTask must see
  // the counters the sub-task ops above just moved.
  const fresh = await loadTaskForWrite(ctx, task._id, auth);
  const changes = payload.changes ?? {};
  const patch: TaskPatch = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.assigneeIds !== undefined) patch.assigneeIds = await resolveUsers(ctx, changes.assigneeIds);
  if (changes.priority !== undefined) patch.priority = toPriority(changes.priority);
  if (changes.dueDate !== undefined) patch.dueDate = changes.dueDate;
  if (changes.workCategoryId !== undefined) {
    patch.workCategoryId =
      changes.workCategoryId === null ? null : await resolveCategory(ctx, auth, changes.workCategoryId);
  }
  if (changes.descriptionJson !== undefined) patch.description = changes.descriptionJson;
  if (changes.statusId) {
    patch.statusId = (await resolveStatus(ctx, auth, changes.statusId))._id;
  } else if (payload.reopen) {
    // Reopen only when the task holds a review role or is closed NOW.
    const current = await ctx.db.get(fresh.task.statusId);
    const inReview = current?.workflowRole !== undefined && REVIEW_ROLES.has(current.workflowRole);
    const closed = fresh.task.statusCategory !== undefined && isClosedCategory(fresh.task.statusCategory);
    if (inReview || closed) patch.statusId = (await resolveStatus(ctx, auth, payload.reopen.statusId))._id;
  }
  await updateTaskWrite(ctx, fresh, patch, { attribution });

  // I3 on the FINAL state: the move gate in updateTask doesn't see sub-tasks
  // added under a task already in admin review — such a change must carry a
  // reopen (D4). If the human edited the reopen away, refuse the whole change.
  const final = (await ctx.db.get(task._id))!;
  const finalStatus = await ctx.db.get(final.statusId);
  const open = (final.subtaskCount ?? 0) - (final.subtaskDoneCount ?? 0);
  if (finalStatus?.workflowRole === "admin_review" && open > 0) {
    throw new ConvexError(openSubtasksMessage(open));
  }
  return task._id;
}

/** Settle a proposal row from an execute outcome; returns the outcome. */
async function settleProposal(
  ctx: MutationCtx,
  auth: AuthContext,
  proposal: Doc<"agentProposals">,
  merged: ProposalPayload,
  hadEdits: boolean,
  outcome: ExecuteOutcome,
): Promise<ExecuteOutcome> {
  const now = Date.now();
  // Persist the human's edits on failure too, so Retry (and a reload)
  // keeps what they typed instead of reverting to the agent's draft. Edits
  // change the effective payload → the revision moves with them (I11).
  const editedPayload = hadEdits ? merged : proposal.editedPayload;
  const revision = hadEdits
    ? proposalRevision(proposal) + 1
    : proposalRevision(proposal);
  if (outcome.ok) {
    await ctx.db.patch(proposal._id, {
      status: "approved",
      editedPayload,
      revision,
      committedRef: outcome.committedRef,
      failureReason: undefined,
      decidedBy: auth.userId,
      decidedAt: now,
    });
  } else {
    await ctx.db.patch(proposal._id, {
      status: "failed",
      editedPayload,
      revision,
      failureReason: outcome.reason,
      decidedBy: auth.userId,
      decidedAt: now,
    });
  }
  return outcome;
}

/** I11: rows written before revisions existed read as revision 1. */
export function proposalRevision(proposal: Doc<"agentProposals">): number {
  return proposal.revision ?? 1;
}

/** Refusal for a decision made on an outdated revision (I11). */
export const STALE_REVISION_MESSAGE = "This changed — review it again.";

/**
 * Load a proposal the caller may DECIDE: write access to its thread under
 * the thread policy (`threadAccess` — the owner of a private thread, any
 * admin in an `admins` thread). The kind's `approveScope` applies on top, in
 * the deciding mutation. A foreign/garbage/forbidden id 404s alike.
 */
async function requireDecidableProposal(
  ctx: MutationCtx,
  auth: AuthContext,
  proposalId: string,
): Promise<Doc<"agentProposals">> {
  const id = ctx.db.normalizeId("agentProposals", proposalId);
  const proposal = id ? await ctx.db.get(id) : null;
  if (!proposal || proposal.orgId !== auth.orgId) {
    throw new ConvexError("Proposal not found");
  }
  const thread = await ctx.db.get(proposal.threadId);
  if (!thread || !threadAccess(thread, auth).canWrite) {
    throw new ConvexError("Proposal not found"); // don't leak existence
  }
  return proposal;
}

/**
 * Normalize an agent-drafted payload for a thread: structural validation,
 * then kinds that point at a task resolve their task reference (an id, or an
 * identifier like `ARLO-21`) to the real id in the thread's org and snapshot
 * display titles, so the card stays renderable after the task is gone.
 * `updateTask` also resolves its sub-task references, which must be children
 * of that task. With `auth` (the actor path), the task must also be readable
 * by the acting user. Throws a model-actionable error (the model corrects
 * and retries).
 */
async function normalizeAgentPayload(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  raw: Infer<typeof proposalPayloadValidator>,
  auth?: AuthContext,
): Promise<ProposalPayload> {
  const validated = validateProposalPayload(raw);
  if (!validated.ok) {
    throw new Error(`Invalid proposal: ${validated.reason}`);
  }
  const payload = validated.payload;
  if (payload.kind === "createTask" || payload.kind === "proposeSkill") return payload;

  const resolveTask = async (ref: string): Promise<Doc<"tasks">> => {
    const taskId = await resolveTaskRef(ctx, thread.orgId, ref);
    const task = taskId ? await ctx.db.get(taskId) : null;
    const readable =
      task !== null &&
      task.orgId === thread.orgId &&
      (!auth || (await loadTaskForReadOrNull(ctx, task._id, auth)) !== null);
    if (!task || !readable) {
      throw new Error(
        `No task found for ${ref}. Use the task's identifier ` +
          "(e.g. ARLO-21) or an @-mentioned task.",
      );
    }
    return task;
  };
  const task = await resolveTask(payload.taskId);
  if (payload.kind === "archiveTask" || payload.kind === "postComment") {
    return { ...payload, taskId: task._id, taskTitle: task.title };
  }

  // updateTask: sub-task refs → ids of THIS task's children.
  const resolveSub = async (ref: string): Promise<Doc<"tasks">> => {
    const sub = await resolveTask(ref);
    if (sub.parentTaskId !== task._id) {
      throw new Error(`${sub.identifier ?? ref} is not a subtask of ${task.identifier ?? payload.taskId}.`);
    }
    return sub;
  };
  const subs = payload.subtasks;
  const withSub = async <T extends { subtaskId: string }>(item: T) => {
    const sub = await resolveSub(item.subtaskId);
    return { ...item, subtaskId: sub._id as string, subtaskTitle: sub.title };
  };
  return {
    ...payload,
    taskId: task._id,
    taskTitle: task.title,
    ...(subs
      ? {
          subtasks: {
            ...subs,
            ...(subs.amend ? { amend: await Promise.all(subs.amend.map(withSub)) } : {}),
            ...(subs.cancel ? { cancel: await Promise.all(subs.cancel.map(withSub)) } : {}),
            ...(subs.tick ? { tick: await Promise.all(subs.tick.map(withSub)) } : {}),
          },
        }
      : {}),
  };
}

// ─── Write (called from propose-kind tools via the actor path) ──────────────

/** The app thread behind a component thread id (proposal tools' tool ctx). */
export async function loadThreadByComponentId(
  ctx: MutationCtx,
  componentThreadId: string,
): Promise<Doc<"agentThreads">> {
  const thread = await ctx.db
    .query("agentThreads")
    .withIndex("by_componentThreadId", (q) =>
      q.eq("componentThreadId", componentThreadId),
    )
    .unique();
  if (!thread) throw new ConvexError("Thread not found for proposal");
  return thread;
}

/**
 * Insert a batch of pending proposals for a thread — the core behind
 * `agentActorTools.createProposals`, the one path every propose-kind tool
 * records through. The tool ctx exposes the component thread id, so the
 * caller resolves the app thread via `by_componentThreadId` and orgId/owner
 * are inherited — a proposal can never be scoped to a different tenant than
 * its thread.
 *
 * Payloads are structurally validated here with the pure validator; an
 * invalid draft throws a model-actionable error (the model corrects and
 * retries). Task-addressed kinds (`archiveTask`, `postComment`,
 * `updateTask`) resolve their task reference (an id, or an identifier like
 * `ARLO-21`) to the real id in the thread's org — readable by the acting
 * user — and snapshot the task's title so the card stays renderable even
 * after the task is deleted (the stale case the engine must display).
 */
export async function insertProposalsForThread(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  proposals: Infer<typeof proposalPayloadValidator>[],
  /** The acting user: task refs must be readable by them. */
  auth: AuthContext,
): Promise<string[]> {
  if (proposals.length === 0 || proposals.length > 25) {
    throw new Error("Propose between 1 and 25 items per call.");
  }
  const now = Date.now();
  const ids: string[] = [];
  for (const raw of proposals) {
    const payload = await normalizeAgentPayload(ctx, thread, raw, auth);
    const id = await ctx.db.insert("agentProposals", {
      orgId: thread.orgId,
      threadId: thread._id,
      userId: thread.userId,
      payload,
      status: "pending",
      revision: 1,
      createdAt: now,
    });
    ids.push(id);
  }
  return ids;
}

/**
 * The agent revises its OWN plan (A2a; for A2b jobs and B6): replace the
 * agent's payload of a still-open proposal in the calling run's thread and
 * bump the revision, so any decision made on the old card is refused (I11).
 * Human edits made on the old draft are dropped — the card now shows the
 * agent's new plan, which the humans review again. The kind cannot change.
 *
 * TODO(B6): plan-revision merging is defined there — owner edits survive a
 * re-plan (PRD D25). Until then a re-plan replaces the effective payload.
 */
export const updateProposalPayload = internalMutation({
  args: {
    componentThreadId: v.string(),
    proposalId: v.string(),
    payload: proposalPayloadValidator,
  },
  handler: async (ctx, args): Promise<{ revision: number }> => {
    const thread = await loadThreadByComponentId(ctx, args.componentThreadId);
    const id = ctx.db.normalizeId("agentProposals", args.proposalId);
    const proposal = id ? await ctx.db.get(id) : null;
    if (!proposal || proposal.threadId !== thread._id) {
      throw new Error(`No proposal ${args.proposalId} in this conversation.`);
    }
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new Error("That proposal has already been decided.");
    }
    const payload = await normalizeAgentPayload(ctx, thread, args.payload);
    if (payload.kind !== proposal.payload.kind) {
      throw new Error("A proposal's kind cannot change — propose a new one.");
    }
    const revision = proposalRevision(proposal) + 1;
    await ctx.db.patch(proposal._id, {
      payload,
      editedPayload: undefined,
      revision,
      status: "pending",
      failureReason: undefined,
    });
    return { revision };
  },
});

// ─── Read (cards) ───────────────────────────────────────────────────────────

/** What a proposal card renders from — the effective payload + live status. */
export type ProposalCard = {
  _id: string;
  threadId: string;
  status: "pending" | "approved" | "discarded" | "failed";
  /** Effective draft: the human's edits when present, else the agent's. */
  payload: ProposalPayload;
  failureReason: string | null;
  committedRef: string | null;
  /** I11: echo it back on approve/updateDraft; a mismatch is refused. */
  revision: number;
};

/**
 * Live card data for a batch of proposal ids (from a tool output's marker).
 * Reactive — status flips and edits update cards in place, and pending
 * cards persist across thread close/reopen because this reads the records,
 * not the message. Readable under the thread policy (`threadAccess`);
 * unknown/foreign/forbidden ids are silently omitted (the card renderer treats a missing id as "no longer available").
 *
 * Ids inside the payload are resolved to display values CLIENT-SIDE from
 * the same reference queries `/tasks` uses — the card shares the app's
 * task-draft pickers, so it shares their data path too.
 */
export const listForCards = query({
  args: { proposalIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<ProposalCard[]> => {
    const auth = await getAuthContext(ctx);
    const cards: ProposalCard[] = [];
    const readableThreads = new Map<Id<"agentThreads">, boolean>();
    for (const rawId of args.proposalIds.slice(0, 50)) {
      const id = ctx.db.normalizeId("agentProposals", rawId);
      const proposal = id ? await ctx.db.get(id) : null;
      if (!proposal || proposal.orgId !== auth.orgId) continue;
      let readable = readableThreads.get(proposal.threadId);
      if (readable === undefined) {
        const thread = await ctx.db.get(proposal.threadId);
        readable = thread ? threadAccess(thread, auth).canRead : false;
        readableThreads.set(proposal.threadId, readable);
      }
      if (!readable) continue;

      // Normalize on the way out (folds the legacy single-assignee field)
      // so the card always sees the current payload shape.
      const raw = proposal.editedPayload ?? proposal.payload;
      const validated = validateProposalPayload(raw);
      cards.push({
        _id: proposal._id,
        threadId: proposal.threadId,
        status: proposal.status,
        payload: validated.ok ? validated.payload : raw,
        failureReason: proposal.failureReason ?? null,
        committedRef: proposal.committedRef ?? null,
        revision: proposalRevision(proposal),
      });
    }
    return cards;
  },
});

// ─── Decisions (thread write access + revision) ─────────────────────────────
//
// Who decides = who may WRITE in the proposal's thread (owner of a private
// thread, any admin in an `admins` thread); the kind's approveScope applies
// on top. Approval executes the domain mutation as the DECIDING user, so the
// activity log shows them. Every decision carries the revision the client
// rendered; an outdated one is refused (I11).

/**
 * Approve one proposal, optionally with inline edits. Outcomes:
 * - permission miss (admin-only kind, member caller) → THROWS; row stays
 *   pending — the intersection rule is visible, not silent.
 * - destructive kind without `confirmDestructive` → THROWS (the UI's
 *   confirm step, enforced server-side too).
 * - stale/rejected reference → settles the row as `failed` + reason and
 *   RETURNS `{ ok: false }` — the card flips to its inline error + Retry.
 * - success → `approved` + committedRef.
 * `failed` rows may be approved again (that IS Retry).
 */
export const approve = mutation({
  args: {
    proposalId: v.string(),
    // The revision the client rendered (I11).
    revision: v.number(),
    editedPayload: v.optional(proposalPayloadValidator),
    confirmDestructive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ExecuteOutcome> => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireDecidableProposal(ctx, auth, args.proposalId);
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new ConvexError("This proposal has already been decided");
    }
    if (args.revision !== proposalRevision(proposal)) {
      throw new ConvexError(STALE_REVISION_MESSAGE);
    }
    const meta = PROPOSAL_KIND_META[proposal.payload.kind];
    if (meta.approveScope === "admin" && !auth.isAdmin) {
      throw new ConvexError(
        "Only an admin can approve this action — the proposal stays pending.",
      );
    }
    if (meta.destructive && args.confirmDestructive !== true) {
      throw new ConvexError("This destructive action requires confirmation");
    }

    // Edits apply over the EFFECTIVE payload: an approve without inline
    // edits commits the stored ones (e.g. another admin's), never silently
    // the agent's original draft.
    const merged = mergeEditedPayload(
      proposal.editedPayload ?? proposal.payload,
      args.editedPayload,
    );
    const validated = validateProposalPayload(merged);
    if (!validated.ok) {
      // Structural problem with the inline edit (e.g. cleared title) — the
      // human can fix the field; don't burn the row into `failed`.
      throw new ConvexError(validated.reason);
    }

    const outcome = await executePayload(ctx, auth, proposal._id, validated.payload);
    return await settleProposal(
      ctx,
      auth,
      proposal,
      validated.payload,
      args.editedPayload !== undefined,
      outcome,
    );
  },
});

/**
 * Persist inline card edits into `editedPayload` (on blur/change), so
 * edits survive thread close/reopen and — critically — so Approve-all
 * commits what the human typed, not the agent's original draft. Merge is
 * whitelisted per kind; a structurally invalid draft (e.g. cleared title)
 * throws so the field error surfaces immediately instead of at approve.
 *
 * I11: bumps the revision and returns it. `revision` is the base the edit
 * was made on — when outdated (another admin edited, or the agent revised its
 * plan), the edit is refused instead of silently overwriting theirs. Merges
 * over the EFFECTIVE payload, exactly like `approve`.
 */
export const updateDraft = mutation({
  args: {
    proposalId: v.string(),
    editedPayload: proposalPayloadValidator,
    revision: v.number(),
  },
  handler: async (ctx, args): Promise<{ revision: number }> => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireDecidableProposal(ctx, auth, args.proposalId);
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new ConvexError("This proposal has already been decided");
    }
    const current = proposalRevision(proposal);
    if (args.revision !== current) {
      throw new ConvexError(STALE_REVISION_MESSAGE);
    }
    const merged = mergeEditedPayload(
      proposal.editedPayload ?? proposal.payload,
      args.editedPayload,
    );
    const validated = validateProposalPayload(merged);
    if (!validated.ok) throw new ConvexError(validated.reason);
    const revision = current + 1;
    await ctx.db.patch(proposal._id, {
      editedPayload: validated.payload,
      revision,
    });
    return { revision };
  },
});

/** Discard a pending (or failed) proposal — nothing is ever written. */
export const discard = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireDecidableProposal(ctx, auth, args.proposalId);
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new ConvexError("This proposal has already been decided");
    }
    await ctx.db.patch(proposal._id, {
      status: "discarded",
      decidedBy: auth.userId,
      decidedAt: Date.now(),
    });
    return null;
  },
});

/** Per-item result of an Approve-all pass. */
export type ApproveAllOutcome = {
  proposalId: string;
  result: "approved" | "failed" | "needs_confirm" | "needs_admin";
  reason: string | null;
};

/**
 * Approve the PENDING proposals the client rendered in its "Approve all"
 * bar, oldest first, with per-item outcomes and no all-or-nothing rollback:
 * one item failing (stale reference) settles that row as `failed` and the
 * loop continues.
 *
 * I11: `items` carries the revision of each card as rendered. Only those
 * proposals are considered — one that arrived after the render is never
 * approved unseen — and if any of them changed since (edited by another
 * admin, revised by the agent) the WHOLE call is refused before anything is
 * executed. Items already decided meanwhile, and repeated ids, are skipped;
 * each row is re-read right before it executes.
 *
 * Two kinds are never mass-committed: destructive kinds (they demand their
 * per-card confirm step even under Approve-all — enforced here, not just
 * in the UI) and admin-scoped kinds when the caller is a member. Both are
 * skipped and stay pending.
 */
export const approveAll = mutation({
  args: {
    threadId: v.string(),
    items: v.array(
      v.object({ proposalId: v.string(), revision: v.number() }),
    ),
  },
  handler: async (ctx, args): Promise<ApproveAllOutcome[]> => {
    const auth = await getAuthContext(ctx);
    const threadId = ctx.db.normalizeId("agentThreads", args.threadId);
    if (!threadId) throw new ConvexError("Thread not found");
    const { thread } = await requireThreadAccess(ctx, auth, threadId, "write");

    const pending: Doc<"agentProposals">[] = [];
    const seen = new Set<string>();
    for (const item of args.items.slice(0, 100)) {
      // A repeated id would execute the same proposal twice — skip repeats.
      if (seen.has(item.proposalId)) continue;
      seen.add(item.proposalId);
      const id = ctx.db.normalizeId("agentProposals", item.proposalId);
      const proposal = id ? await ctx.db.get(id) : null;
      if (!proposal || proposal.threadId !== thread._id) continue;
      if (proposal.status !== "pending") continue; // decided meanwhile
      if (proposalRevision(proposal) !== item.revision) {
        throw new ConvexError(STALE_REVISION_MESSAGE);
      }
      pending.push(proposal);
    }
    pending.sort((a, b) => a.createdAt - b.createdAt);

    const outcomes: ApproveAllOutcome[] = [];
    for (const checked of pending) {
      // Re-read right before executing: an earlier item's domain mutation
      // runs nested in this transaction, so never trust the pre-check row.
      const proposal = await ctx.db.get(checked._id);
      if (
        !proposal ||
        proposal.status !== "pending" ||
        proposalRevision(proposal) !== proposalRevision(checked)
      ) {
        continue;
      }
      const meta = PROPOSAL_KIND_META[proposal.payload.kind];
      if (meta.destructive) {
        outcomes.push({
          proposalId: proposal._id,
          result: "needs_confirm",
          reason: null,
        });
        continue;
      }
      if (meta.approveScope === "admin" && !auth.isAdmin) {
        outcomes.push({
          proposalId: proposal._id,
          result: "needs_admin",
          reason: null,
        });
        continue;
      }
      // Approve with the stored edits (the card auto-saves edits into
      // editedPayload via `updateDraft`; here we take whatever is on the row).
      const merged = proposal.editedPayload ?? proposal.payload;
      const validated = validateProposalPayload(merged);
      const outcome = validated.ok
        ? await executePayload(ctx, auth, proposal._id, validated.payload)
        : { ok: false as const, reason: validated.reason };
      await settleProposal(ctx, auth, proposal, merged, false, outcome);
      outcomes.push({
        proposalId: proposal._id,
        result: outcome.ok ? "approved" : "failed",
        reason: outcome.ok ? null : outcome.reason,
      });
    }
    return outcomes;
  },
});

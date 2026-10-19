import { v, ConvexError, type Infer } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthContext, type AuthContext } from "./lib/auth";
import { proposalPayloadValidator } from "./lib/proposalValidators";
import { resolveTaskRef } from "./tasks/agent";
import {
  mergeEditedPayload,
  plainTextToTiptapDoc,
  PROPOSAL_KIND_META,
  validateProposalPayload,
  type ProposalPayload,
} from "../lib/agents/proposals";

/** Human-readable reason from a rejected domain mutation. */
function rejectionReason(err: unknown, fallback: string): string {
  if (err instanceof ConvexError) return String(err.data ?? fallback);
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/**
 * Proposal engine (PRD Module 3 · slice 08) — the ONLY path from agent
 * intent to domain writes.
 *
 * Lifecycle: a propose-kind registry tool inserts a `pending` row via
 * `createFromTool` (never touching domain tables); the chat renders the row
 * as an editable card; `approve` validates the (possibly edited) payload
 * against CURRENT data and executes the mapped domain mutation via
 * `ctx.runMutation(api.…)` — so the domain function's own auth runs with
 * the APPROVING USER's identity (D6) and its activity log shows the human,
 * never the agent. Stale references settle the row as `failed` (retryable);
 * a permission miss throws and the row STAYS `pending`.
 */

// ─── Kind → domain mutation mapping ─────────────────────────────────────────

type ExecuteOutcome =
  | { ok: true; committedRef: string }
  | { ok: false; reason: string };

/**
 * Validate a payload's references against current data and execute the
 * mapped domain mutation as the caller. Reference misses return a clear
 * `failed` reason (the stale case is expected, not exceptional); domain
 * mutation rejections are caught and surfaced the same way — the sub-
 * mutation's writes roll back, the proposal row still settles.
 */
async function executePayload(
  ctx: MutationCtx,
  auth: AuthContext,
  payload: ProposalPayload,
): Promise<ExecuteOutcome> {
  if (payload.kind === "createTask") {
    let projectId: Id<"projects"> | undefined;
    if (payload.projectId) {
      const normalized = ctx.db.normalizeId("projects", payload.projectId);
      const project = normalized ? await ctx.db.get(normalized) : null;
      if (!project || project.orgId !== auth.orgId || project.archivedAt) {
        return {
          ok: false,
          reason: "The referenced project no longer exists.",
        };
      }
      projectId = project._id;
    }
    let assigneeIds: Id<"users">[] | undefined;
    if (payload.assigneeIds && payload.assigneeIds.length > 0) {
      assigneeIds = [];
      for (const raw of payload.assigneeIds) {
        const normalized = ctx.db.normalizeId("users", raw);
        const assignee = normalized ? await ctx.db.get(normalized) : null;
        if (!assignee || assignee.deletedAt) {
          return {
            ok: false,
            reason: "A proposed assignee is no longer available.",
          };
        }
        assigneeIds.push(assignee._id);
      }
    }
    let workCategoryId: Id<"workCategories"> | undefined;
    if (payload.workCategoryId) {
      const normalized = ctx.db.normalizeId(
        "workCategories",
        payload.workCategoryId,
      );
      const category = normalized ? await ctx.db.get(normalized) : null;
      if (!category || category.orgId !== auth.orgId || category.archivedAt) {
        return {
          ok: false,
          reason: "The referenced work category no longer exists.",
        };
      }
      workCategoryId = category._id;
    }
    try {
      // The real domain mutation, as the approving user: status defaults,
      // sort keys, activity log ("task_created" by the human), assignment
      // notifications — all of it, none of it re-implemented here.
      const taskId: Id<"tasks"> = await ctx.runMutation(api.tasks.create, {
        title: payload.title,
        description: payload.description
          ? plainTextToTiptapDoc(payload.description)
          : undefined,
        projectId,
        assigneeIds,
        workCategoryId,
        dueDate: payload.dueDate,
      });
      return { ok: true, committedRef: taskId };
    } catch (err) {
      return { ok: false, reason: rejectionReason(err, "Task creation failed.") };
    }
  }

  // archiveTask (dev-only destructive kind)
  const normalized = ctx.db.normalizeId("tasks", payload.taskId);
  const task = normalized ? await ctx.db.get(normalized) : null;
  if (!task || task.orgId !== auth.orgId) {
    return { ok: false, reason: "The referenced task no longer exists." };
  }
  if (task.archivedAt) {
    return { ok: false, reason: "The task is already archived." };
  }
  try {
    await ctx.runMutation(api.tasks.archive, { id: task._id });
    return { ok: true, committedRef: task._id };
  } catch (err) {
    return { ok: false, reason: rejectionReason(err, "Archiving failed.") };
  }
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
  // keeps what they typed instead of reverting to the agent's draft.
  const editedPayload = hadEdits ? merged : proposal.editedPayload;
  if (outcome.ok) {
    await ctx.db.patch(proposal._id, {
      status: "approved",
      editedPayload,
      committedRef: outcome.committedRef,
      failureReason: undefined,
      decidedBy: auth.userId,
      decidedAt: now,
    });
  } else {
    await ctx.db.patch(proposal._id, {
      status: "failed",
      editedPayload,
      failureReason: outcome.reason,
      decidedBy: auth.userId,
      decidedAt: now,
    });
  }
  return outcome;
}

/** Owner-only load; a foreign/garbage id 404s without leaking existence. */
async function requireOwnProposal(
  ctx: MutationCtx,
  auth: AuthContext,
  proposalId: string,
): Promise<Doc<"agentProposals">> {
  const id = ctx.db.normalizeId("agentProposals", proposalId);
  const proposal = id ? await ctx.db.get(id) : null;
  if (
    !proposal ||
    proposal.orgId !== auth.orgId ||
    proposal.userId !== auth.userId
  ) {
    throw new ConvexError("Proposal not found");
  }
  return proposal;
}

// ─── Write (internal — called from propose-kind tools) ──────────────────────

/**
 * Insert a batch of pending proposals for a component thread. The tool ctx
 * exposes the component thread id, so the app thread is resolved via
 * `by_componentThreadId` and orgId/owner are inherited — a proposal can
 * never be scoped to a different tenant than its thread (same pattern as
 * `agentArtifacts.createForThread`).
 *
 * Payloads are structurally validated here with the pure validator; an
 * invalid draft throws a model-actionable error (the model corrects and
 * retries). `archiveTask` additionally resolves the task reference (an id,
 * or an identifier like `ARLO-21` — the tool resolves it with the running
 * user's access first) to the real id in the thread's org and snapshots the
 * task's title so the card stays renderable even after the task is deleted
 * — that IS the stale case the engine must display.
 */
export const createFromTool = internalMutation({
  args: {
    componentThreadId: v.string(),
    proposals: v.array(proposalPayloadValidator),
  },
  handler: async (ctx, args): Promise<string[]> => {
    const thread = await loadThreadByComponentId(ctx, args.componentThreadId);
    return await insertProposalsForThread(ctx, thread, args.proposals);
  },
});

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
 * Shared core of proposal creation — `createFromTool` (ctx.auth-path tools)
 * and the agent actor path (`agentActorTools.createProposals`) both insert
 * through here, so validation and scoping never fork.
 */
export async function insertProposalsForThread(
  ctx: MutationCtx,
  thread: Doc<"agentThreads">,
  proposals: Infer<typeof proposalPayloadValidator>[],
): Promise<string[]> {
  if (proposals.length === 0 || proposals.length > 25) {
    throw new Error("Propose between 1 and 25 items per call.");
  }
  const now = Date.now();
  const ids: string[] = [];
  for (const raw of proposals) {
    const validated = validateProposalPayload(raw);
    if (!validated.ok) {
      throw new Error(`Invalid proposal: ${validated.reason}`);
    }
    let payload = validated.payload;
    if (payload.kind === "archiveTask") {
      const taskId = await resolveTaskRef(ctx, thread.orgId, payload.taskId);
      const task = taskId ? await ctx.db.get(taskId) : null;
      if (!task || task.orgId !== thread.orgId) {
        throw new Error(
          `No task found for ${payload.taskId}. Use the task's identifier ` +
            "(e.g. ARLO-21) or an @-mentioned task.",
        );
      }
      payload = { ...payload, taskId: task._id, taskTitle: task.title };
    }
    const id = await ctx.db.insert("agentProposals", {
      orgId: thread.orgId,
      threadId: thread._id,
      userId: thread.userId,
      payload,
      status: "pending",
      createdAt: now,
    });
    ids.push(id);
  }
  return ids;
}

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
};

/**
 * Live card data for a batch of proposal ids (from a tool output's marker).
 * Reactive — status flips and edits update cards in place, and pending
 * cards persist across thread close/reopen because this reads the records,
 * not the message. Owner or org admin; unknown/foreign ids are silently
 * omitted (the card renderer treats a missing id as "no longer available").
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
    for (const rawId of args.proposalIds.slice(0, 50)) {
      const id = ctx.db.normalizeId("agentProposals", rawId);
      const proposal = id ? await ctx.db.get(id) : null;
      if (!proposal || proposal.orgId !== auth.orgId) continue;
      if (proposal.userId !== auth.userId && !auth.isAdmin) continue;

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
      });
    }
    return cards;
  },
});

// ─── Decisions (owner-only mutations) ───────────────────────────────────────

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
    editedPayload: v.optional(proposalPayloadValidator),
    confirmDestructive: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ExecuteOutcome> => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireOwnProposal(ctx, auth, args.proposalId);
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new ConvexError("This proposal has already been decided");
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

    const merged = mergeEditedPayload(proposal.payload, args.editedPayload);
    const validated = validateProposalPayload(merged);
    if (!validated.ok) {
      // Structural problem with the inline edit (e.g. cleared title) — the
      // human can fix the field; don't burn the row into `failed`.
      throw new ConvexError(validated.reason);
    }

    const outcome = await executePayload(ctx, auth, validated.payload);
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
 */
export const updateDraft = mutation({
  args: {
    proposalId: v.string(),
    editedPayload: proposalPayloadValidator,
  },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireOwnProposal(ctx, auth, args.proposalId);
    if (proposal.status !== "pending" && proposal.status !== "failed") {
      throw new ConvexError("This proposal has already been decided");
    }
    const merged = mergeEditedPayload(proposal.payload, args.editedPayload);
    const validated = validateProposalPayload(merged);
    if (!validated.ok) throw new ConvexError(validated.reason);
    await ctx.db.patch(proposal._id, { editedPayload: validated.payload });
    return null;
  },
});

/** Discard a pending (or failed) proposal — nothing is ever written. */
export const discard = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getAuthContext(ctx);
    const proposal = await requireOwnProposal(ctx, auth, args.proposalId);
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
 * Approve every PENDING proposal in a thread, oldest first, with per-item
 * outcomes and no all-or-nothing rollback: one item failing (stale
 * reference) settles that row as `failed` and the loop continues.
 *
 * Two kinds are never mass-committed: destructive kinds (they demand their
 * per-card confirm step even under Approve-all — enforced here, not just
 * in the UI) and admin-scoped kinds when the caller is a member. Both are
 * skipped and stay pending.
 */
export const approveAll = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args): Promise<ApproveAllOutcome[]> => {
    const auth = await getAuthContext(ctx);
    const threadId = ctx.db.normalizeId("agentThreads", args.threadId);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    if (
      !thread ||
      thread.orgId !== auth.orgId ||
      thread.userId !== auth.userId
    ) {
      throw new ConvexError("Thread not found");
    }

    const pending = await ctx.db
      .query("agentProposals")
      .withIndex("by_threadId_status", (q) =>
        q.eq("threadId", thread._id).eq("status", "pending"),
      )
      .take(100);
    pending.sort((a, b) => a.createdAt - b.createdAt);

    const outcomes: ApproveAllOutcome[] = [];
    for (const proposal of pending) {
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
      // editedPayload via `approve`; here we take whatever is on the row).
      const merged = proposal.editedPayload ?? proposal.payload;
      const validated = validateProposalPayload(merged);
      const outcome = validated.ok
        ? await executePayload(ctx, auth, validated.payload)
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

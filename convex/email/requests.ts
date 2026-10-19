import { v, ConvexError } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireEmailTriageEnabled } from "./gate";
import type { RequestIntent } from "./jobs";

/**
 * The request ledger — `clientRequests` (docs/prd-email-triage.md §4.1,
 * §6.1, §6.3, I12). Nothing the client asked can get lost: every request of
 * an inbound email becomes a row, and every row must reach a disposition
 * other than `open` before Create / Send (I12, checked by B6).
 *
 *   applyLedgerRequests  the classify write (B4): the §6.3 ledger effect per
 *                        intent — add / approve-with-action / ask → new row,
 *                        clarify → constraints added to the referenced row,
 *                        replace → new row + old row `superseded`,
 *                        cancel → old row `dismissed` ("client cancelled")
 *   cover / answer /     the dispositions B6 (prepareTask, kickoff reply)
 *   dismiss / supersede  writes — internal mutations, not wired to UI yet
 *
 * References only ever touch rows of the SAME org and the SAME conversation:
 * a `refersToRequestId` from model output is normalised and re-checked here,
 * and an id from anywhere else is ignored (a clarify / replace then falls
 * back to a new row, a cancel does nothing — nothing is lost either way).
 */

export const CLIENT_CANCELLED_REASON = "client cancelled";
export const DECLINED_REASON = "declined";

const THREAD_ROWS_CAP = 200;
const CONSTRAINTS_CAP = 40;

export type LedgerConstraint = { kind: string; value: string };
export type LedgerWarning = { kind: "constraint_not_verbatim"; detail: string };

export type LedgerRequestInput = {
  text: string;
  constraints: LedgerConstraint[];
  intent: RequestIntent;
  /** For clarify / replace / cancel: the row it touches (model output — untrusted). */
  refersToRequestId?: string | null;
  warnings?: LedgerWarning[];
};

export type LedgerApplyResult = {
  created: Id<"clientRequests">[];
  clarified: Id<"clientRequests">[];
  superseded: Id<"clientRequests">[];
  cancelled: Id<"clientRequests">[];
  /** References that were not a row of this conversation (ignored). */
  ignoredReferences: string[];
  /** True when the message's rows already existed (a re-run wrote nothing). */
  alreadyApplied: boolean;
};

/** Rows of one conversation (bounded; a thread has a handful). */
export async function threadRequests(
  ctx: MutationCtx,
  orgId: string,
  threadId: Id<"emailThreads">,
): Promise<Doc<"clientRequests">[]> {
  return await ctx.db
    .query("clientRequests")
    .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", threadId))
    .take(THREAD_ROWS_CAP);
}

/** A row id from model output → the row, only when it belongs to this org + conversation. */
function resolveReference(
  rows: readonly Doc<"clientRequests">[],
  ref: string | null | undefined,
): Doc<"clientRequests"> | null {
  if (!ref) return null;
  return rows.find((r) => r._id === ref) ?? null;
}

const isLive = (row: Doc<"clientRequests">) =>
  row.disposition !== "superseded" && row.disposition !== "dismissed";

function mergeConstraints(
  existing: readonly LedgerConstraint[] | undefined,
  added: readonly LedgerConstraint[],
): LedgerConstraint[] {
  const out = [...(existing ?? [])];
  for (const c of added) {
    if (!out.some((e) => e.kind === c.kind && e.value === c.value)) out.push(c);
  }
  return out.slice(0, CONSTRAINTS_CAP);
}

function mergeWarnings(
  existing: readonly LedgerWarning[] | undefined,
  added: readonly LedgerWarning[] | undefined,
): LedgerWarning[] | undefined {
  const out = [...(existing ?? [])];
  for (const w of added ?? []) {
    if (!out.some((e) => e.kind === w.kind && e.detail === w.detail)) out.push(w);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Write one message's requests into the ledger (§6.3 effects). Idempotent:
 * when rows created from this message already exist, nothing is written
 * again (the classify stage also guards on `stage`, so a retried write never
 * reaches this twice; this is the second lock).
 */
export async function applyLedgerRequests(
  ctx: MutationCtx,
  args: {
    orgId: string;
    clientId?: Id<"clients">;
    threadId: Id<"emailThreads">;
    messageId: Id<"emailMessages">;
    requests: readonly LedgerRequestInput[];
  },
): Promise<LedgerApplyResult> {
  const result: LedgerApplyResult = {
    created: [],
    clarified: [],
    superseded: [],
    cancelled: [],
    ignoredReferences: [],
    alreadyApplied: false,
  };
  const rows = await threadRequests(ctx, args.orgId, args.threadId);
  if (rows.some((r) => r.messageId === args.messageId)) {
    result.alreadyApplied = true;
    return result;
  }
  const now = Date.now();
  // `rows` is the in-memory snapshot the references resolve against: every
  // write below refreshes it, so a later request of the SAME message sees the
  // row's new state (replace → cancel on one row, two replaces) and never
  // re-transitions a row that is already superseded / dismissed.
  const refresh = async (id: Id<"clientRequests">) => {
    const doc = (await ctx.db.get(id))!;
    const i = rows.findIndex((r) => r._id === id);
    if (i >= 0) rows[i] = doc;
    else rows.push(doc);
  };
  const insert = async (req: LedgerRequestInput): Promise<Id<"clientRequests">> => {
    const id = await ctx.db.insert("clientRequests", {
      orgId: args.orgId,
      clientId: args.clientId,
      threadId: args.threadId,
      messageId: args.messageId,
      text: req.text,
      constraints: req.constraints.length > 0 ? req.constraints.slice(0, CONSTRAINTS_CAP) : undefined,
      intent: req.intent,
      warnings: req.warnings && req.warnings.length > 0 ? req.warnings : undefined,
      disposition: "open",
      createdAt: now,
      updatedAt: now,
    });
    result.created.push(id);
    await refresh(id);
    return id;
  };

  for (const req of args.requests) {
    const needsRef = req.intent === "clarify" || req.intent === "replace" || req.intent === "cancel";
    const target = needsRef ? resolveReference(rows, req.refersToRequestId) : null;
    if (needsRef && req.refersToRequestId && !target) {
      result.ignoredReferences.push(req.refersToRequestId);
    }
    const liveTarget = target && isLive(target) ? target : null;

    switch (req.intent) {
      case "clarify": {
        if (!liveTarget) {
          // Nothing to clarify on this conversation — keep it as its own row.
          await insert(req);
          break;
        }
        // The clarification itself is kept: its constraints, or the sentence.
        const added = req.constraints.length > 0 ? req.constraints : [{ kind: "clarification", value: req.text }];
        await ctx.db.patch(liveTarget._id, {
          constraints: mergeConstraints(liveTarget.constraints, added),
          warnings: mergeWarnings(liveTarget.warnings, req.warnings),
          updatedAt: now,
        });
        await refresh(liveTarget._id);
        result.clarified.push(liveTarget._id);
        break;
      }
      case "replace": {
        const id = await insert(req);
        if (liveTarget) {
          await ctx.db.patch(liveTarget._id, { disposition: "superseded", supersededBy: id, updatedAt: now });
          await refresh(liveTarget._id);
          result.superseded.push(liveTarget._id);
        }
        break;
      }
      case "cancel": {
        if (liveTarget) {
          await ctx.db.patch(liveTarget._id, {
            disposition: "dismissed",
            dismissedReason: CLIENT_CANCELLED_REASON,
            updatedAt: now,
          });
          await refresh(liveTarget._id);
          result.cancelled.push(liveTarget._id);
        }
        break;
      }
      case "add":
      case "approve": // only an approve WITH an action reaches the ledger
      case "ask": // stays `open` — the B6 reply draft answers it
        await insert(req);
        break;
    }
  }
  return result;
}

/** Decline (D28): the conversation's unresolved rows become `dismissed` ("declined"). */
export async function dismissOpenRequestsOfThread(
  ctx: MutationCtx,
  orgId: string,
  threadId: Id<"emailThreads">,
  reason: string,
): Promise<Id<"clientRequests">[]> {
  const now = Date.now();
  const dismissed: Id<"clientRequests">[] = [];
  for (const row of await threadRequests(ctx, orgId, threadId)) {
    if (row.disposition !== "open" && row.disposition !== "question_pending") continue;
    await ctx.db.patch(row._id, { disposition: "dismissed", dismissedReason: reason, updatedAt: now });
    dismissed.push(row._id);
  }
  return dismissed;
}

// ─── The plan's dispositions (B6a) ────────────────────────────────────────────

export type PlannedDisposition = {
  requestId: Id<"clientRequests">;
  disposition: "covered" | "answered" | "question_pending" | "dismissed";
  proposalId?: Id<"agentProposals">;
  taskIndex?: number;
  subtaskIndex?: number;
  question?: string;
  reason?: string;
};

/**
 * Write a plan's dispositions onto the conversation's ledger (B6a, I12,
 * D20 "prepare freely, commit once"). Every unresolved row (open /
 * question_pending) gets the plan's `planned` disposition; only
 * `question_pending` also becomes the row's `disposition` (a covered row goes
 * back to `open` from an earlier question). `covered`, `answered` and
 * `dismissed` stay PROVISIONAL: Create (B6b) turns `covered` into the
 * subtask id, a sent reply marks `answered` (`markRequestsAnsweredBySend`),
 * and nothing is dismissed for good before the owner commits. Unresolved rows
 * the plan left out lose a stale `planned` (they show as gaps). Rows of
 * another conversation or org, and resolved rows, are never touched.
 */
export async function recordPlannedDispositions(
  ctx: MutationCtx,
  args: {
    orgId: string;
    /** The conversation: the thread and its copies in other mailboxes (B5 `conversationThreads`). */
    threadIds: readonly Id<"emailThreads">[];
    planRevision: number;
    dispositions: readonly PlannedDisposition[];
  },
): Promise<{ written: number }> {
  const rows = (await Promise.all(args.threadIds.map((id) => threadRequests(ctx, args.orgId, id)))).flat();
  const byId = new Map(args.dispositions.map((d) => [d.requestId as string, d] as const));
  const now = Date.now();
  let written = 0;
  for (const row of rows) {
    if (row.disposition !== "open" && row.disposition !== "question_pending") continue;
    const d = byId.get(row._id);
    if (!d) {
      if (row.planned || row.disposition === "question_pending") {
        await ctx.db.patch(row._id, { planned: undefined, disposition: "open", updatedAt: now });
      }
      continue;
    }
    await ctx.db.patch(row._id, {
      disposition: d.disposition === "question_pending" ? "question_pending" : "open",
      planned: {
        disposition: d.disposition,
        ...(d.proposalId ? { proposalId: d.proposalId } : {}),
        ...(d.taskIndex !== undefined ? { taskIndex: d.taskIndex } : {}),
        ...(d.subtaskIndex !== undefined ? { subtaskIndex: d.subtaskIndex } : {}),
        ...(d.question?.trim() ? { question: d.question.trim().slice(0, 500) } : {}),
        ...(d.reason?.trim() ? { reason: d.reason.trim().slice(0, 500) } : {}),
        planRevision: args.planRevision,
        at: now,
      },
      updatedAt: now,
    });
    written++;
  }
  return { written };
}

// ─── Dispositions for B6 (internal; not wired to UI yet) ──────────────────────

/** Load rows by id for an org; throws on a missing or foreign row (no partial writes). */
async function loadOwnRows(
  ctx: MutationCtx,
  orgId: string,
  ids: readonly Id<"clientRequests">[],
): Promise<Doc<"clientRequests">[]> {
  if (ids.length === 0) throw new ConvexError("No requests given");
  if (ids.length > THREAD_ROWS_CAP) throw new ConvexError("Too many requests");
  const rows: Doc<"clientRequests">[] = [];
  for (const id of ids) {
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== orgId) throw new ConvexError("Request not found");
    rows.push(row);
  }
  // Every email ledger write sits behind the feature (I14).
  if (rows.some((r) => r.threadId)) await requireEmailTriageEnabled(ctx, orgId);
  return rows;
}

function assertNotFinal(row: Doc<"clientRequests">): void {
  if (row.disposition === "superseded" || row.disposition === "dismissed") {
    throw new ConvexError(`Request is already ${row.disposition}`);
  }
}

/** Covered by a task / subtask (Create, an applied change). */
export const cover = internalMutation({
  args: {
    orgId: v.string(),
    requestIds: v.array(v.id("clientRequests")),
    taskId: v.id("tasks"),
    subtaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args): Promise<null> => {
    const rows = await loadOwnRows(ctx, args.orgId, args.requestIds);
    const task = await ctx.db.get(args.taskId);
    if (!task || task.orgId !== args.orgId) throw new ConvexError("Task not found");
    if (args.subtaskId) {
      const sub = await ctx.db.get(args.subtaskId);
      if (!sub || sub.orgId !== args.orgId || sub.parentTaskId !== args.taskId) {
        throw new ConvexError("Subtask not found");
      }
    }
    const now = Date.now();
    for (const row of rows) {
      assertNotFinal(row);
      await ctx.db.patch(row._id, {
        disposition: "covered",
        taskId: args.taskId,
        subtaskId: args.subtaskId,
        updatedAt: now,
      });
    }
    return null;
  },
});

/** Answered by a sent reply (an `ask` row). */
export const answer = internalMutation({
  args: { orgId: v.string(), requestIds: v.array(v.id("clientRequests")) },
  handler: async (ctx, args): Promise<null> => {
    const rows = await loadOwnRows(ctx, args.orgId, args.requestIds);
    const now = Date.now();
    for (const row of rows) {
      assertNotFinal(row);
      await ctx.db.patch(row._id, { disposition: "answered", updatedAt: now });
    }
    return null;
  },
});

/**
 * A sent reply answered these rows (B5, §5.4 "mark the answered ledger
 * rows"). Lenient on purpose — Gmail already accepted the email, so nothing
 * here may throw: rows that are gone, of another org, of another
 * conversation, or already final (superseded / dismissed) are skipped. A row
 * belongs when it is on one of `threadIds`, or — an Agents-workspace row
 * with no email thread (§6.10) — on the draft's `agentThreadId`. Returns
 * the rows it marked.
 */
export async function markRequestsAnsweredBySend(
  ctx: MutationCtx,
  args: {
    orgId: string;
    threadIds: readonly Id<"emailThreads">[];
    agentThreadId?: Id<"agentThreads">;
    requestIds: readonly Id<"clientRequests">[];
  },
): Promise<Id<"clientRequests">[]> {
  const marked: Id<"clientRequests">[] = [];
  const now = Date.now();
  for (const id of args.requestIds.slice(0, THREAD_ROWS_CAP)) {
    const row = await ctx.db.get(id);
    if (!row || row.orgId !== args.orgId) continue;
    const onThread = row.threadId !== undefined && args.threadIds.includes(row.threadId);
    const onAgentThread = !row.threadId && !!args.agentThreadId && row.agentThreadId === args.agentThreadId;
    if (!onThread && !onAgentThread) continue;
    if (row.disposition === "superseded" || row.disposition === "dismissed" || row.disposition === "answered") continue;
    await ctx.db.patch(row._id, { disposition: "answered", updatedAt: now });
    marked.push(row._id);
  }
  return marked;
}

/** Dismissed — always with a reason (I12). */
export const dismiss = internalMutation({
  args: { orgId: v.string(), requestId: v.id("clientRequests"), reason: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const reason = args.reason.trim();
    if (!reason) throw new ConvexError("A dismissed request needs a reason");
    if (reason.length > 500) throw new ConvexError("Reason must be 500 characters or fewer");
    const [row] = await loadOwnRows(ctx, args.orgId, [args.requestId]);
    assertNotFinal(row);
    await ctx.db.patch(row._id, { disposition: "dismissed", dismissedReason: reason, updatedAt: Date.now() });
    return null;
  },
});

/** `requestId` is replaced by `supersededBy` — both rows of the same conversation. */
export const supersede = internalMutation({
  args: {
    orgId: v.string(),
    requestId: v.id("clientRequests"),
    supersededBy: v.id("clientRequests"),
  },
  handler: async (ctx, args): Promise<null> => {
    if (args.requestId === args.supersededBy) throw new ConvexError("A request cannot supersede itself");
    const [row, by] = await loadOwnRows(ctx, args.orgId, [args.requestId, args.supersededBy]);
    if (row.threadId !== by.threadId || row.agentThreadId !== by.agentThreadId) {
      throw new ConvexError("Both requests must belong to the same conversation");
    }
    assertNotFinal(row);
    assertNotFinal(by);
    await ctx.db.patch(row._id, { disposition: "superseded", supersededBy: by._id, updatedAt: Date.now() });
    return null;
  },
});

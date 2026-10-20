import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  closeEmailItem,
  findFilteredItem,
  findLiveItem,
  joinItem,
  OPEN_ATTENTION_MESSAGE,
  openAttentions,
  openItem,
  type ItemKind,
} from "../agentItems";
import { deleteContentForStorage } from "../attachmentContents";
import { extractTaskIdentifiers } from "./model";
import { DECLINED_REASON, dismissOpenRequestsOfThread, threadRequests } from "./requests";
import { loadEmailItemForAdmin } from "./items";
import { UNSENT_DRAFT_STATES } from "./draftState";
import { notifyAdminsOfEmailEvent } from "./inbox";
import { markConversationDraftsStale, staleReasonForInbound } from "./drafts";
import type { Intent } from "./jobs";
import { requestPlanningSafely } from "./prepare";

/**
 * Dispatch after classification (docs/prd-email-triage.md §5.3, D4, D24,
 * D25, D27, D28, D32, I13) and the email-specific item actions.
 *
 *   decideDispatch    the §5.3 table as a pure function (unit-tested row by row)
 *   dispatchMessage   the `classified → handled` stage: facts → decision →
 *                     join the conversation's live item (I13) or open one, or
 *                     an Inbox `no_action` row; an item that needs a plan
 *                     starts its job (prepareTask — B6a; prepareChange / the
 *                     kickoff draftReply — B6b; email/prepare.requestPlanning)
 *   declineItem       D28 — the item closes as declined, its open ledger rows
 *                     become `dismissed` ("declined")
 *   purgeFiltered     the daily D24 retention cron (filtered items + their
 *                     messages after 30 days)
 */

// ─── The §5.3 table ───────────────────────────────────────────────────────────

export type DispatchFacts = {
  /** A client on the thread, or a linked task (a tracked thread). */
  knownSender: boolean;
  /** The mailbox the email arrived in belongs to an org admin (D24). */
  mailboxOwnerIsAdmin: boolean;
  linked: { taskId: Id<"tasks">; workflowRole?: string } | null;
  intents: readonly Intent[];
  triggers: readonly string[];
  /** An approve that asks for an action ("mehet élesbe"). */
  approveHasAction: boolean;
  senderScreen?: { possibleClient: boolean };
};

export type DispatchDecision =
  | { action: "item"; kind: ItemKind; status: "open" | "filtered"; taskId?: Id<"tasks"> }
  | { action: "no_action" }
  | { action: "nothing"; reason: string };

const CHANGE_INTENTS: readonly Intent[] = ["add", "clarify", "replace", "cancel"];

export function decideDispatch(f: DispatchFacts): DispatchDecision {
  // Unknown sender (D24): admin mailbox → screened; member mailbox → never stored.
  if (!f.knownSender) {
    if (!f.mailboxOwnerIsAdmin) return { action: "nothing", reason: "unknown sender in a member's mailbox" };
    const possible = f.senderScreen?.possibleClient ?? false; // no screen = a pure thank-you
    return { action: "item", kind: "new_sender", status: possible ? "open" : "filtered" };
  }

  const has = (i: Intent) => f.intents.includes(i);
  const onlyOf = (allowed: readonly Intent[]) => f.intents.length > 0 && f.intents.every((i) => allowed.includes(i));
  const change = CHANGE_INTENTS.some(has) || (has("approve") && f.approveHasAction);
  const asks = has("ask");
  const quiet = onlyOf(["approve", "acknowledge"]) && !f.approveHasAction; // approve w/o action, or thanks
  const hasTrigger = f.triggers.length > 0;
  const taskId = f.linked?.taskId;

  if (f.linked) {
    if (change) return { action: "item", kind: "change", status: "open", taskId };
    if (asks) return { action: "item", kind: "question", status: "open", taskId };
    // D32: a plain approval on a Client-review task is one click — an item.
    // D4 forbids only a SILENT "no action" when a trigger fires; the approval
    // item is not silent (the owner sees it and decides), so a trigger word
    // ("mehet", "?") does not turn it into "needs a look".
    if (quiet && has("approve") && f.linked.workflowRole === "client_review") {
      return { action: "item", kind: "approval", status: "open", taskId };
    }
    if (quiet && !hasTrigger) return { action: "no_action" };
    return { action: "item", kind: "needs_look", status: "open", taskId };
  }

  if (change) return { action: "item", kind: "request", status: "open" };
  // No recognised intent: a trigger makes it "needs a look" (D4), otherwise it
  // is treated as a request (§5.3 "add, or no clear intent").
  if (f.intents.length === 0) {
    return { action: "item", kind: hasTrigger ? "needs_look" : "request", status: "open" };
  }
  if (asks) return { action: "item", kind: "question", status: "open" };
  if (quiet && !hasTrigger) return { action: "no_action" };
  return { action: "item", kind: "needs_look", status: "open" };
}

/** Kind strength when a message joins a live item: a stronger kind replaces a weaker one. */
const KIND_RANK: Record<ItemKind, number> = {
  attention: 0,
  waiting: 1,
  needs_look: 2,
  approval: 3,
  question: 4,
  request: 5,
  change: 5,
  new_sender: 5,
};

// ─── Facts ────────────────────────────────────────────────────────────────────

/**
 * The thread's task (§5.2 step 6): its `emailThreadTasks` link (the
 * `created` one first), else a task identifier in the subject that belongs
 * to the thread's client. Archived tasks never link.
 */
export async function resolveLinkedTask(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"emailThreads">,
  subjects: readonly string[],
): Promise<{ task: Doc<"tasks">; workflowRole?: string } | null> {
  const withRole = async (task: Doc<"tasks">) => {
    const status = await ctx.db.get(task.statusId);
    return { task, workflowRole: status?.orgId === task.orgId ? status.workflowRole : undefined };
  };
  const links = await ctx.db
    .query("emailThreadTasks")
    .withIndex("by_orgId_threadId", (q) => q.eq("orgId", thread.orgId).eq("threadId", thread._id))
    .take(20);
  const rank = (role: string) => (role === "created" ? 0 : 1);
  links.sort((a, b) => rank(a.role) - rank(b.role) || b.createdAt - a.createdAt);
  for (const link of links) {
    const task = await ctx.db.get(link.taskId);
    if (task && task.orgId === thread.orgId && !task.archivedAt) return await withRole(task);
  }
  if (!thread.clientId) return null;
  const identifiers = [...new Set(subjects.flatMap((s) => extractTaskIdentifiers(s)))];
  for (const identifier of identifiers.slice(0, 5)) {
    let task = await ctx.db
      .query("tasks")
      .withIndex("by_orgId_identifier", (q) => q.eq("orgId", thread.orgId).eq("identifier", identifier))
      .first();
    if (!task) {
      const alias = await ctx.db
        .query("taskIdentifierAliases")
        .withIndex("by_orgId_identifier", (q) => q.eq("orgId", thread.orgId).eq("identifier", identifier))
        .first();
      task = alias ? await ctx.db.get(alias.taskId) : null;
    }
    if (task && task.orgId === thread.orgId && !task.archivedAt && task.clientId === thread.clientId) {
      return await withRole(task);
    }
  }
  return null;
}

/** The mailbox owner is a current admin of the org (D24 screen applies only then). */
export async function isMailboxOwnerAdmin(ctx: QueryCtx | MutationCtx, thread: Doc<"emailThreads">): Promise<boolean> {
  const connector = await ctx.db.get(thread.connectorId);
  if (!connector || connector.orgId !== thread.orgId) return false;
  const user = await ctx.db.get(connector.userId);
  if (!user || user.deletedAt) return false;
  const member = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", thread.orgId).eq("clerkUserId", user.externalId))
    .unique();
  return member?.role === "admin";
}

// ─── The dispatch stage ───────────────────────────────────────────────────────

export type DispatchOutcome =
  | { kind: "joined"; itemId: Id<"agentItems"> }
  | { kind: "opened"; itemId: Id<"agentItems"> }
  | { kind: "filtered"; itemId: Id<"agentItems"> }
  | { kind: "no_action"; notified: number }
  | { kind: "nothing"; reason: string };

/**
 * `classified → handled` (I5). Joins the conversation's open / snoozed item
 * whatever the new message says (D25, D27) — also a message the screen
 * filtered (a live conversation is never split into a Filtered item); a pure
 * thank-you decided by the RULES only appends (no wake, no re-plan).
 * Otherwise applies the §5.3 decision. An item that only exists because this
 * message failed (kind `attention`, no other failure open) takes the real
 * decision on Retry — or closes as `not_a_change` when there is none
 * (no_action, a duplicate copy, nothing). Idempotent per message (item
 * `messageIds`, notification dedupe), and runs once anyway: the stage moves
 * to `handled` in the same transaction.
 */
export async function dispatchMessage(
  ctx: MutationCtx,
  message: Doc<"emailMessages">,
  opts: { fakeModel?: boolean } = {},
): Promise<DispatchOutcome> {
  const thread = await ctx.db.get(message.threadId);
  if (!thread || thread.orgId !== message.orgId) throw new ConvexError("Conversation not found");
  const classification = message.classification;
  if (!classification) throw new ConvexError("Message has no classification");
  const orgId = message.orgId;
  const anchor = { type: "emailThread", id: thread._id as string };
  const now = Date.now();

  let live = await findLiveItem(ctx, orgId, anchor);
  // The item exists only for failed messages that are all resolved now.
  const attentionOnly = live !== null && live.kind === "attention" && openAttentions(live).length === 0;
  const closeAttentionOnly = async () => {
    if (!live || !attentionOnly) return;
    await joinItem(ctx, live, { messageId: message._id, quiet: true });
    await closeEmailItem(ctx, (await ctx.db.get(live._id))!, { outcome: "not_a_change" });
    live = null;
  };

  // Another mailbox's copy of this email already went through (I1): nothing new.
  if (classification.duplicateOf) {
    await closeAttentionOnly();
    return { kind: "nothing", reason: "duplicate copy of an already processed email" };
  }

  const linked = await resolveLinkedTask(ctx, thread, [thread.subject, message.subject]);
  const decision = decideDispatch({
    // B3 (M1): an unauthenticated sender is never "known", whatever the thread says.
    knownSender: message.unverifiedSender !== true && (Boolean(thread.clientId) || linked !== null),
    mailboxOwnerIsAdmin: await isMailboxOwnerAdmin(ctx, thread),
    linked: linked ? { taskId: linked.task._id, workflowRole: linked.workflowRole } : null,
    intents: classification.intents,
    triggers: classification.triggers,
    approveHasAction: Boolean(classification.approveAction),
    senderScreen: classification.senderScreen,
  });
  const urgent = classification.urgent === true;
  const filtered = decision.action === "item" && decision.status === "filtered";
  if (decision.action === "nothing" || decision.action === "no_action" || filtered) await closeAttentionOnly();
  if (decision.action === "nothing") return { kind: "nothing", reason: decision.reason };

  // Owner 2026-10-19 / gate review: only a thank-you the RULES decided joins
  // quietly; a model "acknowledge" joins like any message (wake + re-plan).
  const quietJoin =
    classification.source === "rules" &&
    classification.triggers.length === 0 &&
    classification.intents.length > 0 &&
    classification.intents.every((i) => i === "acknowledge");
  // D9 / §5.3: a client message that is not a quiet acknowledge makes the
  // conversation's open drafts stale ("Kovács Réka wrote at 14:05") — and
  // stops a send still inside its undo window (email/drafts.ts).
  const staleOpenDrafts = async () => {
    await markConversationDraftsStale(ctx, thread, await staleReasonForInbound(ctx, message));
  };
  // §5.3: a change proposal on a linked task — "Inbox informs".
  const informChange = async (itemId: Id<"agentItems">) => {
    if (decision.action !== "item" || decision.kind !== "change") return;
    await notifyAdminsOfEmailEvent(ctx, {
      orgId,
      subtype: "change",
      thread,
      message,
      reasonText: classification.reasons.join(" · ") || "Asks for a change",
      itemId,
    });
  };

  if (live) {
    const patch: Partial<Pick<Doc<"agentItems">, "kind" | "taskId">> = {};
    if (decision.action === "item" && decision.status === "open") {
      if (attentionOnly || KIND_RANK[decision.kind] > KIND_RANK[live.kind]) patch.kind = decision.kind;
      if (decision.taskId && !live.taskId) patch.taskId = decision.taskId;
      // B6b: after Create (kickoff pending) a reply asking for a change becomes
      // a change on the created task — the same prepareChange → Apply flow (D4).
      if (live.commit && decision.kind === "change" && decision.taskId) {
        patch.kind = "change";
        patch.taskId = decision.taskId;
      }
    }
    // M6: after a commit, any message that added open ledger rows is a change on
    // the committed task — whatever its classification (a "request" included) —
    // never something the kickoff silently absorbs.
    if (live.commit && live.kind !== "change" && patch.kind !== "change") {
      const added = await ctx.db
        .query("clientRequests")
        .withIndex("by_orgId_threadId", (q) => q.eq("orgId", orgId).eq("threadId", thread._id))
        .take(200);
      if (added.some((r) => r.messageId === message._id && r.disposition === "open")) {
        patch.kind = "change";
        patch.taskId = (decision.action === "item" ? decision.taskId : undefined) ?? live.commit.taskIds[0];
      }
    }
    await joinItem(ctx, live, {
      messageId: message._id,
      urgent,
      quiet: quietJoin,
      patch: Object.keys(patch).length > 0 ? patch : undefined,
    });
    if (!quietJoin) {
      await ctx.db.patch(thread._id, { waitingOn: "us", updatedAt: now });
      await staleOpenDrafts();
    }
    await informChange(live._id);
    // B6a (D25): a join that marked the item for re-planning starts the planner.
    await requestPlanningSafely(ctx, live._id, { trigger: "joined", messageIds: [message._id], fakeModel: opts.fakeModel });
    return { kind: "joined", itemId: live._id };
  }

  if (decision.action === "no_action") {
    const notified = await notifyAdminsOfEmailEvent(ctx, {
      orgId,
      subtype: "no_action",
      thread,
      message,
      reasonText: classification.reasons.join(" · ") || "Checked for requests, questions and changes",
    });
    await ctx.db.patch(thread._id, { waitingOn: "none", updatedAt: now });
    return { kind: "no_action", notified };
  }

  if (decision.status === "filtered") {
    const existing = await findFilteredItem(ctx, orgId, anchor);
    if (existing) {
      await joinItem(ctx, existing, { messageId: message._id, replan: false });
      return { kind: "filtered", itemId: existing._id };
    }
    const itemId = await openItem(ctx, {
      orgId, source: "email", anchor, kind: decision.kind, status: "filtered", messageIds: [message._id],
    });
    return { kind: "filtered", itemId };
  }

  const itemId = await openItem(ctx, {
    orgId,
    source: "email",
    anchor,
    kind: decision.kind,
    status: "open",
    messageIds: [message._id],
    taskId: decision.taskId,
    urgent,
  });
  await ctx.db.patch(thread._id, { waitingOn: "us", updatedAt: now });
  await staleOpenDrafts();
  await informChange(itemId);
  // B6a (§6.1): a new request / new_sender / question item gets its plan prepared.
  await requestPlanningSafely(ctx, itemId, { trigger: "opened", messageIds: [message._id], fakeModel: opts.fakeModel });
  return { kind: "opened", itemId };
}

// ─── Decline (D28) ────────────────────────────────────────────────────────────

/** B8b: Decline's Undo toast lasts this long (`undoMs`); the server accepts the Undo a little longer. */
export const DECLINE_UNDO_MS = 8_000;
export const DECLINE_UNDO_GRACE_MS = 4_000;
export const DECLINE_UNDO_EXPIRED_MESSAGE = "Too late to undo the decline.";
export const DECLINE_UNDO_CHANGED_MESSAGE = "This conversation changed since — it can't be undone.";

/**
 * Decline an email item — no reason needed. The item closes (`declined`) and
 * its conversation's unresolved ledger rows become `dismissed` ("declined").
 * A later email on the thread opens a new item (I13 counts only live rows).
 * What it did is recorded (`declineUndo`) for the short Undo (B8b).
 */
export const declineItem = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ dismissed: number; undoMs: number }> => {
    const { auth, item } = await loadEmailItemForAdmin(ctx, args.itemId);
    if (item.status !== "open" && item.status !== "snoozed") {
      throw new ConvexError("This item is already closed");
    }
    if (openAttentions(item).length > 0) throw new ConvexError(OPEN_ATTENTION_MESSAGE);
    if (item.commit) throw new ConvexError("This item was already created — send or discard the kickoff reply instead.");
    const threadId = ctx.db.normalizeId("emailThreads", item.anchor.id);
    const thread = threadId ? await ctx.db.get(threadId) : null;
    let requests: Array<{ requestId: Id<"clientRequests">; disposition: "open" | "question_pending" }> = [];
    if (thread && thread.orgId === auth.orgId) {
      requests = (await threadRequests(ctx, auth.orgId, thread._id)).flatMap((r) =>
        r.disposition === "open" || r.disposition === "question_pending" ? [{ requestId: r._id, disposition: r.disposition }] : [],
      );
      await dismissOpenRequestsOfThread(ctx, auth.orgId, thread._id, DECLINED_REASON);
      await ctx.db.patch(thread._id, { waitingOn: "none", updatedAt: Date.now() });
    }
    // What the shared close is about to discard (only what is still undecided).
    const proposal = item.changePlan ? await ctx.db.get(item.changePlan.proposalId) : null;
    const proposalId = proposal && (proposal.status === "pending" || proposal.status === "failed") ? proposal._id : undefined;
    const draft = item.draftId ? await ctx.db.get(item.draftId) : null;
    const draftId = draft && draft.status === "draft" ? draft._id : undefined;
    // An unsent draft past `draft` (queued / failed) is discarded too, but never brought back.
    const undoable = !draft || draft.status === "draft" || !UNSENT_DRAFT_STATES.has(draft.status);
    // The shared close: a change item's pending proposal goes with it (I9 never stranded).
    await closeEmailItem(ctx, item, { outcome: "declined", userId: auth.userId });
    const closed = (await ctx.db.get(item._id))!;
    if (undoable) {
      await ctx.db.patch(item._id, {
        declineUndo: {
          at: closed.updatedAt,
          requests,
          ...(proposalId ? { proposalId } : {}),
          ...(draftId ? { draftId } : {}),
          waitingOn: thread?.waitingOn ?? "us",
          status: item.status,
          ...(item.snoozedUntil !== undefined ? { snoozedUntil: item.snoozedUntil } : {}),
        },
      });
    }
    return { dismissed: requests.length, undoMs: undoable ? DECLINE_UNDO_MS : 0 };
  },
});

/**
 * Decline's Undo (B8b): only for a few seconds, only while the item is still
 * closed as declined and NOTHING else happened — no write on the item since,
 * no newer message on the conversation, no new item on it, every dismissed
 * row still dismissed as "declined", the discarded proposal / draft still
 * discarded. Then exactly that is put back; otherwise it refuses (the owner
 * opens the email again from Done).
 */
export const undoDecline = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<null> => {
    const { item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    const undo = item.declineUndo;
    if (item.status !== "done" || item.outcome !== "declined" || !undo) throw new ConvexError("There is no decline to undo.");
    const now = Date.now();
    if (now > undo.at + DECLINE_UNDO_MS + DECLINE_UNDO_GRACE_MS) throw new ConvexError(DECLINE_UNDO_EXPIRED_MESSAGE);
    const changed = () => new ConvexError(DECLINE_UNDO_CHANGED_MESSAGE);
    if (item.updatedAt !== undo.at) throw changed();
    if (thread.lastMessageAt > undo.at) throw changed();
    if (await findLiveItem(ctx, item.orgId, item.anchor)) throw changed();
    const rows = [];
    for (const r of undo.requests) {
      const row = await ctx.db.get(r.requestId);
      if (!row || row.orgId !== item.orgId || row.disposition !== "dismissed" || row.dismissedReason !== DECLINED_REASON) throw changed();
      rows.push({ row, disposition: r.disposition });
    }
    const proposal = undo.proposalId ? await ctx.db.get(undo.proposalId) : null;
    if (undo.proposalId && (!proposal || proposal.orgId !== item.orgId || proposal.status !== "discarded")) throw changed();
    const draft = undo.draftId ? await ctx.db.get(undo.draftId) : null;
    if (undo.draftId && (!draft || draft.orgId !== item.orgId || draft.status !== "discarded")) throw changed();

    for (const { row, disposition } of rows) {
      await ctx.db.patch(row._id, { disposition, dismissedReason: undefined, updatedAt: now });
    }
    if (proposal) await ctx.db.patch(proposal._id, { status: "pending", decidedBy: undefined, decidedAt: undefined });
    if (draft) await ctx.db.patch(draft._id, { status: "draft", updatedAt: now });
    await ctx.db.patch(thread._id, { waitingOn: undo.waitingOn, updatedAt: now });
    await ctx.db.patch(item._id, {
      status: undo.status,
      snoozedUntil: undo.snoozedUntil,
      outcome: undefined,
      decidedBy: undefined,
      decidedAt: undefined,
      declineUndo: undefined,
      updatedAt: now,
    });
    return null;
  },
});

// ─── Filtered retention (D24) ─────────────────────────────────────────────────

export const FILTERED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Per-run budget: messages deleted, and stored files deleted with them. */
export const PURGE_MESSAGE_BUDGET = 200;
export const PURGE_FILE_BUDGET = 50;
const PURGE_ITEMS_PER_RUN = 50;
const ANCHOR_ITEMS_CAP = 50;

type PurgeBudget = { messages: number; files: number };
type PurgeTotals = { items: number; messages: number; threads: number };

/**
 * Daily (and continuing itself): delete `filtered` email items older than 30
 * days (by `updatedAt`) with their conversation — its messages (stored files
 * and extracted text with them), ledger rows and the thread. ONE org per run
 * (`cursor` pages the flagged orgs through `by_emailTriageEnabled`, I14),
 * with a per-run budget on messages and files; a run that hits the budget or
 * the item cap re-schedules itself on the same org, otherwise on the next.
 *
 * A conversation is only purged when it is purely filtered: no client on the
 * thread and no item on it other than expired filtered ones. Otherwise only
 * the expired filtered item goes and every message stays (D25 — a live or
 * known conversation is never thinned out). Messages are read by thread
 * index, not from the item's capped `messageIds`.
 */
export const purgeFiltered = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<PurgeTotals & { continued: boolean }> => {
    const cutoff = Date.now() - FILTERED_RETENTION_MS;
    const page = await ctx.db
      .query("orgSettings")
      .withIndex("by_emailTriageEnabled", (q) => q.eq("emailTriageEnabled", true))
      .paginate({ numItems: 1, cursor: args.cursor ?? null });
    const totals: PurgeTotals = { items: 0, messages: 0, threads: 0 };
    const org = page.page[0];
    let sameOrgAgain = false;
    if (org) {
      const budget: PurgeBudget = { messages: PURGE_MESSAGE_BUDGET, files: PURGE_FILE_BUDGET };
      const items = await ctx.db
        .query("agentItems")
        .withIndex("by_orgId_source_status_updatedAt", (q) =>
          q.eq("orgId", org.orgId).eq("source", "email").eq("status", "filtered").lt("updatedAt", cutoff),
        )
        .take(PURGE_ITEMS_PER_RUN);
      sameOrgAgain = items.length === PURGE_ITEMS_PER_RUN;
      for (const item of items) {
        const done = await purgeFilteredItem(ctx, item, cutoff, budget, totals);
        if (!done) {
          sameOrgAgain = true; // budget spent mid-conversation
          break;
        }
      }
    }
    const next = sameOrgAgain ? (args.cursor ?? null) : page.isDone ? undefined : page.continueCursor;
    if (next !== undefined) {
      await ctx.scheduler.runAfter(0, internal.email.triage.purgeFiltered, { cursor: next });
    }
    return { ...totals, continued: next !== undefined };
  },
});

/** Purge one expired filtered item; false when the budget ran out first. */
async function purgeFilteredItem(
  ctx: MutationCtx,
  item: Doc<"agentItems">,
  cutoff: number,
  budget: PurgeBudget,
  totals: PurgeTotals,
): Promise<boolean> {
  const threadId = item.anchor.type === "emailThread" ? ctx.db.normalizeId("emailThreads", item.anchor.id) : null;
  const thread = threadId ? await ctx.db.get(threadId) : null;
  const dropItem = async () => {
    await ctx.db.delete(item._id);
    totals.items++;
    return true;
  };
  if (!thread || thread.orgId !== item.orgId) return await dropItem();

  const anchorItems = await ctx.db
    .query("agentItems")
    .withIndex("by_orgId_anchorType_anchorId_status", (q) =>
      q.eq("orgId", item.orgId).eq("anchor.type", "emailThread").eq("anchor.id", thread._id),
    )
    .take(ANCHOR_ITEMS_CAP);
  const purelyFiltered =
    !thread.clientId && anchorItems.every((i) => i.status === "filtered" && i.updatedAt < cutoff);
  if (!purelyFiltered) return await dropItem(); // messages stay with the live / known conversation

  for (;;) {
    if (budget.messages <= 0) return false;
    const message = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", item.orgId).eq("threadId", thread._id))
      .first();
    if (!message) break;
    const files = message.attachments.filter((a) => a.storageId);
    // A message with more files than a whole run's budget still goes, alone in its run.
    if (files.length > budget.files && budget.files < PURGE_FILE_BUDGET) return false;
    for (const att of files) {
      await deleteContentForStorage(ctx, att.storageId!);
      await ctx.storage.delete(att.storageId!);
    }
    budget.files = Math.max(0, budget.files - files.length);
    await ctx.db.delete(message._id);
    budget.messages--;
    totals.messages++;
  }
  const rows = await ctx.db
    .query("clientRequests")
    .withIndex("by_orgId_threadId", (q) => q.eq("orgId", item.orgId).eq("threadId", thread._id))
    .take(200);
  for (const row of rows) await ctx.db.delete(row._id);
  for (const other of anchorItems) {
    await ctx.db.delete(other._id);
    totals.items++;
  }
  await ctx.db.delete(thread._id);
  totals.threads++;
  return true;
}

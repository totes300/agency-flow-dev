import { v, ConvexError } from "convex/values";
import { paginationOptsValidator, type PaginationResult } from "convex/server";
import { mutation, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { AuthContext } from "../lib/auth";
import { findLiveItem, openAttentions } from "../agentItems";
import { proposalRevision } from "../agentProposals";
import { findTasksForAuth } from "../tasks/agent";
import {
  deriveTriageState,
  type TriageState,
  type TriageStateFacts,
} from "../../lib/agents/triageState";
import { isEmailTriageEnabled } from "./gate";
import { currentAuth } from "./drafts";
import { assertDecidable, loadEmailItemForAdmin, loadItemThread } from "./items";
import { requestPlanning, requestPlanningSafely, type PlanningRequest } from "./prepare";
import { retryStageCore } from "./pipeline";
import { MAILBOX_ANCHOR_TYPE } from "./sync";

/**
 * The Triage read model and its small actions (docs/prd-email-triage.md
 * §7.2, D14, D24–D27, §5.5; implementation plan B8b).
 *
 *   listItems        the list: Open (newest email first, changes pinned on
 *                    top), Snoozed, Done (since the client's cutoff — no wall
 *                    clock in a query), Filtered; each row with its DERIVED
 *                    state label (lib/agents/triageState.ts)
 *   openCount        the sidebar badge (D26: open items only)
 *   getItem          one item: the conversation's emails (stored text — the
 *                    UI never renders the HTML), the plan / change refs a
 *                    decision needs, the linked task, the mailbox
 *   mergeCandidates  `Merge into…`: open top-level tasks of the client
 *   promoteFiltered  D24 "Move to Triage"
 *   retryAttention   the attention item's Retry (stage retry, I5)
 *   planNeedsLook    "Plan it" on a needs-a-look item
 *
 * Access (I6, I14, §5.5): admins only (role from orgMembers), the org's own
 * items only, and only with email triage on. The queries answer `null` to
 * anyone else (the page renders not-found; the nav hides) — no existence
 * leak; the mutations refuse.
 */

/** The pinned changes' cap; the views page in pages of the client's size. */
export const TRIAGE_LIST_CAP = 50;
const BADGE_CAP = 99;
const DETAIL_MESSAGES_CAP = 10;
const DETAIL_TEXT_CAP = 20_000;
const MERGE_CANDIDATES_CAP = 30;

export type TriageView = "open" | "snoozed" | "done" | "filtered";

const viewValidator = v.union(v.literal("open"), v.literal("snoozed"), v.literal("done"), v.literal("filtered"));

/** The caller when they may see Triage (admin, flag on), else null. */
async function triageAuth(ctx: QueryCtx): Promise<AuthContext | null> {
  let auth: AuthContext;
  try {
    auth = await currentAuth(ctx);
  } catch {
    return null;
  }
  if (!auth.isAdmin) return null;
  if (!(await isEmailTriageEnabled(ctx, auth.orgId))) return null;
  return auth;
}

// ─── State facts ─────────────────────────────────────────────────────────────

type PlanTask = { proposalId: Id<"agentProposals">; revision: number; title: string; status: Doc<"agentProposals">["status"] };

/** The item's current plan tasks (live ones: pending / failed), in plan order. */
async function livePlanTasks(ctx: QueryCtx, item: Doc<"agentItems">): Promise<PlanTask[]> {
  const out: PlanTask[] = [];
  for (const id of item.plan?.proposalIds ?? []) {
    const proposal = await ctx.db.get(id);
    if (!proposal || proposal.orgId !== item.orgId) continue;
    if (proposal.status !== "pending" && proposal.status !== "failed") continue;
    const payload = proposal.editedPayload ?? proposal.payload;
    out.push({
      proposalId: proposal._id,
      revision: proposalRevision(proposal),
      title: payload.kind === "createTask" ? payload.title : "",
      status: proposal.status,
    });
  }
  return out;
}

async function runInFlight(ctx: QueryCtx, item: Doc<"agentItems">): Promise<boolean> {
  if (item.planStartScheduledAt !== undefined) return true;
  if (!item.agentThreadId) return false;
  for (const status of ["running", "queued"] as const) {
    const run = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId_status", (q) => q.eq("threadId", item.agentThreadId!).eq("status", status))
      .first();
    if (run) return true;
  }
  return false;
}

async function hasPendingQuestion(ctx: QueryCtx, item: Doc<"agentItems">): Promise<boolean> {
  if (!item.agentThreadId) return false;
  const q = await ctx.db
    .query("agentQuestions")
    .withIndex("by_agentThreadId_status", (x) => x.eq("agentThreadId", item.agentThreadId!).eq("status", "pending"))
    .first();
  return q !== null;
}

async function itemDraft(ctx: QueryCtx, item: Doc<"agentItems">): Promise<Doc<"emailDrafts"> | null> {
  const draft = item.draftId ? await ctx.db.get(item.draftId) : null;
  return draft && draft.orgId === item.orgId ? draft : null;
}

async function stateOf(
  ctx: QueryCtx,
  item: Doc<"agentItems">,
  planTasks: readonly PlanTask[],
): Promise<TriageState> {
  const closed = item.status === "done" || item.status === "filtered";
  const draft = closed ? null : await itemDraft(ctx, item);
  const facts: TriageStateFacts = {
    status: item.status,
    kind: item.kind,
    outcome: item.outcome ?? null,
    // B3: a failing mailbox's item says why (its sync error), like a failed stage.
    attentionMessage:
      openAttentions(item)[0]?.message ??
      (item.anchor.type === MAILBOX_ANCHOR_TYPE ? (item.decisionNote?.message ?? "Mailbox not syncing") : null),
    planIssue: item.planIssue ? { kind: item.planIssue.kind, message: item.planIssue.message } : null,
    running: closed ? false : await runInFlight(ctx, item),
    pendingQuestion: closed ? false : await hasPendingQuestion(ctx, item),
    committed: item.commit?.outcome ?? null,
    draftStatus: draft?.status ?? null,
    planTaskCount: planTasks.length,
    planIsReply: Boolean(item.plan?.reply),
    changeReady: Boolean(item.changePlan),
  };
  return deriveTriageState(facts);
}

// ─── Titles ──────────────────────────────────────────────────────────────────

/** B3: "Mailbox not syncing · ‹address›" for a failing mailbox's item (no email thread); else null. */
async function mailboxItemTitle(ctx: QueryCtx, item: Doc<"agentItems">): Promise<string | null> {
  if (item.anchor.type !== MAILBOX_ANCHOR_TYPE) return null;
  const id = ctx.db.normalizeId("connectors", item.anchor.id);
  const connector = id ? await ctx.db.get(id) : null;
  const address = connector && connector.orgId === item.orgId ? connector.credentialMask : null;
  return address ? `Mailbox not syncing · ${address}` : "Mailbox not syncing";
}

type Sender = { name: string | null; email: string };

/** The latest inbound message of the item (its sender is the row's sender). */
async function latestInbound(ctx: QueryCtx, item: Doc<"agentItems">): Promise<Doc<"emailMessages"> | null> {
  const ids = item.messageIds ?? [];
  for (let i = ids.length - 1; i >= Math.max(0, ids.length - 5); i--) {
    const message = await ctx.db.get(ids[i]);
    if (message && message.orgId === item.orgId && message.direction === "inbound") return message;
  }
  return null;
}

async function linkedTaskOf(ctx: QueryCtx, item: Doc<"agentItems">): Promise<Doc<"tasks"> | null> {
  const task = item.taskId ? await ctx.db.get(item.taskId) : null;
  return task && task.orgId === item.orgId ? task : null;
}

/**
 * The row title (§7.2): the proposed task title once a plan exists (+N for a
 * split), "Reply on ‹task›" for a change, "‹sender› approved ‹task›" for a
 * client approval, else the email subject.
 */
export function rowTitle(args: {
  kind: Doc<"agentItems">["kind"];
  subject: string;
  planTitles: readonly string[];
  committed: boolean;
  task: { identifier: string; title: string } | null;
  senderName: string | null;
}): string {
  const titles = args.planTitles.filter(Boolean);
  if (titles.length > 0) return titles.length > 1 ? `${titles[0]} · +${titles.length - 1}` : titles[0];
  if (args.task && args.kind === "change") return `Reply on ${args.task.identifier} ${args.task.title}`;
  if (args.task && args.kind === "approval") return `${args.senderName ?? "The client"} approved ${args.task.identifier}`;
  if (args.task && args.committed) return `${args.task.identifier} ${args.task.title}`;
  return args.subject || "(no subject)";
}

// ─── listItems ───────────────────────────────────────────────────────────────

export type TriageRow = {
  _id: Id<"agentItems">;
  kind: Doc<"agentItems">["kind"];
  status: Doc<"agentItems">["status"];
  title: string;
  clientName: string | null;
  sender: Sender | null;
  /** When the latest client email arrived (the row's time and sort key). */
  at: number;
  messageCount: number;
  urgent: boolean;
  /** B3 (M1): the latest email's sender wasn't authenticated by Gmail (a quiet amber note). */
  unverifiedSender: boolean;
  snoozedUntil: number | null;
  state: TriageState;
};

async function rowOf(ctx: QueryCtx, item: Doc<"agentItems">): Promise<TriageRow> {
  const thread = await loadItemThread(ctx, item);
  const client = thread?.clientId ? await ctx.db.get(thread.clientId) : null;
  const message = await latestInbound(ctx, item);
  const planTasks = item.status === "done" ? [] : await livePlanTasks(ctx, item);
  const task = item.kind === "change" || item.kind === "approval" || item.commit ? await linkedTaskOf(ctx, item) : null;
  const sender = message ? { name: message.from.name?.trim() || null, email: message.from.email } : null;
  return {
    _id: item._id,
    kind: item.kind,
    status: item.status,
    title: rowTitle({
      kind: item.kind,
      subject: (await mailboxItemTitle(ctx, item)) ?? thread?.subject ?? message?.subject ?? "",
      planTitles: planTasks.map((p) => p.title),
      committed: Boolean(item.commit),
      task: task ? { identifier: task.identifier, title: task.title } : null,
      senderName: sender?.name ?? sender?.email ?? null,
    }),
    clientName: client && client.orgId === item.orgId ? client.name : null,
    sender,
    at: message?.sentAt ?? thread?.lastInboundAt ?? item.createdAt,
    messageCount: item.messageCount ?? (item.messageIds ?? []).length,
    urgent: item.urgent === true,
    unverifiedSender: message?.unverifiedSender === true,
    snoozedUntil: item.snoozedUntil ?? null,
    state: await stateOf(ctx, item, planTasks),
  };
}

/**
 * One page of a view, newest first (`by_orgId_source_status_updatedAt`;
 * the client sorts the loaded rows by email time). In the Open view the
 * changes on linked tasks are left out here — `listPinned` always returns
 * them, whatever the paging. No Triage for the caller: an empty last page
 * (`listMeta` answers null, and the page renders not-found).
 */
export const listItems = query({
  args: {
    view: viewValidator,
    /** Done view: items closed since then (the client passes now − 30 days, D26). */
    doneSince: v.optional(v.number()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args): Promise<PaginationResult<TriageRow>> => {
    const auth = await triageAuth(ctx);
    if (!auth) return { page: [], isDone: true, continueCursor: "" };
    const status = args.view;
    const result = await ctx.db
      .query("agentItems")
      .withIndex("by_orgId_source_status_updatedAt", (q) => {
        const base = q.eq("orgId", auth.orgId).eq("source", "email").eq("status", status);
        return status === "done" && args.doneSince !== undefined ? base.gte("updatedAt", args.doneSince) : base;
      })
      .order("desc")
      .paginate(args.paginationOpts);
    const page: TriageRow[] = [];
    for (const item of result.page) {
      if (status === "open" && item.kind === "change") continue; // pinned — listPinned
      page.push(await rowOf(ctx, item));
    }
    return { ...result, page };
  },
});

/** The open changes on linked tasks, pinned on top of the Open view (§7.2 "Reply on ‹task›"). */
export const listPinned = query({
  args: {},
  handler: async (ctx): Promise<TriageRow[] | null> => {
    const auth = await triageAuth(ctx);
    if (!auth) return null;
    const items = await ctx.db
      .query("agentItems")
      .withIndex("by_orgId_source_status_kind_updatedAt", (q) =>
        q.eq("orgId", auth.orgId).eq("source", "email").eq("status", "open").eq("kind", "change"),
      )
      .order("desc")
      .take(TRIAGE_LIST_CAP);
    const rows: TriageRow[] = [];
    for (const item of items) rows.push(await rowOf(ctx, item));
    return rows.sort((a, b) => b.at - a.at);
  },
});

/**
 * Whether the viewer has Triage at all (null = not-found), and the empty
 * state's hint: is any ADMIN mailbox of the org connected (D24 — only admin
 * mailboxes feed Triage with unknown senders; a seed mailbox counts in dev).
 */
export const listMeta = query({
  args: {},
  handler: async (ctx): Promise<{ gmailConnected: boolean } | null> => {
    const auth = await triageAuth(ctx);
    if (!auth) return null;
    const connectors = await ctx.db
      .query("connectors")
      .withIndex("by_orgId", (q) => q.eq("orgId", auth.orgId))
      .take(200);
    for (const c of connectors) {
      if (c.type !== "gmail" || (c.status !== "connected" && c.devSeed !== true)) continue;
      const user = await ctx.db.get(c.userId);
      if (!user || user.deletedAt) continue;
      const member = await ctx.db
        .query("orgMembers")
        .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", auth.orgId).eq("clerkUserId", user.externalId))
        .unique();
      if (member?.role === "admin") return { gmailConnected: true };
    }
    return { gmailConnected: false };
  },
});

/** Sidebar badge (D26): open email items. Null = no Triage for the viewer (the nav item hides). */
export const openCount = query({
  args: {},
  handler: async (ctx): Promise<{ count: number; capped: boolean } | null> => {
    const auth = await triageAuth(ctx);
    if (!auth) return null;
    const rows = await ctx.db
      .query("agentItems")
      .withIndex("by_orgId_source_status_updatedAt", (q) =>
        q.eq("orgId", auth.orgId).eq("source", "email").eq("status", "open"),
      )
      .take(BADGE_CAP + 1);
    return { count: Math.min(rows.length, BADGE_CAP), capped: rows.length > BADGE_CAP };
  },
});

// ─── getItem ─────────────────────────────────────────────────────────────────

export type TriageEmail = {
  _id: Id<"emailMessages">;
  direction: Doc<"emailMessages">["direction"];
  from: Sender;
  to: Sender[];
  cc: Sender[];
  subject: string;
  /** The stored plain text (quoted history stripped) — rendered with whitespace preserved, never as HTML. */
  bodyText: string;
  cut: boolean;
  sentAt: number;
  attachments: Array<{ name: string; mime: string; size: number; url: string | null }>;
};

export type TriageItemDetail = {
  _id: Id<"agentItems">;
  kind: Doc<"agentItems">["kind"];
  status: Doc<"agentItems">["status"];
  outcome: Doc<"agentItems">["outcome"] | null;
  kickoffOutcome: Doc<"agentItems">["kickoffOutcome"] | null;
  title: string;
  subject: string;
  state: TriageState;
  agentThreadId: Id<"agentThreads"> | null;
  clientId: Id<"clients"> | null;
  clientName: string | null;
  sender: Sender | null;
  messageCount: number;
  snoozedUntil: number | null;
  plan: { tasks: PlanTask[]; isReply: boolean; hasGaps: boolean } | null;
  change: { proposalId: Id<"agentProposals">; revision: number } | null;
  commit: { outcome: "created" | "merged" | "applied"; undoUntil: number | null } | null;
  draftId: Id<"emailDrafts"> | null;
  planIssue: { kind: string | null; message: string; job: string | null } | null;
  attentions: Array<{ messageId: Id<"emailMessages">; stage: string; message: string }>;
  decisionNote: string | null;
  linkedTask: { _id: Id<"tasks">; identifier: string; title: string } | null;
  mailbox: { email: string | null; connected: boolean } | null;
  /**
   * B3: a "Mailbox not syncing" item (no email thread) — its only actions are
   * Reconnect and Resync; it closes itself when sync recovers or on disconnect.
   */
  mailboxIssue: { connectorId: Id<"connectors">; email: string | null; connected: boolean } | null;
  emails: TriageEmail[];
};

const sender = (a: { name?: string; email: string }): Sender => ({ name: a.name?.trim() || null, email: a.email });

export const getItem = query({
  args: {
    itemId: v.optional(v.string()),
    /** An Inbox link to a conversation (`/triage?thread=…`): its live item, else its latest one. */
    emailThreadId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<TriageItemDetail | null> => {
    const auth = await triageAuth(ctx);
    if (!auth) return null;
    let item: Doc<"agentItems"> | null = null;
    if (args.itemId) {
      const id = ctx.db.normalizeId("agentItems", args.itemId);
      item = id ? await ctx.db.get(id) : null;
    } else if (args.emailThreadId) {
      const threadId = ctx.db.normalizeId("emailThreads", args.emailThreadId);
      const anchor = threadId ? { type: "emailThread", id: threadId as string } : null;
      item = anchor ? await findLiveItem(ctx, auth.orgId, anchor) : null;
      if (!item && anchor) {
        // The index orders by status within the anchor — pick the most recent item by time.
        const items = await ctx.db
          .query("agentItems")
          .withIndex("by_orgId_anchorType_anchorId_status", (q) =>
            q.eq("orgId", auth.orgId).eq("anchor.type", anchor.type).eq("anchor.id", anchor.id),
          )
          .take(50);
        item = items.reduce<Doc<"agentItems"> | null>((best, i) => (!best || i.createdAt > best.createdAt ? i : best), null);
      }
    }
    if (!item || item.orgId !== auth.orgId || item.source !== "email") return null;

    const thread = await loadItemThread(ctx, item);
    const client = thread?.clientId ? await ctx.db.get(thread.clientId) : null;
    const planTasks = item.status === "done" ? [] : await livePlanTasks(ctx, item);
    const task = await linkedTaskOf(ctx, item);

    // The conversation's emails of this item, oldest first (D14).
    const emails: TriageEmail[] = [];
    for (const id of (item.messageIds ?? []).slice(-DETAIL_MESSAGES_CAP)) {
      const m = await ctx.db.get(id);
      if (!m || m.orgId !== item.orgId) continue;
      const cut = m.bodyText.length > DETAIL_TEXT_CAP;
      emails.push({
        _id: m._id,
        direction: m.direction,
        from: sender(m.from),
        to: m.to.map(sender),
        cc: m.cc.map(sender),
        subject: m.subject,
        bodyText: cut ? `${m.bodyText.slice(0, DETAIL_TEXT_CAP)}…` : m.bodyText,
        cut,
        sentAt: m.sentAt,
        attachments: await Promise.all(
          m.attachments.map(async (a) => ({
            name: a.name,
            mime: a.mime,
            size: a.size,
            url: a.storageId ? await ctx.storage.getUrl(a.storageId) : null,
          })),
        ),
      });
    }
    emails.sort((a, b) => a.sentAt - b.sentAt);
    const lastInbound = [...emails].reverse().find((e) => e.direction === "inbound") ?? null;

    const changeProposal = item.changePlan ? await ctx.db.get(item.changePlan.proposalId) : null;
    const connector = thread ? await ctx.db.get(thread.connectorId) : null;

    return {
      _id: item._id,
      kind: item.kind,
      status: item.status,
      outcome: item.outcome ?? null,
      kickoffOutcome: item.kickoffOutcome ?? null,
      title: rowTitle({
        kind: item.kind,
        subject: (await mailboxItemTitle(ctx, item)) ?? thread?.subject ?? lastInbound?.subject ?? "",
        planTitles: planTasks.map((p) => p.title),
        committed: Boolean(item.commit),
        task: task ? { identifier: task.identifier, title: task.title } : null,
        senderName: lastInbound?.from.name ?? lastInbound?.from.email ?? null,
      }),
      subject: thread?.subject ?? lastInbound?.subject ?? "",
      state: await stateOf(ctx, item, planTasks),
      agentThreadId: item.agentThreadId ?? null,
      clientId: client && client.orgId === item.orgId ? client._id : null,
      clientName: client && client.orgId === item.orgId ? client.name : null,
      sender: lastInbound?.from ?? null,
      messageCount: item.messageCount ?? (item.messageIds ?? []).length,
      snoozedUntil: item.snoozedUntil ?? null,
      plan: item.plan
        ? { tasks: planTasks, isReply: Boolean(item.plan.reply), hasGaps: item.plan.gaps.length > 0 }
        : null,
      change:
        changeProposal && changeProposal.orgId === item.orgId && (changeProposal.status === "pending" || changeProposal.status === "failed")
          ? { proposalId: changeProposal._id, revision: proposalRevision(changeProposal) }
          : null,
      commit: item.commit ? { outcome: item.commit.outcome, undoUntil: item.commit.undoUntil ?? null } : null,
      draftId: item.draftId ?? null,
      planIssue: item.planIssue
        ? { kind: item.planIssue.kind ?? null, message: item.planIssue.message, job: item.planIssue.job ?? null }
        : null,
      attentions: openAttentions(item).map((a) => ({ messageId: a.messageId, stage: a.stage, message: a.message })),
      decisionNote: item.decisionNote?.message ?? null,
      linkedTask: task ? { _id: task._id, identifier: task.identifier, title: task.title } : null,
      mailbox: connector && connector.orgId === item.orgId
        ? { email: connector.credentialMask ?? null, connected: connector.status === "connected" }
        : null,
      mailboxIssue: await mailboxIssueOf(ctx, item),
      emails,
    };
  },
});

async function mailboxIssueOf(ctx: QueryCtx, item: Doc<"agentItems">): Promise<TriageItemDetail["mailboxIssue"]> {
  if (item.anchor.type !== MAILBOX_ANCHOR_TYPE) return null;
  const id = ctx.db.normalizeId("connectors", item.anchor.id);
  const connector = id ? await ctx.db.get(id) : null;
  if (!connector || connector.orgId !== item.orgId) return null;
  return { connectorId: connector._id, email: connector.credentialMask ?? null, connected: connector.status === "connected" };
}

// ─── mergeCandidates ─────────────────────────────────────────────────────────

export type MergeCandidate = { _id: Id<"tasks">; identifier: string; title: string; status: string | null };

/**
 * `Merge into…` (D29): the open top-level tasks of the conversation's client
 * (the same-client rule `mergeInto` enforces; `findTasks` returns open
 * tasks only), most recent first; `search` narrows by title / identifier.
 * Empty without a client (a new sender).
 */
export const mergeCandidates = query({
  args: { itemId: v.id("agentItems"), search: v.optional(v.string()) },
  handler: async (ctx, args): Promise<MergeCandidate[] | null> => {
    const auth = await triageAuth(ctx);
    if (!auth) return null;
    const item = await ctx.db.get(args.itemId);
    if (!item || item.orgId !== auth.orgId || item.source !== "email") return null;
    const thread = await loadItemThread(ctx, item);
    if (!thread?.clientId) return [];
    const search = args.search?.trim().slice(0, 100) || undefined;
    const found = await findTasksForAuth(ctx, auth, { clientId: thread.clientId, search, limit: 50 });
    const out: MergeCandidate[] = [];
    for (const row of found.tasks) {
      if (row.parent !== null || !row.identifier) continue;
      out.push({ _id: row.id as Id<"tasks">, identifier: row.identifier, title: row.title, status: row.status });
      if (out.length >= MERGE_CANDIDATES_CAP) break;
    }
    return out;
  },
});

// ─── Actions ─────────────────────────────────────────────────────────────────

export const ALREADY_OPEN_MESSAGE = "This conversation already has an open item in Triage.";

/**
 * D24 "Move to Triage": a Filtered item becomes an open item (I13 — refused
 * when the conversation already has a live one) and gets its plan prepared.
 */
export const promoteFiltered = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ planning: PlanningRequest | "failed" }> => {
    const { item } = await loadEmailItemForAdmin(ctx, args.itemId);
    if (item.status !== "filtered") throw new ConvexError("This email is not in Filtered");
    if (await findLiveItem(ctx, item.orgId, item.anchor)) throw new ConvexError(ALREADY_OPEN_MESSAGE);
    await ctx.db.patch(item._id, { status: "open", updatedAt: Date.now() });
    const planning = await requestPlanningSafely(ctx, item._id, { trigger: "opened", messageIds: item.messageIds ?? [] });
    return { planning };
  },
});

/** The attention item's Retry: every failed message of the item from the stage that failed (I5). */
export const retryAttention = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ retried: number }> => {
    const { item } = await loadEmailItemForAdmin(ctx, args.itemId);
    if (item.status !== "open" && item.status !== "snoozed") throw new ConvexError("This item is already closed");
    const attentions = openAttentions(item);
    if (attentions.length === 0) throw new ConvexError("Nothing to retry on this item");
    let retried = 0;
    for (const a of attentions) {
      const result = await retryStageCore(ctx, a.messageId, { fakeModel: item.devFakeModel });
      if (result.retried) retried++;
    }
    return { retried };
  },
});

/**
 * "Plan it" on a needs-a-look item (D4 hard trigger, nothing recognised):
 * the owner read it and wants work from it — a change on the linked task,
 * else a request (a new sender without a client) — and the matching job runs.
 */
export const planNeedsLook = mutation({
  args: { itemId: v.id("agentItems") },
  handler: async (ctx, args): Promise<{ result: PlanningRequest }> => {
    const { item, thread } = await loadEmailItemForAdmin(ctx, args.itemId);
    assertDecidable(item);
    if (item.kind !== "needs_look") throw new ConvexError("Only a needs-a-look item can be planned this way");
    if (item.commit) throw new ConvexError("This item was already created.");
    const kind = item.taskId ? "change" : thread.clientId ? "request" : "new_sender";
    await ctx.db.patch(item._id, { kind, planIssue: undefined, updatedAt: Date.now() });
    return { result: await requestPlanning(ctx, item._id, { trigger: "retry", messageIds: [] }) };
  },
});

import { v, ConvexError, type Infer } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext, loadAuthContextForActor, type AuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { ORG_TIMEZONE_FALLBACK } from "../lib/timer";
import {
  emailDraftAttachmentValidator,
  emailDraftKindValidator,
  emailDraftRecipientValidator,
  emailPromiseCandidateValidator,
} from "../lib/validators";
import { loadTaskForReadOrNull } from "../tasks/access";
import { closeEmailItem, findLiveItem, openAttentions } from "../agentItems";
import { RESET_SEND_FIELDS, cancelScheduled } from "./draftState";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { normalizeSubject, parseAddress } from "./model";
import { replySubject } from "./mime";

/**
 * Outbound email drafts — `emailDrafts` (docs/prd-email-triage.md §4.1,
 * §5.4, D9, D20, D35, I2, §5.5). The send itself (approve → queued →
 * dispatching → sent / failed / unknown) lives in `email/send.ts`.
 *
 *   createDraft / createDraftInternal  an admin, a member for their OWN task
 *                     ("Save draft for Ádám" — a member's draft can never be
 *                     approved or sent by a member), or an agent job
 *   updateDraft / reviseDraftInternal  bumps `version`, voids the approval
 *                     (D9); during the 15 s window an edit moves `queued`
 *                     back to `draft` and cancels the scheduled send
 *   discardDraft / restoreDraft
 *   setFromMailbox    D35: only a mailbox that holds the conversation
 *   markDraftReviewed clears a stale flag after a second look (D9)
 *   markThreadDraftsStale  a new client message (B4) or a reply written in
 *                     Gmail (B3, D33) makes the conversation's open drafts
 *                     stale ("Kovács Réka wrote at 14:05")
 *
 * A "conversation" is every `emailThreads` row that shares a message
 * (`rfcMessageId`) with the draft's thread — the same email in several
 * colleagues' mailboxes (I1). Recipients come only from that conversation's
 * participants plus `clients.replyCcEmails` (I2); anything else is kept but
 * flagged `newRecipient` (a send warning). Every function checks the
 * feature flag (I14) and the org after each id read.
 */

export const DRAFT_NOT_FOUND = "Draft not found";
export const SUBJECT_LOCKED_MESSAGE =
  "The subject of a reply is locked to the conversation — start a new conversation to change it.";
export const VERSION_CHANGED_MESSAGE = "This draft changed — review it again.";

const BODY_MAX = 50_000;
const SUBJECT_MAX = 300;
const SUMMARY_MAX = 2_000;
const RECIPIENTS_MAX = 30;
const ATTACHMENTS_MAX = 10;
const CANDIDATES_MAX = 10;
const COPY_SCAN_MESSAGES = 20;
const THREAD_MESSAGES_SCAN = 50;
const DRAFTS_PER_THREAD_CAP = 50;

/** Kinds that answer an existing conversation — they need a thread. */
const REPLY_KINDS: ReadonlySet<string> = new Set(["kickoff", "reply", "question", "nudge"]);
/** Draft states a person (or the agent, D20) may still change. */
const EDITABLE: ReadonlySet<string> = new Set(["draft", "queued", "failed"]);

type Recipient = Infer<typeof emailDraftRecipientValidator>;
type DraftAttachment = Infer<typeof emailDraftAttachmentValidator>;
type PromiseCandidate = Infer<typeof emailPromiseCandidateValidator>;
type DraftKind = Infer<typeof emailDraftKindValidator>;

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** The caller with the CURRENT orgMembers role (ANDed with the JWT role, §5.5 / I6). */
export async function currentAuth(ctx: QueryCtx | MutationCtx): Promise<AuthContext> {
  const jwt = await getAuthContext(ctx);
  return await loadAuthContextForActor(ctx, { orgId: jwt.orgId, userId: jwt.userId });
}

/** A member's own draft on a task they can still read. */
async function memberOwnsDraft(ctx: QueryCtx | MutationCtx, auth: AuthContext, draft: Doc<"emailDrafts">) {
  if (draft.createdBy !== auth.userId || !draft.taskId) return false;
  return (await loadTaskForReadOrNull(ctx, draft.taskId, auth)) !== null;
}

/**
 * The draft for a write by the caller: any admin; a member only their own
 * draft on their own task. Missing / other-org / not-allowed all read as
 * "Draft not found".
 */
export async function loadDraftForCaller(
  ctx: MutationCtx,
  draftId: Id<"emailDrafts">,
): Promise<{ auth: AuthContext; draft: Doc<"emailDrafts">; ownsAsMember: boolean }> {
  const auth = await currentAuth(ctx);
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.orgId !== auth.orgId) throw new ConvexError(DRAFT_NOT_FOUND);
  await requireEmailTriageEnabled(ctx, auth.orgId);
  if (auth.isAdmin) return { auth, draft, ownsAsMember: false };
  if (!(await memberOwnsDraft(ctx, auth, draft))) throw new ConvexError(DRAFT_NOT_FOUND);
  return { auth, draft, ownsAsMember: true };
}

// ─── Content hash (D9) ────────────────────────────────────────────────────────

export type HashedFields = Pick<
  Doc<"emailDrafts">,
  "subject" | "fromConnectorId" | "to" | "cc" | "bodyText" | "attachments"
>;

/** The sending mailbox an approval is bound to: its address and grant generation. */
export type MailboxBinding = { address: string; connectedAt: number };

/**
 * SHA-256 (hex) of exactly what an approval binds: subject, From (the
 * connector AND its address + `connectedAt`, so a reconnect or an address
 * change voids the approval), To, Cc, body, attachments.
 */
export async function draftContentHash(d: HashedFields, mailbox: MailboxBinding): Promise<string> {
  const addr = (a: { name?: string; email: string }) => [a.email.toLowerCase(), a.name ?? ""];
  const canonical = JSON.stringify({
    s: d.subject,
    f: d.fromConnectorId,
    fa: mailbox.address.toLowerCase(),
    fc: mailbox.connectedAt,
    to: d.to.map(addr),
    cc: d.cc.map(addr),
    b: d.bodyText,
    a: d.attachments.map((x) => [x.label, x.url ?? "", x.storageId ?? ""]),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The sending mailbox's address + grant generation (what an approval binds), or null. */
export async function mailboxBinding(
  ctx: QueryCtx | MutationCtx,
  draft: Pick<Doc<"emailDrafts">, "orgId" | "fromConnectorId">,
): Promise<MailboxBinding | null> {
  const c = await ctx.db.get(draft.fromConnectorId);
  if (!c || c.orgId !== draft.orgId || !c.credentialMask) return null;
  return { address: c.credentialMask.toLowerCase(), connectedAt: c.connectedAt };
}

/** The approval was given for this sending mailbox (address + grant generation). */
export const sameBinding = (approval: NonNullable<Doc<"emailDrafts">["approval"]>, b: MailboxBinding | null) =>
  !!b && approval.fromAddress === b.address && approval.fromConnectedAt === b.connectedAt;

/**
 * The draft's approval still binds it exactly as it is now: the same version,
 * content hash and sending mailbox. A `failed` draft whose approval binds can
 * be retried (`retrySend`); otherwise it needs a fresh Approve & send.
 */
export async function approvalBinds(ctx: QueryCtx | MutationCtx, draft: Doc<"emailDrafts">): Promise<boolean> {
  const approval = draft.approval;
  if (!approval || approval.version !== draft.version) return false;
  const binding = await mailboxBinding(ctx, draft);
  if (!binding || !sameBinding(approval, binding)) return false;
  return approval.hash === (await draftContentHash(draft, binding));
}

/**
 * The body that goes out: the draft text, plus a line per link attachment
 * whose URL the text does not already contain (a link "attachment" is only
 * real if the client can see it). Stored on the outbound message as sent.
 */
export function composeSentBody(d: Pick<Doc<"emailDrafts">, "bodyText" | "attachments">): string {
  const links = d.attachments.filter((a) => !a.storageId && a.url && !d.bodyText.includes(a.url));
  if (links.length === 0) return d.bodyText;
  return `${d.bodyText.replace(/\s+$/, "")}\n\n${links.map((a) => `${a.label}: ${a.url}`).join("\n")}\n`;
}

// ─── Conversation (I1 copies) and mailboxes (D35) ─────────────────────────────

/** Two copies of one email: same sender address, sent within this window. */
export const COPY_SENT_AT_TOLERANCE_MS = 2 * 60_000;

/**
 * Every `emailThreads` row of the same conversation in the org: the thread
 * itself first, then the copies in OTHER mailboxes that hold one of its
 * latest messages. A Message-ID alone is not proof (anyone can reuse or
 * spoof one): the other mailbox's message must also match on the sender
 * address and its sent time (±2 min). Bounded.
 */
export async function conversationThreads(
  ctx: QueryCtx | MutationCtx,
  thread: Doc<"emailThreads">,
): Promise<Doc<"emailThreads">[]> {
  const out = new Map<Id<"emailThreads">, Doc<"emailThreads">>([[thread._id, thread]]);
  const messages = await ctx.db
    .query("emailMessages")
    .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", thread.orgId).eq("threadId", thread._id))
    .order("desc")
    .take(COPY_SCAN_MESSAGES);
  for (const m of messages) {
    const copies = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_rfcMessageId", (q) => q.eq("orgId", thread.orgId).eq("rfcMessageId", m.rfcMessageId))
      .take(10);
    for (const c of copies) {
      if (out.has(c.threadId)) continue;
      if (c.connectorId === thread.connectorId) continue; // not another mailbox
      if (c.from.email.toLowerCase() !== m.from.email.toLowerCase()) continue;
      if (Math.abs(c.sentAt - m.sentAt) > COPY_SENT_AT_TOLERANCE_MS) continue;
      const copy = await ctx.db.get(c.threadId);
      if (copy && copy.orgId === thread.orgId) out.set(copy._id, copy);
    }
  }
  return [...out.values()];
}

export type MailboxHolder = { connectorId: Id<"connectors">; userId: Id<"users"> };

/** The org's gmail mailboxes that hold a copy of the conversation (D35). */
export async function holdersOf(
  ctx: QueryCtx | MutationCtx,
  threads: readonly Doc<"emailThreads">[],
): Promise<MailboxHolder[]> {
  const out: MailboxHolder[] = [];
  for (const t of threads) {
    if (out.some((h) => h.connectorId === t.connectorId)) continue;
    const c = await ctx.db.get(t.connectorId);
    if (c && c.orgId === t.orgId && c.type === "gmail") out.push({ connectorId: c._id, userId: c.userId });
  }
  return out;
}

/**
 * D35, the rule first: the sending admin's own mailbox when it holds the
 * conversation, otherwise the mailbox the client wrote to, otherwise the
 * draft thread's own mailbox. Pure.
 */
export function chooseFromMailbox(args: {
  holders: readonly MailboxHolder[];
  senderUserId?: Id<"users"> | null;
  clientWroteTo?: Id<"connectors"> | null;
  fallback: Id<"connectors">;
}): Id<"connectors"> {
  const own = args.senderUserId ? args.holders.find((h) => h.userId === args.senderUserId) : undefined;
  if (own) return own.connectorId;
  if (args.clientWroteTo && args.holders.some((h) => h.connectorId === args.clientWroteTo)) return args.clientWroteTo;
  return args.fallback;
}

/** The latest inbound message of the conversation (the mailbox the client wrote to). */
async function latestInbound(
  ctx: QueryCtx | MutationCtx,
  threads: readonly Doc<"emailThreads">[],
): Promise<Doc<"emailMessages"> | null> {
  let best: Doc<"emailMessages"> | null = null;
  for (const t of threads) {
    const rows = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", t.orgId).eq("threadId", t._id))
      .order("desc")
      .take(10);
    const inbound = rows.find((m) => m.direction === "inbound");
    // Strictly later wins, so the draft's own thread (listed first) wins a tie.
    if (inbound && (!best || inbound.sentAt > best.sentAt)) best = inbound;
  }
  return best;
}

/**
 * Who "the sending admin" is for a new draft: its creator when they are a
 * current admin, else the org's designated agent actor ("Save draft for
 * Ádám" / agent drafts).
 */
async function defaultSenderUserId(
  ctx: MutationCtx,
  orgId: string,
  creator: AuthContext | null,
): Promise<Id<"users"> | null> {
  if (creator?.isAdmin) return creator.userId;
  return (await getOrgSettings(ctx, orgId))?.agentActorUserId ?? null;
}

/** A user's own gmail mailbox (new conversations, §6.10). */
async function ownGmailConnector(ctx: QueryCtx | MutationCtx, orgId: string, userId: Id<"users">) {
  return await ctx.db
    .query("connectors")
    .withIndex("by_orgId_userId_type", (q) => q.eq("orgId", orgId).eq("userId", userId).eq("type", "gmail"))
    .first();
}

// ─── Recipients (I2) ──────────────────────────────────────────────────────────

/** Addresses of the org's own mailboxes (never default recipients). */
async function ownAddresses(ctx: QueryCtx | MutationCtx, orgId: string): Promise<Set<string>> {
  const rows = await ctx.db
    .query("connectors")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .take(200);
  const own = new Set<string>();
  for (const c of rows) {
    if (c.type !== "gmail") continue;
    if (c.credentialMask) own.add(c.credentialMask.toLowerCase());
    const user = await ctx.db.get(c.userId);
    if (user?.email) own.add(user.email.toLowerCase());
  }
  return own;
}

/**
 * Who may receive this draft without a flag (I2): the conversation's
 * participants and every address on its messages, plus the client's
 * `replyCcEmails` (and, for a new conversation, the client's contacts).
 */
async function allowedRecipients(
  ctx: QueryCtx | MutationCtx,
  threads: readonly Doc<"emailThreads">[],
  client: Doc<"clients"> | null,
): Promise<Set<string>> {
  const allowed = new Set<string>();
  const add = (email: string | undefined) => {
    const parsed = email ? parseAddress(email) : null;
    if (parsed) allowed.add(parsed.email);
  };
  for (const t of threads) {
    for (const p of t.participants) add(p.email);
    const messages = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", t.orgId).eq("threadId", t._id))
      .order("desc")
      .take(THREAD_MESSAGES_SCAN);
    for (const m of messages) for (const a of [m.from, ...m.to, ...m.cc]) add(a.email);
  }
  for (const e of client?.replyCcEmails ?? []) add(e);
  if (client && threads.length === 0) {
    const contacts = await ctx.db
      .query("clientContacts")
      .withIndex("by_clientId", (q) => q.eq("clientId", client._id))
      .take(100);
    for (const c of contacts) if (c.orgId === client.orgId) add(c.email);
  }
  return allowed;
}

/**
 * Validate, lower-case, de-duplicate (To wins over Cc) and flag every
 * address not in `allowed` as `newRecipient`. Pure.
 */
export function normalizeRecipients(
  to: ReadonlyArray<{ name?: string; email: string }>,
  cc: ReadonlyArray<{ name?: string; email: string }>,
  allowed: ReadonlySet<string>,
): { to: Recipient[]; cc: Recipient[] } {
  const seen = new Set<string>();
  const norm = (list: ReadonlyArray<{ name?: string; email: string }>): Recipient[] => {
    const out: Recipient[] = [];
    for (const raw of list) {
      const parsed = parseAddress(raw.email);
      if (!parsed) throw new ConvexError(`Not a valid email address: ${raw.email.slice(0, 100)}`);
      if (seen.has(parsed.email)) continue;
      seen.add(parsed.email);
      const name = raw.name?.trim().slice(0, 200) || parsed.name;
      out.push({
        ...(name ? { name } : {}),
        email: parsed.email,
        ...(allowed.has(parsed.email) ? {} : { newRecipient: true }),
      });
    }
    return out;
  };
  const result = { to: norm(to), cc: norm(cc) };
  if (result.to.length + result.cc.length > RECIPIENTS_MAX) {
    throw new ConvexError(`At most ${RECIPIENTS_MAX} recipients`);
  }
  return result;
}

/**
 * Reply-all defaults (§6.2): To = the latest inbound sender; Cc = the other
 * people on that message plus `replyCcEmails`; never our own mailboxes.
 * Without an inbound message: the participants that are not ours. Pure.
 */
export function defaultRecipients(args: {
  latestInbound: Pick<Doc<"emailMessages">, "from" | "to" | "cc"> | null;
  participants: ReadonlyArray<{ name?: string; email: string }>;
  own: ReadonlySet<string>;
  replyCcEmails: readonly string[];
}): { to: Array<{ name?: string; email: string }>; cc: Array<{ name?: string; email: string }> } {
  const notOwn = (a: { email: string }) => !args.own.has(a.email.toLowerCase());
  if (!args.latestInbound) {
    return { to: args.participants.filter(notOwn), cc: args.replyCcEmails.map((email) => ({ email })) };
  }
  const to = [args.latestInbound.from].filter(notOwn);
  const toEmails = new Set(to.map((a) => a.email.toLowerCase()));
  const cc = [...args.latestInbound.to, ...args.latestInbound.cc, ...args.replyCcEmails.map((email) => ({ email }))]
    .filter(notOwn)
    .filter((a) => !toEmails.has(a.email.toLowerCase()));
  return { to, cc };
}

// ─── Validation ───────────────────────────────────────────────────────────────

function cleanText(raw: string, max: number, label: string, required = true): string {
  const text = raw.trim();
  if (required && !text) throw new ConvexError(`${label} is required`);
  if (text.length > max) throw new ConvexError(`${label} must be ${max} characters or fewer`);
  return text;
}

function cleanBody(raw: string): string {
  const body = raw.replace(/\r\n?/g, "\n");
  if (!body.trim()) throw new ConvexError("The email body is empty");
  if (body.length > BODY_MAX) throw new ConvexError(`The email body must be ${BODY_MAX} characters or fewer`);
  return body;
}

/**
 * Attachments must be reachable from the draft's own sources: a file on
 * its task (task or comment attachment) or on a message of its
 * conversation; a link must be http(s). Storage ids from model output are
 * never trusted on their own.
 */
async function validateAttachments(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  task: Doc<"tasks"> | null,
  threads: readonly Doc<"emailThreads">[],
  list: readonly DraftAttachment[],
): Promise<DraftAttachment[]> {
  if (list.length > ATTACHMENTS_MAX) throw new ConvexError(`At most ${ATTACHMENTS_MAX} attachments`);
  let reachable: Set<string> | null = null;
  const loadReachable = async () => {
    const ids = new Set<string>();
    if (task) {
      for (const a of await ctx.db.query("attachments").withIndex("by_task", (q) => q.eq("taskId", task._id)).take(200)) {
        if (a.orgId === orgId) ids.add(a.fileId);
      }
      for (const a of await ctx.db.query("commentAttachments").withIndex("by_task", (q) => q.eq("taskId", task._id)).take(500)) {
        if (a.orgId === orgId) ids.add(a.fileId);
      }
    }
    for (const t of threads) {
      const messages = await ctx.db
        .query("emailMessages")
        .withIndex("by_orgId_threadId_sentAt", (q) => q.eq("orgId", orgId).eq("threadId", t._id))
        .take(THREAD_MESSAGES_SCAN);
      for (const m of messages) for (const a of m.attachments) if (a.storageId) ids.add(a.storageId);
    }
    return ids;
  };
  const out: DraftAttachment[] = [];
  for (const raw of list) {
    const label = cleanText(raw.label, 200, "Attachment name");
    if (raw.url !== undefined && !/^https?:\/\/\S+$/i.test(raw.url)) throw new ConvexError("An attachment link must be http(s)");
    if (!raw.url && !raw.storageId) throw new ConvexError("An attachment needs a file or a link");
    if (raw.storageId) {
      reachable ??= await loadReachable();
      if (!reachable.has(raw.storageId)) throw new ConvexError(`Attachment not found on this task or conversation: ${label}`);
      if (!(await ctx.db.system.get("_storage", raw.storageId))) throw new ConvexError(`Attachment file is gone: ${label}`);
    }
    out.push({ label, ...(raw.url ? { url: raw.url } : {}), ...(raw.storageId ? { storageId: raw.storageId } : {}) });
  }
  return out;
}

/** Ledger rows the draft answers: this conversation's (or this agent conversation's) live rows. */
async function validateAnswers(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  threads: readonly Doc<"emailThreads">[],
  agentThreadId: Id<"agentThreads"> | undefined,
  ids: readonly Id<"clientRequests">[],
): Promise<Id<"clientRequests">[]> {
  const threadIds = new Set<string>(threads.map((t) => t._id));
  const out: Id<"clientRequests">[] = [];
  for (const id of ids.slice(0, 200)) {
    const row = await ctx.db.get(id);
    const inConversation =
      row && row.orgId === orgId &&
      ((row.threadId && threadIds.has(row.threadId)) || (agentThreadId && row.agentThreadId === agentThreadId));
    if (!row || !inConversation) throw new ConvexError("A request this draft answers is not on its conversation");
    if (row.disposition === "superseded" || row.disposition === "dismissed") {
      throw new ConvexError(`A request this draft answers is already ${row.disposition}`);
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

function validateCandidates(list: readonly PromiseCandidate[]): PromiseCandidate[] {
  if (list.length > CANDIDATES_MAX) throw new ConvexError(`At most ${CANDIDATES_MAX} promise candidates`);
  return list.map((c) => {
    const text = cleanText(c.text, 300, "Promise text");
    if (c.dueDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(c.dueDate)) throw new ConvexError("Promise date must be YYYY-MM-DD");
    return { text, ...(c.dueDate ? { dueDate: c.dueDate } : {}) };
  });
}

// ─── Create ───────────────────────────────────────────────────────────────────

const followUpValidator = v.object({
  title: v.string(),
  assigneeIds: v.array(v.id("users")),
  dueDate: v.optional(v.string()),
  subtaskIds: v.array(v.id("tasks")),
});

const draftContentArgs = {
  to: v.optional(v.array(emailDraftRecipientValidator)),
  cc: v.optional(v.array(emailDraftRecipientValidator)),
  subject: v.optional(v.string()),
  bodyText: v.string(),
  attachments: v.optional(v.array(emailDraftAttachmentValidator)),
  sourceSummary: v.string(),
  answersRequestIds: v.optional(v.array(v.id("clientRequests"))),
  promiseCandidates: v.optional(v.array(emailPromiseCandidateValidator)),
};

const createArgs = {
  kind: emailDraftKindValidator,
  threadId: v.optional(v.id("emailThreads")),
  taskId: v.optional(v.id("tasks")),
  agentThreadId: v.optional(v.id("agentThreads")),
  fromConnectorId: v.optional(v.id("connectors")),
  ...draftContentArgs,
};

type CreateInput = {
  kind: DraftKind;
  threadId?: Id<"emailThreads">;
  taskId?: Id<"tasks">;
  agentThreadId?: Id<"agentThreads">;
  fromConnectorId?: Id<"connectors">;
  to?: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  subject?: string;
  bodyText: string;
  attachments?: DraftAttachment[];
  sourceSummary: string;
  answersRequestIds?: Id<"clientRequests">[];
  promiseCandidates?: PromiseCandidate[];
  followUp?: Doc<"emailDrafts">["followUp"];
};

/** The draft's sources, org-checked: task, thread + its conversation, client. */
async function loadSources(
  ctx: MutationCtx,
  orgId: string,
  input: Pick<CreateInput, "taskId" | "threadId">,
  auth: AuthContext | null,
) {
  let task: Doc<"tasks"> | null = null;
  if (input.taskId) {
    if (auth) {
      task = (await loadTaskForReadOrNull(ctx, input.taskId, auth))?.task ?? null;
    } else {
      const row = await ctx.db.get(input.taskId);
      task = row && row.orgId === orgId ? row : null;
    }
    if (!task) throw new ConvexError("Task not found");
  }
  let thread: Doc<"emailThreads"> | null = null;
  let threads: Doc<"emailThreads">[] = [];
  if (input.threadId) {
    const row = await ctx.db.get(input.threadId);
    if (!row || row.orgId !== orgId) throw new ConvexError("Conversation not found");
    thread = row;
    threads = await conversationThreads(ctx, thread);
  }
  if (task && thread) {
    // I2: a task draft answers one of the task's own conversations.
    const ids = new Set<string>(threads.map((t) => t._id));
    const links = await ctx.db
      .query("emailThreadTasks")
      .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", task!._id))
      .take(50);
    const parentLinks = task.parentTaskId
      ? await ctx.db
          .query("emailThreadTasks")
          .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", task!.parentTaskId!))
          .take(50)
      : [];
    if (![...links, ...parentLinks].some((l) => ids.has(l.threadId))) {
      throw new ConvexError("This conversation is not linked to the task");
    }
  }
  const clientId = thread?.clientId ?? task?.clientId;
  const clientRow = clientId ? await ctx.db.get(clientId) : null;
  const client = clientRow && clientRow.orgId === orgId ? clientRow : null;
  return { task, thread, threads, client };
}

async function createDraftCore(
  ctx: MutationCtx,
  orgId: string,
  input: CreateInput,
  creator: AuthContext | null,
): Promise<Id<"emailDrafts">> {
  await requireEmailTriageEnabled(ctx, orgId);
  if (creator && !creator.isAdmin) {
    // A member saves a draft for an admin, only for their own task (§5.5).
    if (!input.taskId) throw new ConvexError("A member can only draft an email for their own task");
    if (input.followUp) throw new ConvexError("Only an admin can plan a follow-up");
  }
  if (REPLY_KINDS.has(input.kind) && !input.threadId) throw new ConvexError(`A ${input.kind} email needs its conversation`);
  if (!input.threadId && !input.taskId) throw new ConvexError("A new conversation needs a task");

  const { task, thread, threads, client } = await loadSources(ctx, orgId, input, creator);

  if (input.agentThreadId) {
    const agentThread = await ctx.db.get(input.agentThreadId);
    // agentThreads.threadAccess "write": an `admins` thread → any admin; private → its owner.
    const canWrite = (t: Doc<"agentThreads">, a: AuthContext) =>
      t.visibility === "admins" ? a.isAdmin : t.userId === a.userId;
    const ok = agentThread && agentThread.orgId === orgId && (!creator || canWrite(agentThread, creator));
    if (!ok) throw new ConvexError("Conversation not found");
  }

  // D9: a reply's subject is the conversation's; only a new conversation picks one.
  const subjectLocked = thread !== null;
  const subject = thread
    ? replySubject(normalizeSubject(thread.subject))
    : cleanText(input.subject ?? "", SUBJECT_MAX, "Subject");

  // D35: the sending mailbox.
  let fromConnectorId: Id<"connectors">;
  if (thread) {
    const holders = await holdersOf(ctx, threads);
    if (input.fromConnectorId) {
      if (!holders.some((h) => h.connectorId === input.fromConnectorId)) {
        throw new ConvexError("That mailbox does not hold this conversation");
      }
      fromConnectorId = input.fromConnectorId;
    } else {
      fromConnectorId = chooseFromMailbox({
        holders,
        senderUserId: await defaultSenderUserId(ctx, orgId, creator),
        clientWroteTo: (await latestInbound(ctx, threads))?.connectorId ?? null,
        fallback: thread.connectorId,
      });
    }
  } else {
    const sender = await defaultSenderUserId(ctx, orgId, creator);
    const candidates = [sender, creator?.userId].filter((x): x is Id<"users"> => Boolean(x));
    let chosen: Doc<"connectors"> | null = null;
    if (input.fromConnectorId) {
      const c = await ctx.db.get(input.fromConnectorId);
      if (!c || c.orgId !== orgId || c.type !== "gmail" || !candidates.includes(c.userId)) {
        throw new ConvexError("Pick your own mailbox for a new conversation");
      }
      chosen = c;
    } else {
      for (const userId of candidates) {
        chosen = await ownGmailConnector(ctx, orgId, userId);
        if (chosen) break;
      }
    }
    if (!chosen) throw new ConvexError("Connect Gmail first to start a new conversation");
    fromConnectorId = chosen._id;
  }

  // I2 recipients.
  const allowed = await allowedRecipients(ctx, threads, client);
  let to = input.to;
  let cc = input.cc;
  if (to === undefined) {
    const defaults = defaultRecipients({
      latestInbound: thread ? await latestInbound(ctx, threads) : null,
      participants: thread?.participants ?? [],
      own: await ownAddresses(ctx, orgId),
      replyCcEmails: client?.replyCcEmails ?? [],
    });
    to = defaults.to;
    cc = cc ?? defaults.cc;
  }
  const recipients = normalizeRecipients(to, cc ?? [], allowed);

  const attachments = await validateAttachments(ctx, orgId, task, threads, input.attachments ?? []);
  const answersRequestIds = await validateAnswers(ctx, orgId, threads, input.agentThreadId, input.answersRequestIds ?? []);
  const promiseCandidates = validateCandidates(input.promiseCandidates ?? []);
  if (input.followUp) {
    cleanText(input.followUp.title, 500, "Follow-up title");
    if (!task) throw new ConvexError("A follow-up needs the draft's task");
    for (const id of input.followUp.subtaskIds) {
      const sub = await ctx.db.get(id);
      if (!sub || sub.orgId !== orgId || sub.parentTaskId !== task._id) throw new ConvexError("Follow-up subtask not found");
    }
  }

  const now = Date.now();
  return await ctx.db.insert("emailDrafts", {
    orgId,
    taskId: task?._id,
    threadId: thread?._id,
    agentThreadId: input.agentThreadId,
    kind: input.kind,
    version: 1,
    to: recipients.to,
    cc: recipients.cc,
    subject,
    bodyText: cleanBody(input.bodyText),
    attachments,
    sourceSummary: cleanText(input.sourceSummary, SUMMARY_MAX, "Source summary", false),
    answersRequestIds: answersRequestIds.length > 0 ? answersRequestIds : undefined,
    promiseCandidates: promiseCandidates.length > 0 ? promiseCandidates : undefined,
    subjectLocked,
    fromConnectorId,
    status: "draft",
    followUp: input.followUp,
    createdBy: creator ? creator.userId : "agent",
    createdAt: now,
    updatedAt: now,
  });
}

/** An admin drafts an email; a member saves one for an admin on their own task. */
export const createDraft = mutation({
  args: createArgs,
  handler: async (ctx, args): Promise<Id<"emailDrafts">> => {
    const auth = await currentAuth(ctx);
    return await createDraftCore(ctx, auth.orgId, args, auth);
  },
});

/** An agent job writes a draft (B6 kickoff, C1 completion); org from server code only. */
export const createDraftInternal = internalMutation({
  args: { orgId: v.string(), followUp: v.optional(followUpValidator), ...createArgs },
  handler: async (ctx, { orgId, ...input }): Promise<Id<"emailDrafts">> => {
    return await createDraftCore(ctx, orgId, input, null);
  },
});

// ─── Edit ─────────────────────────────────────────────────────────────────────

export type DraftPatch = {
  to?: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  subject?: string;
  bodyText?: string;
  attachments?: DraftAttachment[];
  answersRequestIds?: Id<"clientRequests">[];
  promiseCandidates?: PromiseCandidate[];
  fromConnectorId?: Id<"connectors">;
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export { RESET_SEND_FIELDS, cancelScheduled, discardUnsentDraft } from "./draftState";

/**
 * Apply an edit (a person's or the agent's own, D20). Any change bumps the
 * version, clears the approval and the stale flag, and takes a `queued`
 * (inside the 15 s window) or `failed` draft back to `draft`, cancelling its
 * scheduled send / retry — nothing approved before the edit can go out.
 */
async function updateDraftCore(
  ctx: MutationCtx,
  draft: Doc<"emailDrafts">,
  patch: DraftPatch,
  editor: AuthContext | null,
): Promise<{ version: number; changed: boolean }> {
  if (!EDITABLE.has(draft.status)) {
    throw new ConvexError(
      draft.status === "dispatching" || draft.status === "unknown"
        ? "This email is already on its way to Gmail — it can't be changed now."
        : `This draft is ${draft.status} and can't be edited.`,
    );
  }
  const orgId = draft.orgId;
  const thread = draft.threadId ? await ctx.db.get(draft.threadId) : null;
  const threads = thread && thread.orgId === orgId ? await conversationThreads(ctx, thread) : [];
  const task = draft.taskId ? await ctx.db.get(draft.taskId) : null;

  const next: Partial<Doc<"emailDrafts">> = {};
  if (patch.subject !== undefined) {
    const subject = cleanText(patch.subject, SUBJECT_MAX, "Subject");
    if (subject !== draft.subject) {
      if (draft.subjectLocked) throw new ConvexError(SUBJECT_LOCKED_MESSAGE);
      next.subject = subject;
    }
  }
  if (patch.bodyText !== undefined) {
    const body = cleanBody(patch.bodyText);
    if (body !== draft.bodyText) next.bodyText = body;
  }
  if (patch.to !== undefined || patch.cc !== undefined) {
    const clientId = thread?.clientId ?? task?.clientId;
    const clientRow = clientId ? await ctx.db.get(clientId) : null;
    const client = clientRow && clientRow.orgId === orgId ? clientRow : null;
    const recipients = normalizeRecipients(
      patch.to ?? draft.to,
      patch.cc ?? draft.cc,
      await allowedRecipients(ctx, threads, client),
    );
    if (!sameJson(recipients.to, draft.to)) next.to = recipients.to;
    if (!sameJson(recipients.cc, draft.cc)) next.cc = recipients.cc;
  }
  if (patch.attachments !== undefined) {
    const list = await validateAttachments(ctx, orgId, task && task.orgId === orgId ? task : null, threads, patch.attachments);
    if (!sameJson(list, draft.attachments)) next.attachments = list;
  }
  if (patch.answersRequestIds !== undefined) {
    const ids = await validateAnswers(ctx, orgId, threads, draft.agentThreadId, patch.answersRequestIds);
    if (!sameJson(ids, draft.answersRequestIds ?? [])) next.answersRequestIds = ids.length > 0 ? ids : undefined;
  }
  if (patch.promiseCandidates !== undefined) {
    const list = validateCandidates(patch.promiseCandidates);
    if (!sameJson(list, draft.promiseCandidates ?? [])) next.promiseCandidates = list.length > 0 ? list : undefined;
  }
  if (patch.fromConnectorId !== undefined && patch.fromConnectorId !== draft.fromConnectorId) {
    if (threads.length > 0) {
      const holders = await holdersOf(ctx, threads);
      if (!holders.some((h) => h.connectorId === patch.fromConnectorId)) {
        throw new ConvexError("That mailbox does not hold this conversation");
      }
    } else {
      const c = await ctx.db.get(patch.fromConnectorId);
      const mine = editor ? c?.userId === editor.userId : c?.userId === (await ctx.db.get(draft.fromConnectorId))?.userId;
      if (!c || c.orgId !== orgId || c.type !== "gmail" || !mine) {
        throw new ConvexError("Pick your own mailbox for a new conversation");
      }
    }
    next.fromConnectorId = patch.fromConnectorId;
  }

  if (Object.keys(next).length === 0) return { version: draft.version, changed: false };
  await cancelScheduled(ctx, draft.scheduledFnId);
  const version = draft.version + 1;
  await ctx.db.patch(draft._id, {
    ...next,
    ...RESET_SEND_FIELDS,
    stale: undefined,
    version,
    lastEditedBy: editor ? editor.userId : "agent",
    updatedAt: Date.now(),
  });
  return { version, changed: true };
}

const patchArgs = {
  to: v.optional(v.array(emailDraftRecipientValidator)),
  cc: v.optional(v.array(emailDraftRecipientValidator)),
  subject: v.optional(v.string()),
  bodyText: v.optional(v.string()),
  attachments: v.optional(v.array(emailDraftAttachmentValidator)),
  answersRequestIds: v.optional(v.array(v.id("clientRequests"))),
  promiseCandidates: v.optional(v.array(emailPromiseCandidateValidator)),
};

/**
 * A person edits the draft. `version` is the one they edited (D9): a draft
 * that changed meanwhile is refused ("review it again").
 */
export const updateDraft = mutation({
  args: { draftId: v.id("emailDrafts"), version: v.number(), ...patchArgs },
  handler: async (ctx, { draftId, version, ...patch }): Promise<{ version: number }> => {
    const { auth, draft, ownsAsMember } = await loadDraftForCaller(ctx, draftId);
    if (draft.version !== version) throw new ConvexError(VERSION_CHANGED_MESSAGE);
    if (ownsAsMember && draft.status !== "draft") throw new ConvexError(`This draft is ${draft.status}`);
    return { version: (await updateDraftCore(ctx, draft, patch, auth)).version };
  },
});

/** The agent rewrites its own draft (D20) — same rules as a person's edit. */
export const reviseDraftInternal = internalMutation({
  args: { orgId: v.string(), draftId: v.id("emailDrafts"), ...patchArgs },
  handler: async (ctx, { orgId, draftId, ...patch }): Promise<{ version: number }> => {
    const draft = await ctx.db.get(draftId);
    if (!draft || draft.orgId !== orgId) throw new ConvexError(DRAFT_NOT_FOUND);
    await requireEmailTriageEnabled(ctx, orgId);
    return { version: (await updateDraftCore(ctx, draft, patch, null)).version };
  },
});

/**
 * D35: switch the sending mailbox — only to a mailbox that holds the
 * conversation (a new conversation: your own). An edit like any other.
 */
export const setFromMailbox = mutation({
  args: { draftId: v.id("emailDrafts"), version: v.number(), connectorId: v.id("connectors") },
  handler: async (ctx, args): Promise<{ version: number }> => {
    const { auth, draft } = await loadDraftForCaller(ctx, args.draftId);
    // Only an admin picks the sending mailbox (D35): a member never sees the
    // other mailboxes of a conversation (getDraft), nor switches to one.
    if (!auth.isAdmin) throw new ConvexError("Admin access required");
    if (draft.version !== args.version) throw new ConvexError(VERSION_CHANGED_MESSAGE);
    return { version: (await updateDraftCore(ctx, draft, { fromConnectorId: args.connectorId }, auth)).version };
  },
});

/** A stale draft was looked at again and still holds (D9) — admin only. */
export const markDraftReviewed = mutation({
  args: { draftId: v.id("emailDrafts"), version: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const { auth, draft } = await loadDraftForCaller(ctx, args.draftId);
    if (!auth.isAdmin) throw new ConvexError("Admin access required");
    if (draft.version !== args.version) throw new ConvexError(VERSION_CHANGED_MESSAGE);
    if (draft.stale) await ctx.db.patch(draft._id, { stale: undefined, updatedAt: Date.now() });
    return null;
  },
});

// ─── Discard / restore ────────────────────────────────────────────────────────

export const discardDraft = mutation({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<null> => {
    const { auth, draft, ownsAsMember } = await loadDraftForCaller(ctx, args.draftId);
    if (draft.status === "discarded") return null;
    const allowed = ownsAsMember ? draft.status === "draft" : EDITABLE.has(draft.status);
    if (!allowed) throw new ConvexError(`This draft is ${draft.status} and can't be discarded.`);
    await cancelScheduled(ctx, draft.scheduledFnId);
    await ctx.db.patch(draft._id, { ...RESET_SEND_FIELDS, status: "discarded", updatedAt: Date.now() });
    await closeItemOnKickoffDiscard(ctx, draft, auth.userId);
    return null;
  },
});

/**
 * D21 / D26 (B6b): discarding the kickoff of a "kickoff pending" item ends
 * its last step — the item closes with its commit's outcome (created /
 * merged / applied) and `kickoffOutcome: "discarded"`. Not while a newer
 * change on the item is still undecided (its Apply drafts the kickoff again).
 */
async function closeItemOnKickoffDiscard(ctx: MutationCtx, draft: Doc<"emailDrafts">, userId: Id<"users">): Promise<void> {
  if (!draft.threadId) return;
  const item = await findLiveItem(ctx, draft.orgId, { type: "emailThread", id: draft.threadId });
  if (!item || item.draftId !== draft._id || !item.commit || openAttentions(item).length > 0) return;
  const changePending =
    item.kind === "change" && (!item.changePlan || !item.commit.proposalIds.includes(item.changePlan.proposalId));
  if (changePending) return;
  await closeEmailItem(ctx, item, { outcome: item.commit.outcome, userId, kickoffOutcome: "discarded" });
}

export const restoreDraft = mutation({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<null> => {
    const { draft } = await loadDraftForCaller(ctx, args.draftId);
    if (draft.status !== "discarded") return null;
    await ctx.db.patch(draft._id, { status: "draft", updatedAt: Date.now() });
    return null;
  },
});

// ─── Stale (D9, D33) ──────────────────────────────────────────────────────────

const STALE_STATES: ReadonlySet<string> = new Set(["draft", "queued", "failed"]);

/** "Kovács Réka wrote at 14:05" (org timezone). */
export function inboundStaleReason(message: Pick<Doc<"emailMessages">, "from" | "sentAt">, tz: string): string {
  const who = message.from.name?.trim() || message.from.email;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(message.sentAt));
  return `${who} wrote at ${time}`;
}

/**
 * Mark every open draft of the conversation stale: `draft` / `failed` keep
 * their state with the flag (approve and Retry are refused until reviewed),
 * a `queued` one goes back to `draft` — its scheduled send is cancelled
 * (a relevant client message during the undo window stops the send).
 * Drafts already handed to Gmail (dispatching / unknown / sent) are left alone.
 */
export async function markConversationDraftsStale(
  ctx: MutationCtx,
  thread: Doc<"emailThreads">,
  reason: string,
): Promise<Id<"emailDrafts">[]> {
  const marked: Id<"emailDrafts">[] = [];
  const now = Date.now();
  const stale = { reason: reason.slice(0, 300), at: now };
  for (const t of await conversationThreads(ctx, thread)) {
    const drafts = await ctx.db
      .query("emailDrafts")
      .withIndex("by_orgId_threadId", (q) => q.eq("orgId", t.orgId).eq("threadId", t._id))
      .order("desc")
      .take(DRAFTS_PER_THREAD_CAP);
    for (const d of drafts) {
      if (!STALE_STATES.has(d.status)) continue;
      if (d.status === "queued") {
        await cancelScheduled(ctx, d.scheduledFnId);
        await ctx.db.patch(d._id, { ...RESET_SEND_FIELDS, stale, updatedAt: now });
      } else if (d.status === "failed") {
        await cancelScheduled(ctx, d.scheduledFnId);
        await ctx.db.patch(d._id, { stale, scheduledFnId: undefined, autoRetryAt: undefined, updatedAt: now });
      } else {
        await ctx.db.patch(d._id, { stale, updatedAt: now });
      }
      marked.push(d._id);
    }
  }
  return marked;
}

/**
 * Mark every open draft ON A TASK stale (B6b: an applied change from a client
 * email — D9 "a change on the thread's tasks makes the version stale"). Same
 * per-state rules as `markConversationDraftsStale`.
 */
export async function markTaskDraftsStale(
  ctx: MutationCtx,
  orgId: string,
  taskId: Id<"tasks">,
  reason: string,
): Promise<Id<"emailDrafts">[]> {
  const marked: Id<"emailDrafts">[] = [];
  const now = Date.now();
  const stale = { reason: reason.slice(0, 300), at: now };
  const drafts = await ctx.db
    .query("emailDrafts")
    .withIndex("by_orgId_taskId", (q) => q.eq("orgId", orgId).eq("taskId", taskId))
    .order("desc")
    .take(DRAFTS_PER_THREAD_CAP);
  for (const d of drafts) {
    if (!STALE_STATES.has(d.status)) continue;
    await cancelScheduled(ctx, d.scheduledFnId);
    if (d.status === "queued") await ctx.db.patch(d._id, { ...RESET_SEND_FIELDS, stale, updatedAt: now });
    else if (d.status === "failed") await ctx.db.patch(d._id, { stale, scheduledFnId: undefined, autoRetryAt: undefined, updatedAt: now });
    else await ctx.db.patch(d._id, { stale, updatedAt: now });
    marked.push(d._id);
  }
  return marked;
}

/** The stale reason for a new inbound message, in the org's timezone. */
export async function staleReasonForInbound(ctx: QueryCtx | MutationCtx, message: Doc<"emailMessages">): Promise<string> {
  const tz = (await getOrgSettings(ctx, message.orgId))?.timezone || ORG_TIMEZONE_FALLBACK;
  return inboundStaleReason(message, tz);
}

/**
 * For B3 (D33 — "You replied in Gmail at 14:05") and any other server
 * writer: stale the open drafts of a conversation. Feature-gated (I14).
 */
export const markThreadDraftsStale = internalMutation({
  args: { threadId: v.id("emailThreads"), reason: v.string() },
  handler: async (ctx, args): Promise<{ marked: number }> => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || !(await isEmailTriageEnabled(ctx, thread.orgId))) return { marked: 0 };
    return { marked: (await markConversationDraftsStale(ctx, thread, args.reason)).length };
  },
});

// ─── Read ─────────────────────────────────────────────────────────────────────

export type DraftMailbox = {
  connectorId: Id<"connectors">;
  email: string | null;
  ownerName: string | null;
  connected: boolean;
};

export type DraftView = Omit<Doc<"emailDrafts">, "approval" | "scheduledFnId" | "messageIdHeader" | "lastEditedBy"> & {
  approval: { version: number; userId: Id<"users">; at: number; warningsAcknowledged: string[] } | null;
  fromMailbox: { email: string | null; ownerName: string | null; connected: boolean } | null;
  /** B8a: who made the version shown ("v2 · rewritten" / "edited by you"); null on v1. */
  lastEdit: { by: "agent" } | { by: "user"; isViewer: boolean; name: string | null } | null;
  /** B8a, D35: the mailboxes that hold the conversation — the From menu (the current one included). Admins only; a member gets just the current one. */
  mailboxOptions: DraftMailbox[];
  /** B8a: the viewer may approve / send (an admin by the CURRENT role). UX only — every mutation re-checks. */
  viewerIsAdmin: boolean;
  /** B8a: the viewer may edit it now (an admin while editable; a member's own draft while `draft`). */
  viewerCanEdit: boolean;
  /**
   * B8a: a `failed` draft whose approval still binds it (Retry). False → it
   * needs a fresh Approve & send (e.g. the mailbox was reconnected).
   */
  retryable: boolean;
};

/** A connector as the From line shows it (address, owner, connected). */
async function draftMailbox(ctx: QueryCtx, orgId: string, connectorId: Id<"connectors">): Promise<DraftMailbox | null> {
  const connector = await ctx.db.get(connectorId);
  if (!connector || connector.orgId !== orgId) return null;
  const owner = await ctx.db.get(connector.userId);
  return {
    connectorId: connector._id,
    email: connector.credentialMask ?? null,
    ownerName: owner?.name ?? null,
    connected: connector.status === "connected" && !connector.devSeed && Boolean(connector.credentialsCiphertext),
  };
}

/**
 * One draft for the email component (B8): admins, or the member who saved
 * it for their own task. Null when missing, foreign, not allowed or the
 * feature is off. The approval hash and scheduling internals stay server-side.
 */
export const getDraft = query({
  args: { draftId: v.id("emailDrafts") },
  handler: async (ctx, args): Promise<DraftView | null> => {
    let auth: AuthContext;
    try {
      auth = await currentAuth(ctx);
    } catch {
      return null;
    }
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.orgId !== auth.orgId) return null;
    if (!(await isEmailTriageEnabled(ctx, auth.orgId))) return null;
    if (!auth.isAdmin && !(await memberOwnsDraft(ctx, auth, draft))) return null;
    const mailbox = await draftMailbox(ctx, draft.orgId, draft.fromConnectorId);
    // A member sees only the sending address — no owner names, no other mailboxes.
    const from = mailbox && !auth.isAdmin ? { ...mailbox, ownerName: null } : mailbox;
    const { approval, scheduledFnId: _s, messageIdHeader: _m, lastEditedBy, ...rest } = draft;
    void _s;
    void _m;

    // D35: the From menu offers the mailboxes that hold the conversation (admins).
    const mailboxOptions: DraftMailbox[] = from ? [from] : [];
    const thread = auth.isAdmin && draft.threadId ? await ctx.db.get(draft.threadId) : null;
    if (thread && thread.orgId === draft.orgId) {
      for (const holder of await holdersOf(ctx, await conversationThreads(ctx, thread))) {
        if (mailboxOptions.some((m) => m.connectorId === holder.connectorId)) continue;
        const option = await draftMailbox(ctx, draft.orgId, holder.connectorId);
        if (option) mailboxOptions.push(option);
      }
    }

    let lastEdit: DraftView["lastEdit"] = null;
    if (draft.version > 1 && lastEditedBy === "agent") lastEdit = { by: "agent" };
    else if (draft.version > 1 && lastEditedBy) {
      const editor = await ctx.db.get(lastEditedBy as Id<"users">);
      lastEdit = { by: "user", isViewer: lastEditedBy === auth.userId, name: editor?.name ?? null };
    }

    return {
      ...rest,
      approval: approval
        ? { version: approval.version, userId: approval.userId, at: approval.at, warningsAcknowledged: approval.warningsAcknowledged ?? [] }
        : null,
      fromMailbox: from ? { email: from.email, ownerName: from.ownerName, connected: from.connected } : null,
      lastEdit,
      mailboxOptions,
      viewerIsAdmin: auth.isAdmin,
      viewerCanEdit: auth.isAdmin ? EDITABLE.has(draft.status) : draft.status === "draft",
      retryable: draft.status === "failed" && (await approvalBinds(ctx, draft)),
    };
  },
});

// TODO(B8): demo the send flow on the dev seed. The seed mailbox is
// `revoked` (devSeedEmail.ts), so Approve & send on a seed draft returns the
// `reconnect` block ("Reconnect … to send") and nothing is queued; a forced
// dispatch fails as `disconnected` (gmailAuth refuses a devSeed grant). B8
// can show the whole countdown → sent path by drafting on a thread of a real
// connected mailbox (B1), or with the convex-test fake transport.

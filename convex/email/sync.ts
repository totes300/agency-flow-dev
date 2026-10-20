import { v, ConvexError } from "convex/values";
import { internalMutation, internalQuery, mutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { getAuthContext } from "../lib/auth";
import { getOrgSettings } from "../lib/orgHelpers";
import { emailAddressValidator, emailMessageAttachmentValidator, syncErrorKindValidator } from "../lib/validators";
import { findLiveItem, joinItem, openAttentions, openItem } from "../agentItems";
import { loadOwnConnection } from "../connectors";
import { currentAuth } from "./drafts";
import { isEmailTriageEnabled, requireEmailTriageEnabled } from "./gate";
import { markGrantStatus } from "./gmailAuth";
import { closeMailboxAttention, openMailboxAttention } from "./mailboxItem";
import {
  emailDomain,
  extractTaskIdentifiers,
  isBulkOrAutomated,
  matchClientByDomain,
  normalizeSubject,
  stripQuoted,
  type EmailAddress,
} from "./model";
import {
  capUtf8,
  chooseSentAt,
  decideIngest,
  fitMessageBudget,
  isIgnoredDomain,
  isReplyToOutsider,
  LAST_SYNC_WRITE_EVERY_MS,
  laterCursor,
  MAX_MESSAGE_ATTEMPTS,
  senderAuthentication,
  SYNC_ATTENTION_AFTER_MS,
  SYNC_LEASE_MS,
  syncBackoffMs,
  THREAD_PARTICIPANTS_CAP,
  UNPROCESSABLE_CAP,
  type IngestDecision,
} from "./syncModel";

/**
 * Gmail → the B4 pipeline (docs/prd-email-triage.md B3, D24, D33, D34,
 * D36, §5.2, I1, I5, I13, I14). The V8 half: the cron, the per-mailbox lease,
 * the D24 filter against the database, the store, failure bookkeeping and
 * `Resync last 7 days`. The run itself is the Node action
 * `email/syncNode.ts` `syncMailbox` (Node: a raw message with 25 MB of
 * attachments does not fit the default runtime's memory).
 *
 *   cron (1 min) ─ scheduleSyncs ─ scheduleOrgSyncs ─▶ syncMailbox     [Node]
 *     claimSyncLease ─ one run per mailbox (leaseId until leaseUntil, 11 min)
 *     no cursor      → profile.historyId = cursor, nothing stored (D34)
 *     cursor         → history (messageAdded) since it, ≤ 100 downloads a run
 *       per message:  newMessageIds (I1) → raw → beginMessageAttempt (H1:
 *                     the 4th try of a message that keeps crashing is passed
 *                     as unprocessable) → mimeParse → prepareIngest (D24) →
 *                     attachments ≤ 25 MB to _storage → storeIngested
 *                     (re-decides, upserts the thread, inserts the message,
 *                     schedules processInboundMessage / D33). A store that
 *                     fails stores a minimal "couldn't be stored" row (I5
 *                     attention) — the cursor passes it.
 *     404 cursor     → bounded resync: profile first, then the 7-day search
 *                     (idempotent through I1; page token + done ids kept),
 *                     then cursor = that profile id
 *     finishSyncRun  → cursor advanced to the last fully handled record
 *     error          → recordSyncFailure: kind + message + at, backoff,
 *                     401 / missing scope mark the connector (Reconnect on
 *                     its row); a mailbox failing > 10 min opens the Triage
 *                     item (email/mailboxItem.ts); the next success closes it
 *
 * The cursor, lease, resync progress and attempt markers live in
 * `mailboxSyncStates` (high churn); `connectors.sync` holds only what the
 * connector row shows, written on change (`lastSyncAt` at most every 5 min).
 * Seed mailboxes (`devSeed`) are never synced; every entry point checks
 * `emailTriageEnabled` (I14). Nothing here logs a token or a body.
 */

const GMAIL = "gmail";
const ORG_PAGE = 20;
const CONNECTOR_PAGE = 50;
const TEAM_MEMBERS_CAP = 500;
const CLIENTS_CAP = 500;
const REFERENCE_LOOKUPS_CAP = 20;
const IN_FLIGHT_DRAFTS_CAP = 50;
const ATTEMPT_MARKERS_CAP = 50;
const RFC_MESSAGE_ID_MAX = 998;

export { MAILBOX_ANCHOR_TYPE } from "./mailboxItem";

type SyncState = NonNullable<Doc<"connectors">["sync"]>;
type ResyncState = NonNullable<Doc<"mailboxSyncStates">["resync"]>;

const resyncStateValidator = v.object({
  reason: v.union(v.literal("manual"), v.literal("expired")),
  requestedAt: v.number(),
  newCursor: v.optional(v.string()),
  pageToken: v.optional(v.string()),
  doneIds: v.optional(v.array(v.string())),
});

/** A real, live gmail mailbox (never a seed row). */
function isSyncable(row: Doc<"connectors">): boolean {
  return row.type === GMAIL && row.status === "connected" && !row.devSeed && !!row.credentialsCiphertext;
}

async function loadState(ctx: QueryCtx, connectorId: Id<"connectors">): Promise<Doc<"mailboxSyncStates"> | null> {
  return await ctx.db
    .query("mailboxSyncStates")
    .withIndex("by_connectorId", (q) => q.eq("connectorId", connectorId))
    .unique();
}

/** The state row of THIS connection: created, or reset when the connector's key no longer names it (a fresh start). */
async function ensureState(ctx: MutationCtx, row: Doc<"connectors">): Promise<Doc<"mailboxSyncStates">> {
  const state = await loadState(ctx, row._id);
  const key = row.sync?.stateKey;
  if (state && key && state.stateKey === key) return state;
  const now = Date.now();
  const stateKey = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await ctx.db.patch(row._id, { sync: { ...(row.sync ?? {}), stateKey } });
  if (state) {
    await ctx.db.replace(state._id, { orgId: row.orgId, connectorId: row._id, stateKey, updatedAt: now });
    return (await ctx.db.get(state._id))!;
  }
  const id = await ctx.db.insert("mailboxSyncStates", { orgId: row.orgId, connectorId: row._id, stateKey, updatedAt: now });
  return (await ctx.db.get(id))!;
}

const leaseHeld = (state: Doc<"mailboxSyncStates"> | null, now: number) =>
  !!state?.leaseUntil && state.leaseUntil > now;

const ownsLease = (state: Doc<"mailboxSyncStates"> | null, leaseId: string, now: number) =>
  !!state && state.leaseId === leaseId && !!state.leaseUntil && state.leaseUntil > now;

// ─── Cron ─────────────────────────────────────────────────────────────────────

/**
 * Every minute (D36): one page of flagged orgs (index range, no table scan,
 * no cap — the next page is a scheduled continuation); each org's mailboxes
 * are scheduled by `scheduleOrgSyncs`.
 */
export const scheduleSyncs = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args): Promise<{ orgs: number }> => {
    const page = await ctx.db
      .query("orgSettings")
      .withIndex("by_emailTriageEnabled", (q) => q.eq("emailTriageEnabled", true))
      .paginate({ numItems: ORG_PAGE, cursor: args.cursor ?? null });
    for (const org of page.page) {
      await ctx.scheduler.runAfter(0, internal.email.sync.scheduleOrgSyncs, { orgId: org.orgId, cursor: null });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.email.sync.scheduleSyncs, { cursor: page.continueCursor });
    return { orgs: page.page.length };
  },
});

/**
 * One page of an org's connected gmail mailboxes → `syncMailbox` each, skipping
 * seed rows, a mailbox whose run holds the lease and one in backoff. Writes
 * nothing itself (the run claims the lease); continues itself page by page.
 */
export const scheduleOrgSyncs = internalMutation({
  args: { orgId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    if (!(await isEmailTriageEnabled(ctx, args.orgId))) return { scheduled: 0 };
    const now = Date.now();
    const page = await ctx.db
      .query("connectors")
      .withIndex("by_orgId_type_status", (q) => q.eq("orgId", args.orgId).eq("type", GMAIL).eq("status", "connected"))
      .paginate({ numItems: CONNECTOR_PAGE, cursor: args.cursor });
    let scheduled = 0;
    for (const row of page.page) {
      if (!isSyncable(row)) continue;
      if (row.sync?.backoffUntil && row.sync.backoffUntil > now) continue;
      if (leaseHeld(await loadState(ctx, row._id), now)) continue;
      await ctx.scheduler.runAfter(0, internal.email.syncNode.syncMailbox, { connectorId: row._id });
      scheduled++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.email.sync.scheduleOrgSyncs, { orgId: args.orgId, cursor: page.continueCursor });
    }
    return { scheduled };
  },
});

// ─── Lease ────────────────────────────────────────────────────────────────────

export type SyncClaim = { orgId: string; cursor: string | null; resync: ResyncState | null };

/**
 * Take the mailbox for one run: null when it is not syncable, the org flag
 * is off, another run holds the lease, or it is backing off (M4: a resync
 * waits for the backoff too; asking for one clears it). The lease (11 min)
 * outlives any action, so it never ends under a live run.
 */
export const claimSyncLease = internalMutation({
  args: { connectorId: v.id("connectors"), leaseId: v.string() },
  handler: async (ctx, args): Promise<SyncClaim | null> => {
    const row = await ctx.db.get(args.connectorId);
    if (!row || !isSyncable(row)) return null;
    if (!(await isEmailTriageEnabled(ctx, row.orgId))) return null;
    const now = Date.now();
    if (row.sync?.backoffUntil && row.sync.backoffUntil > now) return null;
    const state = await ensureState(ctx, row);
    if (leaseHeld(state, now)) return null;
    await ctx.db.patch(state._id, { leaseId: args.leaseId, leaseUntil: now + SYNC_LEASE_MS, updatedAt: now });
    return { orgId: row.orgId, cursor: state.cursor ?? null, resync: state.resync ?? null };
  },
});

/** Drop the attempt markers of finished messages. */
const withoutDone = (attempts: Doc<"mailboxSyncStates">["attempts"], done: readonly string[]) =>
  done.length === 0 ? attempts : (attempts ?? []).filter((a) => !done.includes(a.gmailMessageId));

/**
 * L1: give the lease back WITHOUT moving the cursor — the flag went off, the
 * mailbox was disconnected, or the lease was lost mid-run.
 */
export const releaseSyncLease = internalMutation({
  args: { connectorId: v.id("connectors"), leaseId: v.string(), completed: v.optional(v.array(v.string())) },
  handler: async (ctx, args): Promise<null> => {
    const state = await loadState(ctx, args.connectorId);
    if (!state || state.leaseId !== args.leaseId) return null;
    await ctx.db.patch(state._id, {
      leaseId: undefined,
      leaseUntil: undefined,
      attempts: withoutDone(state.attempts, args.completed ?? []),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * A run ended well: the cursor moves forward (never back) to the last fully
 * handled history record — or to the new cursor of a finished resync — and
 * the error streak ends. The connector row is written only when something
 * it shows changed, or `lastSyncAt` is 5 minutes old (L5). Ignored when the
 * run no longer holds the lease.
 */
export const finishSyncRun = internalMutation({
  args: {
    connectorId: v.id("connectors"),
    leaseId: v.string(),
    cursor: v.optional(v.string()),
    // null = the resync is finished (clear it); absent = unchanged.
    resync: v.optional(v.union(resyncStateValidator, v.null())),
    fullSync: v.optional(v.boolean()),
    completed: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const now = Date.now();
    const state = await loadState(ctx, args.connectorId);
    if (!ownsLease(state, args.leaseId, now)) return { applied: false };
    const row = await ctx.db.get(args.connectorId);
    if (!row) return { applied: false };
    await ctx.db.patch(state!._id, {
      cursor: laterCursor(state!.cursor, args.cursor),
      resync: args.resync === null ? undefined : (args.resync ?? state!.resync),
      attempts: withoutDone(state!.attempts, args.completed ?? []),
      leaseId: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    const sync: SyncState = row.sync ?? {};
    const next: SyncState = { ...sync };
    let changed = false;
    if (sync.error || sync.failingSince !== undefined || sync.failures !== undefined || sync.backoffUntil !== undefined) {
      next.error = undefined;
      next.failingSince = undefined;
      next.failures = undefined;
      next.backoffUntil = undefined;
      changed = true;
    }
    if (args.fullSync) {
      next.lastFullSyncAt = now;
      changed = true;
    }
    if (args.resync === null && sync.resyncRequestedAt !== undefined) {
      next.resyncRequestedAt = undefined;
      changed = true;
    }
    if (changed || !sync.lastSyncAt || now - sync.lastSyncAt >= LAST_SYNC_WRITE_EVERY_MS) {
      next.lastSyncAt = now;
      await ctx.db.patch(row._id, { sync: next });
    }
    await closeMailboxAttention(ctx, row);
    return { applied: true };
  },
});

/**
 * A run failed: keep its progress (cursor, resync page), store the error
 * (kind + message + at) for the connector row, back off (transient / quota),
 * mark the grant on 401 (`expired`) or a missing scope (`error`) like the
 * send pipeline does. A mailbox needing a reconnect never gets the Triage
 * item (its row shows Reconnect; an open one closes); any other failure
 * opens it once the mailbox has failed for 10 minutes.
 */
export const recordSyncFailure = internalMutation({
  args: {
    connectorId: v.id("connectors"),
    leaseId: v.string(),
    kind: syncErrorKindValidator,
    message: v.string(),
    cursor: v.optional(v.string()),
    resync: v.optional(v.union(resyncStateValidator, v.null())),
    completed: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    const now = Date.now();
    const state = await loadState(ctx, args.connectorId);
    if (!ownsLease(state, args.leaseId, now)) return { applied: false };
    const row = await ctx.db.get(args.connectorId);
    if (!row) return { applied: false };
    await ctx.db.patch(state!._id, {
      cursor: laterCursor(state!.cursor, args.cursor),
      resync: args.resync === null ? undefined : (args.resync ?? state!.resync),
      attempts: withoutDone(state!.attempts, args.completed ?? []),
      leaseId: undefined,
      leaseUntil: undefined,
      updatedAt: now,
    });
    const sync: SyncState = row.sync ?? {};
    const failures = (sync.failures ?? 0) + 1;
    const failingSince = sync.failingSince ?? now;
    const backoff = syncBackoffMs(args.kind, failures);
    const error = { kind: args.kind, message: args.message.slice(0, 300) || "Sync failed", at: now };
    await ctx.db.patch(row._id, {
      sync: { ...sync, error, failingSince, failures, backoffUntil: backoff === null ? undefined : now + backoff },
    });
    const needsReconnect = args.kind === "disconnected" || args.kind === "permission";
    if (needsReconnect) {
      await markGrantStatus(ctx, row._id, row.connectedAt, args.kind === "disconnected" ? "expired" : "error");
      await closeMailboxAttention(ctx, row);
    } else if (now - failingSince >= SYNC_ATTENTION_AFTER_MS) {
      await openMailboxAttention(ctx, (await ctx.db.get(row._id))!, error);
    }
    return { applied: true };
  },
});

// ─── Per-message attempts (H1) ───────────────────────────────────────────────

async function addUnprocessable(ctx: MutationCtx, row: Doc<"connectors">, gmailMessageId: string, reason: string) {
  const sync: SyncState = row.sync ?? {};
  const list = (sync.unprocessable ?? []).filter((u) => u.gmailMessageId !== gmailMessageId);
  list.push({ gmailMessageId, reason: reason.slice(0, 200), at: Date.now() });
  await ctx.db.patch(row._id, { sync: { ...sync, unprocessable: list.slice(-UNPROCESSABLE_CAP) } });
}

/**
 * Before a downloaded message is parsed: count the attempt. A message whose
 * earlier attempts never finished (the action died on it) is passed on its
 * 4th try — listed as unprocessable on the connector row — so the cursor
 * can move past it. `completed` = the run's finished messages (their markers
 * go). `lost`: the run no longer holds the lease → abort.
 */
export const beginMessageAttempt = internalMutation({
  args: {
    connectorId: v.id("connectors"),
    leaseId: v.string(),
    gmailMessageId: v.string(),
    completed: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ proceed: boolean; lost: boolean }> => {
    const now = Date.now();
    const state = await loadState(ctx, args.connectorId);
    if (!ownsLease(state, args.leaseId, now)) return { proceed: false, lost: true };
    const attempts = withoutDone(state!.attempts, args.completed) ?? [];
    const marker = attempts.find((a) => a.gmailMessageId === args.gmailMessageId);
    if (marker && marker.count >= MAX_MESSAGE_ATTEMPTS) {
      const row = await ctx.db.get(args.connectorId);
      if (row) await addUnprocessable(ctx, row, args.gmailMessageId, `Couldn't be read after ${MAX_MESSAGE_ATTEMPTS} attempts`);
      await ctx.db.patch(state!._id, { attempts: attempts.filter((a) => a !== marker), updatedAt: now });
      return { proceed: false, lost: false };
    }
    const next = marker
      ? attempts.map((a) => (a === marker ? { ...a, count: a.count + 1, at: now } : a))
      : [...attempts, { gmailMessageId: args.gmailMessageId, count: 1, at: now }].slice(-ATTEMPT_MARKERS_CAP);
    await ctx.db.patch(state!._id, { attempts: next, updatedAt: now });
    return { proceed: true, lost: false };
  },
});

/** A message that could not be read (a parse error) or stored at all: listed on the connector row, passed. */
export const markUnprocessable = internalMutation({
  args: { connectorId: v.id("connectors"), leaseId: v.string(), gmailMessageId: v.string(), reason: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const state = await loadState(ctx, args.connectorId);
    if (!state || state.leaseId !== args.leaseId) return null;
    const row = await ctx.db.get(args.connectorId);
    if (row) await addUnprocessable(ctx, row, args.gmailMessageId, args.reason);
    await ctx.db.patch(state._id, { attempts: withoutDone(state.attempts, [args.gmailMessageId]), updatedAt: Date.now() });
    return null;
  },
});

// ─── Resync last 7 days (§7.6) ────────────────────────────────────────────────

async function requestResync(ctx: MutationCtx, row: Doc<"connectors">): Promise<{ alreadyRunning: boolean }> {
  const state = await ensureState(ctx, row);
  const fresh = (await ctx.db.get(row._id))!;
  const alreadyRunning = Boolean(state.resync);
  if (!state.resync) {
    await ctx.db.patch(state._id, { resync: { reason: "manual", requestedAt: Date.now() }, updatedAt: Date.now() });
  }
  const sync: SyncState = fresh.sync ?? {};
  // Asking for it ends a backoff (the run may start now).
  await ctx.db.patch(row._id, {
    sync: { ...sync, resyncRequestedAt: sync.resyncRequestedAt ?? Date.now(), backoffUntil: undefined },
  });
  // A run holding the lease right now ends without it; the cron picks the resync up a minute later.
  await ctx.scheduler.runAfter(0, internal.email.syncNode.syncMailbox, { connectorId: row._id });
  return { alreadyRunning };
}

export const NOT_SYNCABLE_MESSAGE = "Connect Gmail first — this mailbox isn't syncing.";

/**
 * `Resync last 7 days` on the caller's OWN Gmail row (any role: it is their
 * mailbox; the D24 filter still applies to what it stores). Idempotent
 * through I1 — nothing already stored is stored again.
 */
export const resyncMyMailbox = mutation({
  args: {},
  handler: async (ctx): Promise<{ alreadyRunning: boolean }> => {
    const auth = await getAuthContext(ctx);
    await requireEmailTriageEnabled(ctx, auth.orgId);
    const row = await loadOwnConnection(ctx, auth, GMAIL);
    if (!row || !isSyncable(row)) throw new ConvexError(NOT_SYNCABLE_MESSAGE);
    return await requestResync(ctx, row);
  },
});

/**
 * The "Mailbox not syncing" item's Resync (Triage is admin-only): an admin
 * (role from orgMembers) resyncs any mailbox of their org.
 */
export const resyncMailboxAsAdmin = mutation({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, args): Promise<{ alreadyRunning: boolean }> => {
    const auth = await currentAuth(ctx);
    if (!auth.isAdmin) throw new ConvexError("Admin access required");
    await requireEmailTriageEnabled(ctx, auth.orgId);
    const row = await ctx.db.get(args.connectorId);
    if (!row || row.orgId !== auth.orgId || !isSyncable(row)) throw new ConvexError(NOT_SYNCABLE_MESSAGE);
    return await requestResync(ctx, row);
  },
});

/**
 * Operator variant (no UI):
 *
 *   npx convex run email/sync:resyncMailbox '{"connectorId":"…"}'
 */
export const resyncMailbox = internalMutation({
  args: { connectorId: v.id("connectors") },
  handler: async (ctx, args): Promise<{ alreadyRunning: boolean }> => {
    const row = await ctx.db.get(args.connectorId);
    if (!row || !isSyncable(row)) throw new ConvexError(NOT_SYNCABLE_MESSAGE);
    await requireEmailTriageEnabled(ctx, row.orgId);
    return await requestResync(ctx, row);
  },
});

// ─── The D24 filter against the database ─────────────────────────────────────

const ingestHeaderValidator = v.object({ name: v.string(), value: v.string() });

const ingestFields = {
  gmailMessageId: v.string(),
  gmailThreadId: v.string(),
  labelIds: v.array(v.string()),
  from: v.union(emailAddressValidator, v.null()),
  to: v.array(emailAddressValidator),
  cc: v.array(emailAddressValidator),
  subject: v.string(),
  rfcMessageId: v.string(),
  inReplyTo: v.union(v.string(), v.null()),
  references: v.array(v.string()),
  /** The headers the filter reads (List-*, Precedence, Auto-Submitted, X-Autoreply, Authentication-Results…). */
  headers: v.array(ingestHeaderValidator),
};
const ingestValidator = v.object(ingestFields);
type IngestInput = {
  gmailMessageId: string;
  gmailThreadId: string;
  labelIds: string[];
  from: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  subject: string;
  rfcMessageId: string;
  inReplyTo: string | null;
  references: string[];
  headers: Array<{ name: string; value: string }>;
};

/** Why nothing can be stored at all — the run aborts without moving the cursor (L1). */
export const ABORT_REASONS = ["disabled", "not_syncable"] as const;

type Evaluation = {
  decision: IngestDecision | { store: false; reason: (typeof ABORT_REASONS)[number] };
  connector: Doc<"connectors"> | null;
  thread: Doc<"emailThreads"> | null;
  clientId?: Id<"clients">;
  contactId?: Id<"clientContacts">;
  isTeam: (email: string) => boolean;
  /** M1: an inbound sender Gmail did not authenticate. */
  unverifiedSender: boolean;
  /** M2: the message's addresses may join the thread's participants. */
  mergeParticipants: boolean;
};

/** Every address of the team: org members' emails and the org's mailbox addresses. */
async function teamAddresses(ctx: QueryCtx, connector: Doc<"connectors">): Promise<Set<string>> {
  const out = new Set<string>();
  if (connector.credentialMask) out.add(connector.credentialMask.toLowerCase());
  const members = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId", (q) => q.eq("orgId", connector.orgId))
    .take(TEAM_MEMBERS_CAP);
  for (const m of members) {
    const user = m.userId ? await ctx.db.get(m.userId) : null;
    if (user?.email) out.add(user.email.trim().toLowerCase());
  }
  const mailboxes = await ctx.db
    .query("connectors")
    .withIndex("by_orgId", (q) => q.eq("orgId", connector.orgId))
    .take(TEAM_MEMBERS_CAP);
  for (const c of mailboxes) {
    if (c.type === GMAIL && c.credentialMask && !c.devSeed) out.add(c.credentialMask.toLowerCase());
  }
  return out;
}

async function isOwnerAdmin(ctx: QueryCtx, connector: Doc<"connectors">): Promise<boolean> {
  const user = await ctx.db.get(connector.userId);
  if (!user || user.deletedAt) return false;
  const member = await ctx.db
    .query("orgMembers")
    .withIndex("by_orgId_clerkUserId", (q) => q.eq("orgId", connector.orgId).eq("clerkUserId", user.externalId))
    .unique();
  return member?.role === "admin";
}

/** The sender's client: an exact contact email first, then a client domain (§5.2 step 5). */
async function resolveSenderClient(
  ctx: QueryCtx,
  orgId: string,
  sender: string,
): Promise<{ clientId: Id<"clients">; contactId?: Id<"clientContacts"> } | null> {
  if (!sender) return null;
  const contact = await ctx.db
    .query("clientContacts")
    .withIndex("by_orgId_email", (q) => q.eq("orgId", orgId).eq("email", sender))
    .first();
  const clients = (
    await ctx.db
      .query("clients")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .take(CLIENTS_CAP)
  ).filter((c) => !c.archivedAt);
  const candidates = clients.map((c) => ({
    id: c._id,
    emailDomains: c.emailDomains ?? [],
    contactEmails: contact && contact.clientId === c._id ? [contact.email] : [],
  }));
  const match = matchClientByDomain(sender, candidates);
  if (!match) return null;
  return {
    clientId: match.client.id,
    contactId: match.via === "contact" && contact ? contact._id : undefined,
  };
}

/**
 * Our own mail already known (I1 / B5): an outbound row with this Message-ID
 * anywhere in the org (the send pipeline stored it, or another mailbox's copy
 * was synced — D33 already ran), or a draft whose send is in flight.
 */
async function isAppSent(ctx: QueryCtx, connector: Doc<"connectors">, rfcMessageId: string): Promise<boolean> {
  const copies = await ctx.db
    .query("emailMessages")
    .withIndex("by_orgId_rfcMessageId", (q) => q.eq("orgId", connector.orgId).eq("rfcMessageId", rfcMessageId))
    .take(10);
  if (copies.some((m) => m.direction === "outbound")) return true;
  for (const status of ["dispatching", "unknown", "sent"] as const) {
    const drafts = await ctx.db
      .query("emailDrafts")
      .withIndex("by_orgId_status", (q) => q.eq("orgId", connector.orgId).eq("status", status))
      .order("desc")
      .take(IN_FLIGHT_DRAFTS_CAP);
    if (drafts.some((d) => d.messageIdHeader === rfcMessageId || (d.priorMessageIds ?? []).includes(rfcMessageId))) {
      return true;
    }
  }
  return false;
}

/**
 * The facts of D24 for one message, read in one transaction (the query
 * before the attachments are uploaded, and the store mutation again).
 */
async function evaluateIngest(ctx: QueryCtx, connectorId: Id<"connectors">, input: IngestInput): Promise<Evaluation> {
  const none = (reason: (typeof ABORT_REASONS)[number]): Evaluation => ({
    decision: { store: false, reason },
    connector: null,
    thread: null,
    isTeam: () => false,
    unverifiedSender: false,
    mergeParticipants: false,
  });
  const connector = await ctx.db.get(connectorId);
  if (!connector || !isSyncable(connector)) return none("not_syncable");
  if (!(await isEmailTriageEnabled(ctx, connector.orgId))) return none("disabled");
  const orgId = connector.orgId;

  const stored = await ctx.db
    .query("emailMessages")
    .withIndex("by_orgId_connectorId_gmailMessageId", (q) =>
      q.eq("orgId", orgId).eq("connectorId", connector._id).eq("gmailMessageId", input.gmailMessageId),
    )
    .first();

  const team = await teamAddresses(ctx, connector);
  const isTeam = (email: string) => team.has(email.trim().toLowerCase());
  const sender = input.from?.email.trim().toLowerCase() ?? "";
  // M3: only Gmail's SENT label makes it ours; a team address in From of an
  // inbound message is a colleague (when authenticated) or a forgery.
  const outbound = input.labelIds.includes("SENT");
  const teamSender = !outbound && sender !== "" && isTeam(sender);
  // M1: Gmail's own authentication verdict on the From domain.
  const verified = !outbound && senderAuthentication(input.headers, sender).verified;

  const settings = await getOrgSettings(ctx, orgId);
  const ignoredDomain = sender !== "" && isIgnoredDomain(emailDomain(sender), settings?.ignoredEmailDomains ?? []);
  const senderClient = !outbound && !teamSender && !ignoredDomain ? await resolveSenderClient(ctx, orgId, sender) : null;

  const thread = input.gmailThreadId
    ? await ctx.db
        .query("emailThreads")
        .withIndex("by_orgId_connectorId_gmailThreadId", (q) =>
          q.eq("orgId", orgId).eq("connectorId", connector._id).eq("gmailThreadId", input.gmailThreadId),
        )
        .first()
    : null;
  const isParticipantOf = (t: Doc<"emailThreads">) => t.participants.some((p) => p.email.toLowerCase() === sender);

  // Tracked: this Gmail thread is stored, or the message answers a stored one.
  let tracked = thread !== null;
  let participant = thread !== null && sender !== "" && isParticipantOf(thread);
  let inherited: { clientId: Id<"clients">; contactId?: Id<"clientContacts"> } | null = null;
  const refs = [...new Set([input.inReplyTo, ...[...input.references].reverse()].filter((r): r is string => !!r))].slice(
    0,
    REFERENCE_LOOKUPS_CAP,
  );
  for (const ref of refs) {
    if (tracked && participant && inherited) break;
    const hits = await ctx.db
      .query("emailMessages")
      .withIndex("by_orgId_rfcMessageId", (q) => q.eq("orgId", orgId).eq("rfcMessageId", ref))
      .take(5);
    if (hits.length === 0) continue;
    tracked = true;
    for (const hit of hits) {
      const t = await ctx.db.get(hit.threadId);
      if (!t || t.orgId !== orgId) continue;
      const inThread = sender !== "" && isParticipantOf(t);
      if (inThread) participant = true;
      // A Message-ID alone is not proof (it can be copied): the client link is
      // inherited only by our own reply, or by an authenticated participant.
      if (!inherited && t.clientId && (outbound || (verified && inThread))) {
        inherited = { clientId: t.clientId, contactId: t.contactId };
      }
    }
  }
  if (teamSender) participant = false; // M3: a colleague's address in From of inbound mail proves nothing
  const knownClient = senderClient !== null && verified;
  const clientId = thread?.clientId ?? (knownClient ? senderClient!.clientId : undefined) ?? inherited?.clientId;
  const contactId = thread?.contactId ?? (knownClient ? senderClient!.contactId : undefined) ?? inherited?.contactId;

  // §5.2 step 6: the client's own task id in the subject tracks the conversation too.
  if (!tracked && knownClient && clientId) {
    for (const identifier of extractTaskIdentifiers(input.subject).slice(0, 5)) {
      const task = await ctx.db
        .query("tasks")
        .withIndex("by_orgId_identifier", (q) => q.eq("orgId", orgId).eq("identifier", identifier))
        .first();
      if (task && !task.archivedAt && task.clientId === clientId) {
        tracked = true;
        break;
      }
    }
  }

  const decision = decideIngest({
    labelIds: input.labelIds,
    signals: isBulkOrAutomated(input.headers, { labelIds: input.labelIds }),
    outbound,
    teamSender,
    senderVerified: verified,
    senderIsParticipant: participant,
    alreadyStored: stored !== null,
    appSent: outbound && (await isAppSent(ctx, connector, input.rfcMessageId)),
    ignoredDomain,
    knownClientSender: senderClient !== null,
    trackedThread: tracked,
    mailboxOwnerIsAdmin: await isOwnerAdmin(ctx, connector),
  });
  return {
    decision,
    connector,
    thread,
    clientId,
    contactId,
    isTeam,
    unverifiedSender: !outbound && !verified,
    // M2: unknown / unauthenticated inbound senders never join the participants.
    mergeParticipants: outbound || knownClient || (participant && verified),
  };
}

/** I1: the ids of this batch the mailbox has not stored yet (no download for the rest). */
export const newMessageIds = internalQuery({
  args: { connectorId: v.id("connectors"), gmailMessageIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<string[]> => {
    const connector = await ctx.db.get(args.connectorId);
    if (!connector) return [];
    const out: string[] = [];
    for (const id of new Set(args.gmailMessageIds)) {
      const row = await ctx.db
        .query("emailMessages")
        .withIndex("by_orgId_connectorId_gmailMessageId", (q) =>
          q.eq("orgId", connector.orgId).eq("connectorId", connector._id).eq("gmailMessageId", id),
        )
        .first();
      if (!row) out.push(id);
    }
    return out;
  },
});

/** The D24 decision before anything is uploaded (`storeIngested` decides again). */
export const prepareIngest = internalQuery({
  args: { connectorId: v.id("connectors"), message: ingestValidator },
  handler: async (ctx, args): Promise<{ store: boolean; reason: string | null }> => {
    const { decision } = await evaluateIngest(ctx, args.connectorId, args.message);
    return decision.store ? { store: true, reason: null } : { store: false, reason: decision.reason };
  },
});

// ─── Store ────────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A plain-text email as the same simple HTML the seed stores (`<div>…<br>…</div>`). */
function plainToHtml(text: string): string {
  return `<div>${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
}

function mergeParticipants(existing: readonly EmailAddress[], next: ReadonlyArray<EmailAddress | null>): EmailAddress[] {
  const out = [...existing];
  const seen = new Set(existing.map((p) => p.email.toLowerCase()));
  for (const p of next) {
    if (!p || seen.has(p.email.toLowerCase()) || out.length >= THREAD_PARTICIPANTS_CAP) continue;
    seen.add(p.email.toLowerCase());
    out.push(p.name ? { name: p.name, email: p.email } : { email: p.email });
  }
  return out;
}

export type StoreResult =
  | { stored: true; messageId: Id<"emailMessages">; threadId: Id<"emailThreads">; direction: "inbound" | "outbound" }
  | { stored: false; reason: string };

/** Test hook: these Gmail ids fail to store like an oversized document would. */
let failStoreIds: ReadonlySet<string> = new Set();
export function failStoreForTesting(ids: readonly string[]): void {
  const isTest = typeof process !== "undefined" && Boolean(process.env.VITEST);
  if (!isTest) throw new Error("failStoreForTesting is test-only");
  failStoreIds = new Set(ids);
}

const UNREADABLE_MESSAGE = "This email couldn't be stored here (too large or malformed) — open it in Gmail";

/**
 * Store one synced message (§5.2 step 3): decide again in this transaction
 * (D24 / I1 — a concurrent copy or a flag change since `prepareIngest`),
 * upsert the thread (I1: one per Gmail thread per mailbox), insert the
 * message at stage `received` and start the B4 pipeline — or, for our own
 * mail on a tracked thread, store it `handled` and apply D33 (open drafts
 * stale, kickoff closed as "Replied in Gmail", waiting on the client) when it
 * went to someone outside the team. Every field is capped to a byte budget
 * well under 1 MiB (H2). `unreadable`: the full store failed — keep a
 * minimal row (headers only, stage `failed`) with an attention on its
 * conversation (I5: never dropped). `stored: false` → the caller deletes the
 * files it uploaded.
 */
export const storeIngested = internalMutation({
  args: {
    connectorId: v.id("connectors"),
    message: v.object({
      ...ingestFields,
      dateHeader: v.union(v.number(), v.null()),
      internalDate: v.union(v.number(), v.null()),
      /** The decoded body as text — the quoted history is stripped here. */
      text: v.string(),
      html: v.union(v.string(), v.null()),
      attachments: v.array(emailMessageAttachmentValidator),
      toOverflow: v.optional(v.number()),
      ccOverflow: v.optional(v.number()),
    }),
    unreadable: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<StoreResult> => {
    const m = args.message;
    if (!args.unreadable && failStoreIds.has(m.gmailMessageId)) throw new Error("Value is too large (test)");
    const ev = await evaluateIngest(ctx, args.connectorId, m);
    if (!ev.decision.store || !ev.connector) return { stored: false, reason: ev.decision.store ? "not_syncable" : ev.decision.reason };
    const connector = ev.connector;
    const orgId = connector.orgId;
    const direction = ev.decision.direction;
    const now = Date.now();
    const sentAt = chooseSentAt(m.dateHeader, m.internalDate, now);

    const fullText = args.unreadable ? "" : m.text;
    const fit = fitMessageBudget({
      subject: m.subject,
      from: m.from ?? { email: connector.credentialMask ?? "unknown@invalid" },
      to: m.to,
      cc: m.cc,
      bodyText: args.unreadable ? "" : stripQuoted(capUtf8(fullText, 400_000), { subject: m.subject }).text,
      bodyHtml: args.unreadable ? "" : (m.html ?? plainToHtml(capUtf8(fullText, 400_000))),
      attachments: args.unreadable ? [] : m.attachments,
    });

    let thread = ev.thread;
    const participants = ev.mergeParticipants
      ? mergeParticipants(thread?.participants ?? [], [fit.from, ...fit.to, ...fit.cc])
      : (thread?.participants ?? []);
    if (thread) {
      await ctx.db.patch(thread._id, {
        participants,
        lastMessageAt: Math.max(thread.lastMessageAt, sentAt),
        ...(direction === "inbound"
          ? { lastInboundAt: Math.max(thread.lastInboundAt ?? 0, sentAt), waitingOn: "us" as const }
          : { lastOutboundAt: Math.max(thread.lastOutboundAt ?? 0, sentAt) }),
        ...(thread.clientId ? {} : ev.clientId ? { clientId: ev.clientId } : {}),
        ...(thread.contactId ? {} : ev.contactId ? { contactId: ev.contactId } : {}),
        updatedAt: now,
      });
    } else {
      const threadId = await ctx.db.insert("emailThreads", {
        orgId,
        connectorId: connector._id,
        gmailThreadId: m.gmailThreadId || `message:${m.gmailMessageId}`,
        subject: capUtf8(normalizeSubject(fit.subject), 2_000),
        clientId: ev.clientId,
        contactId: ev.contactId,
        participants,
        lastMessageAt: sentAt,
        lastInboundAt: direction === "inbound" ? sentAt : undefined,
        lastOutboundAt: direction === "outbound" ? sentAt : undefined,
        waitingOn: direction === "inbound" ? "us" : "client",
        createdAt: now,
        updatedAt: now,
      });
      thread = (await ctx.db.get(threadId))!;
    }

    const failed = args.unreadable === true && direction === "inbound";
    const stageError = failed ? { stage: "received", message: UNREADABLE_MESSAGE, attempts: MAX_MESSAGE_ATTEMPTS } : undefined;
    const toOverflow = (m.toOverflow ?? 0) + fit.toOverflow;
    const ccOverflow = (m.ccOverflow ?? 0) + fit.ccOverflow;
    const messageId = await ctx.db.insert("emailMessages", {
      orgId,
      threadId: thread._id,
      connectorId: connector._id,
      gmailMessageId: m.gmailMessageId,
      rfcMessageId: m.rfcMessageId.length > RFC_MESSAGE_ID_MAX ? `<${m.gmailMessageId}@gmail.invalid>` : m.rfcMessageId,
      direction,
      from: fit.from,
      to: fit.to,
      cc: fit.cc,
      toOverflow: toOverflow || undefined,
      ccOverflow: ccOverflow || undefined,
      unverifiedSender: ev.unverifiedSender || undefined,
      subject: fit.subject,
      bodyText: fit.bodyText,
      bodyHtml: fit.bodyHtml || undefined,
      attachments: fit.attachments,
      sentAt,
      stage: failed ? "failed" : direction === "inbound" ? "received" : "handled",
      stageError,
      stageAt: now,
      createdAt: now,
    });

    // H1: this message is done — its attempt marker goes.
    const state = await loadState(ctx, connector._id);
    if (state?.attempts?.some((a) => a.gmailMessageId === m.gmailMessageId)) {
      await ctx.db.patch(state._id, { attempts: withoutDone(state.attempts, [m.gmailMessageId]), updatedAt: now });
    }

    if (failed && stageError) {
      // I5: never dropped — the conversation's item says it couldn't be stored.
      const attention = { messageId, ...stageError, at: now };
      const anchor = { type: "emailThread", id: thread._id as string };
      const live = await findLiveItem(ctx, orgId, anchor);
      if (live) {
        await joinItem(ctx, live, { messageId, replan: false, patch: { attentions: [...openAttentions(live), attention] } });
      } else {
        await openItem(ctx, { orgId, source: "email", anchor, kind: "attention", status: "open", messageIds: [messageId], attentions: [attention] });
      }
    } else if (direction === "inbound") {
      await ctx.scheduler.runAfter(0, internal.email.pipeline.processInboundMessage, { messageId });
    } else if (isReplyToOutsider([...fit.to, ...fit.cc], ev.isTeam)) {
      // D33: drafts stale ("You replied in Gmail at 14:05" — markConversationDraftsStale,
      // the helper behind markThreadDraftsStale), kickoff closed, waiting on the client.
      await ctx.scheduler.runAfter(0, internal.email.reply.markRepliedInGmail, { threadId: thread._id, sentAt });
    }
    return { stored: true, messageId, threadId: thread._id, direction };
  },
});
